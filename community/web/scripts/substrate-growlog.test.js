import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUBSTRATES, byIdSubstrate, batchWet, containerWetGrams, substratePlan } from "../public/js/substrate-math.js";
import { renderGrowLogBody, GROW_LOG, CHAMBERS, ENTRIES, validateEntry } from "./growlog/index.js";

const page = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

test("one published CVG batch scales back to its own recipe", () => {
  const cvg = byIdSubstrate("cvg");
  const plan = substratePlan(cvg, batchWet(cvg), 20);
  assert.ok(Math.abs(plan.scale - 1) < 1e-9);
  assert.equal(Math.round(plan.water), 4250);
  assert.equal(Math.round(plan.gypsum), 170);
  assert.ok(Math.abs(plan.spawn - batchWet(cvg) * 0.2) < 1e-6);
});

test("doubling the target doubles every ingredient", () => {
  for (const sub of SUBSTRATES) {
    const a = substratePlan(sub, 2000, 10), b = substratePlan(sub, 4000, 10);
    assert.ok(Math.abs(b.water - 2 * a.water) < 1e-6, sub.id);
    assert.ok(Math.abs(b.dryTotal - 2 * a.dryTotal) < 1e-6, sub.id);
  }
});

test("bad input returns null instead of a number", () => {
  const cvg = byIdSubstrate("cvg");
  assert.equal(substratePlan(cvg, 0, 10), null);
  assert.equal(substratePlan(cvg, 1000, -1), null);
  assert.equal(substratePlan(cvg, NaN, 10), null);
});

test("container size grows with volume and fill", () => {
  const cvg = byIdSubstrate("cvg");
  assert.ok(containerWetGrams(60, "l", 50, cvg) > containerWetGrams(60, "l", 25, cvg));
  assert.ok(Math.abs(containerWetGrams(1, "gal", 100, cvg) - containerWetGrams(3.785411784, "l", 100, cvg)) < 1e-6);
});

test("grow log shows no invented data until real entries exist", () => {
  assert.equal(ENTRIES.length, 0);
  const html = renderGrowLogBody();
  assert.match(html, /No entries yet/);
  assert.equal(CHAMBERS.length, 3);
  assert.match(html, /On bench, Black Oyster fruiting/);
  assert.doesNotMatch(html, /<img/);
  assert.throws(() => validateEntry({ date: "2026-11-03", chamber: "nope", note: "x" }));
  assert.ok(validateEntry({ date: "2026-11-03", chamber: "lykyn", note: "Blocks unpacked" }));
});

test("new pages are built, in the sitemap, and carry FAQ schema", () => {
  const sitemap = page("sitemap.xml");
  for (const p of ["/tools", "/tools/substrate-calculator", "/grow-log"]) assert.ok(sitemap.includes(`https://shroomlabs.io${p}</loc>`), p);
  assert.match(page("tools/substrate-calculator.html"), /"FAQPage"/);
  assert.match(page("grow-log.html"), /"FAQPage"/);
  assert.match(page("tools.html"), /substrate-calculator/);
  assert.doesNotMatch(page("_redirects"), /^\/tools \/grow/m);
});

test("new pages use plain punctuation: no em or en dashes or arrows", () => {
  for (const p of ["tools.html", "grow-log.html", "tools/substrate-calculator.html", "tools/grow-timeline.html"]) {
    const text = page(p).replace(/<script[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(text, /[\u2013\u2014\u2190-\u21ff]|&rarr;|-&gt;/, p);
    assert.doesNotMatch(text, /defunct/i, p);
  }
  assert.doesNotMatch(GROW_LOG.answer, /[\u2013\u2014]/);
});
