import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_PAGES, FACTS, SOURCES } from "../../web/scripts/ai/index.js";
import { AUTOPILOT_LIMITS } from "../src/coach-autopilot.js";
import { DEVICE_HEARTBEAT_MS, READINGS_STALE_MINUTES, SAFE_BOUNDS, TEMPERATURE_CLAMP } from "../src/coach-learn.js";
import { JEV_POLICY } from "../src/jev.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PUBLIC = join(ROOT, "community", "web", "public");
const read = (f) => readFileSync(join(PUBLIC, f), "utf8");
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const main = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
  const d = JSON.parse(m[1]);
  return d["@graph"] || [d];
});
const file = (p) => `${p.path.slice(1)}.html`;

test("numbers on the AI pages match the API source", () => {
  assert.deepEqual(FACTS.autopilotTemp, AUTOPILOT_LIMITS.tempClamp);
  assert.deepEqual(FACTS.autopilotRh, AUTOPILOT_LIMITS.humidityClamp);
  assert.equal(FACTS.maxStepTemp, AUTOPILOT_LIMITS.maxStepTemp);
  assert.equal(FACTS.maxStepRh, AUTOPILOT_LIMITS.maxStepRh);
  assert.equal(FACTS.maxStepFan, AUTOPILOT_LIMITS.maxStepFan);
  assert.equal(FACTS.minIntervalHours * 3600000, AUTOPILOT_LIMITS.minIntervalMs);
  assert.equal(FACTS.dailyCap, AUTOPILOT_LIMITS.dailyCap);
  assert.equal(FACTS.commandTtlMin * 60000, AUTOPILOT_LIMITS.commandTtlMs);
  assert.equal(FACTS.staleMin, READINGS_STALE_MINUTES);
  assert.deepEqual(FACTS.physicalTemp, AUTOPILOT_LIMITS.physicalTemp);
  assert.deepEqual(FACTS.physicalRh, AUTOPILOT_LIMITS.physicalRh);
  assert.equal(FACTS.jumpTemp, AUTOPILOT_LIMITS.jumpTemp);
  assert.equal(FACTS.jumpRh, AUTOPILOT_LIMITS.jumpRh);
  assert.deepEqual(FACTS.coachRh, SAFE_BOUNDS.humidity_percent);
  assert.deepEqual(FACTS.coachTemp, TEMPERATURE_CLAMP);
  assert.equal(FACTS.coachRhDelta, SAFE_BOUNDS.humidity_delta);
  assert.equal(FACTS.coachTempDelta, SAFE_BOUNDS.temperature_delta);
  assert.equal(FACTS.minConfidence, JEV_POLICY.minConfidence);
  assert.equal(FACTS.abnormalPause, JEV_POLICY.abnormalPause);
  assert.deepEqual(FACTS.steps, JEV_POLICY.steps);
  assert.equal(FACTS.lightBandPercent / 100, JEV_POLICY.lightBand);
  assert.equal(FACTS.heartbeatMin * 60000, DEVICE_HEARTBEAT_MS);
});

test("every AI page answers first, carries Article, FAQPage and breadcrumbs, and keeps analytics", () => {
  assert.ok(AI_PAGES.length >= 8);
  for (const p of AI_PAGES) {
    const html = read(file(p));
    const graph = jsonLd(html);
    assert.ok(graph.some((n) => n["@type"] === "Article"), `${p.path} Article`);
    const crumbs = graph.find((n) => n["@type"] === "BreadcrumbList");
    assert.ok(crumbs, `${p.path} breadcrumbs`);
    assert.equal(crumbs.itemListElement.at(-1).item, `https://shroomlabs.io${p.path}`);
    const faq = graph.find((n) => n["@type"] === "FAQPage");
    assert.ok(faq && faq.mainEntity.length >= 4, `${p.path} has FAQPage`);
    for (const q of faq.mainEntity) {
      const at = Math.max(html.indexOf(`<h2>${q.name}</h2>`), html.indexOf(`<h2>${q.name.replace(/'/g, "&#39;")}</h2>`));
      assert.ok(at > 0, `${p.path} shows question ${q.name}`);
      const first = html.slice(at, at + 2000).match(/<h2>[\s\S]*?<\/h2>\s*<p class="answer-first">([\s\S]*?)<\/p>/);
      assert.ok(first, `${p.path} ${q.name} opens with an answer`);
      assert.equal(text(first[1]).trim(), q.acceptedAnswer.text.trim());
    }
    assert.ok(html.includes(`<link rel="canonical" href="https://shroomlabs.io${p.path}">`), `${p.path} canonical`);
    assert.match(html, /googletagmanager\.com\/gtag\/js/, `${p.path} GA`);
    assert.ok(html.includes('href="/ai"'), `${p.path} links the hub`);
  }
});

test("AI copy is plain, culinary, and honest", () => {
  for (const p of AI_PAGES) {
    const body = text(main(read(file(p))));
    assert.doesNotMatch(body, /[\u2013\u2014\u2192\u2190]|->|=>/, `${p.path} dashes or arrows`);
    assert.doesNotMatch(body, /\bscam|fraud|psilocybin|magic mushroom/i, `${p.path} wording`);
    assert.doesNotMatch(body, /sldev_|\bserial number\b/i, `${p.path} device ids`);
    assert.doesNotMatch(body, /testimonial|\d(\.\d)? stars?\b|rated \d/i, `${p.path} ratings`);
  }
  const hub = read("ai.html");
  for (const p of AI_PAGES.slice(1)) assert.ok(hub.includes(`href="${p.path}"`), `hub links ${p.path}`);
  const humid = text(main(read("ai/smart-mushroom-grow-box-humidity-and-fresh-air.html")));
  assert.match(humid, /in progress and not released yet/, "unreleased water firmware is marked");
  const photo = text(main(read("ai/photo-check-and-charts.html")));
  assert.match(photo, /no camera inside/i);
});

test("AI pages are in the sitemap, llms files, redirects and footer, and cite https sources", () => {
  const sitemap = read("sitemap.xml");
  const llms = read("llms.txt");
  const full = read("llms-full.txt");
  const redirects = read("_redirects");
  for (const p of AI_PAGES) {
    assert.ok(sitemap.includes(`<loc>https://shroomlabs.io${p.path}</loc>`), `${p.path} sitemap`);
    assert.ok(llms.includes(`(https://shroomlabs.io${p.path})`), `${p.path} llms`);
    assert.ok(full.includes(`URL: https://shroomlabs.io${p.path}\n`), `${p.path} llms-full`);
    assert.ok(redirects.includes(`${p.path}.html ${p.path} 301!`), `${p.path} redirect`);
    for (const key of p.sources) assert.ok(SOURCES[key]?.url.startsWith("https://"), `${p.path} source ${key}`);
  }
  assert.ok(read("index.html").includes('<a href="/ai">AI</a>'), "footer link");
});
