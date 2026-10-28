import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAMBER_PAGES, CHAMBERS, SOURCES, TERRASHROOM_PINS } from "../../web/scripts/chambers/index.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PUBLIC = join(ROOT, "community", "web", "public");
const read = (f) => readFileSync(join(PUBLIC, f), "utf8");
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const main = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
  const d = JSON.parse(m[1]);
  return d["@graph"] || [d];
});

test("every FAQ answer is on the page, first, right under its question", () => {
  for (const p of CHAMBER_PAGES) {
    const html = read(`${p.slug}.html`);
    const graph = jsonLd(html);
    assert.ok(graph.some((n) => n["@type"] === "BreadcrumbList"), `${p.slug} breadcrumbs`);
    const faq = graph.find((n) => n["@type"] === "FAQPage");
    assert.ok(faq && faq.mainEntity.length >= 4, `${p.slug} has FAQPage`);
    for (const q of faq.mainEntity) {
      const at = html.indexOf(`<h2>${q.name.replace(/'/g, "&#39;")}</h2>`);
      assert.ok(at > 0, `${p.slug} shows question ${q.name}`);
      const first = html.slice(at, at + 1500).match(/<h2>[\s\S]*?<\/h2>\s*<p class="answer-first">([\s\S]*?)<\/p>/);
      assert.ok(first, `${p.slug} ${q.name} opens with an answer`);
      assert.equal(text(first[1]).trim(), q.acceptedAnswer.text.trim());
    }
    assert.ok(html.includes(`<link rel="canonical" href="https://shroomlabs.io/${p.slug}">`), `${p.slug} canonical`);
  }
});

test("chamber copy is plain and honest: no dashes, arrows, or harsh words, and Terrashroom says untested", () => {
  for (const p of CHAMBER_PAGES) {
    const body = text(main(read(`${p.slug}.html`)));
    assert.doesNotMatch(body, /[\u2013\u2014\u2192\u2190]|->|=>/, p.slug);
    assert.doesNotMatch(body, /\bscam|fraud|stole|ripped off|defunct|bankrupt/i, p.slug);
    assert.match(body, /untested on real hardware/i, p.slug);
  }
  const ts = text(main(read("terrashroom.html")));
  assert.match(ts, /GPIO12/);
  assert.match(ts, /cannot be undone/);
  assert.match(ts, /not supported yet/i, "camera is called out as unsupported");
  const status = Object.fromEntries(CHAMBERS.map((c) => [c.name, c.status]));
  assert.equal(status.Shrooly, "Supported");
  assert.equal(status.Terrashroom, "Community, untested");
  assert.equal(CHAMBERS.filter((c) => c.status === "Supported").length, 1, "only Shrooly is marked supported");
});

test("chamber pages cite their sources and are wired into the sitemap, llms files, redirects, and footer", () => {
  const sitemap = read("sitemap.xml");
  const llms = read("llms.txt");
  const full = read("llms-full.txt");
  const redirects = read("_redirects");
  for (const p of CHAMBER_PAGES) {
    const html = read(`${p.slug}.html`);
    for (const key of p.sources) {
      assert.ok(SOURCES[key], `${p.slug} source ${key}`);
      assert.ok(html.includes(`href="${SOURCES[key].url}"`), `${p.slug} links ${key}`);
    }
    assert.ok(sitemap.includes(`<loc>https://shroomlabs.io/${p.slug}</loc>`), p.slug);
    assert.ok(llms.includes(`https://shroomlabs.io/${p.slug}`), p.slug);
    assert.ok(full.includes(`https://shroomlabs.io/${p.slug}`), p.slug);
    assert.match(redirects, new RegExp(`^/${p.slug}\\.html /${p.slug} 301!$`, "m"), p.slug);
    for (const other of CHAMBER_PAGES.filter((o) => o !== p)) assert.ok(html.includes(`href="/${other.slug}"`), `${p.slug} links ${other.slug}`);
  }
  assert.ok(read("index.html").includes('href="/chambers"'), "footer links the hub");
  assert.ok(read("docs.html").includes('href="/terrashroom"'));
  assert.ok(read("shrooly-alternatives.html").includes('href="/chambers"'));
  assert.ok(read("guides/grow-kit-vs-monotub-vs-smart-chamber.html").includes('href="/terrashroom"'));
});

test("the Terrashroom page pin table matches the firmware", () => {
  const hw = readFileSync(join(ROOT, "esphome", "terrashroom", "components", "hardware.yaml"), "utf8");
  const pins = Object.fromEntries(TERRASHROOM_PINS);
  for (const [part, gpio] of [["Exhaust fan", 32], ["Intake fan", 33], ["Blower that carries the mist", 25], ["Mister (atomizer)", 13], ["Heater", 12], ["UV LED", 18], ["Base light strip (24 LEDs)", 5], ["Canopy light strip (64 LEDs)", 14], ["Camera power", 26]]) {
    assert.equal(pins[part], String(gpio), part);
    assert.match(hw, new RegExp(`pin:\\s*(number:\\s*)?GPIO${gpio}\\b`), `${part} on GPIO${gpio} in hardware.yaml`);
  }
});

test("the Terrashroom firmware keeps the heater safe at boot and stays labeled untested", () => {
  const dir = join(ROOT, "esphome", "terrashroom");
  const main = readFileSync(join(dir, "terrashroom.yaml"), "utf8");
  const controls = readFileSync(join(dir, "components", "controls.yaml"), "utf8");
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(main, /UNTESTED ON REAL HARDWARE/);
  assert.match(readme, /community, untested on real hardware/i);
  assert.match(main, /on_boot:[\s\S]*?priority:\s*800[\s\S]*?output.turn_off:\s*heater_pwm/, "heater off at the earliest boot step");
  assert.match(main, /on_shutdown:[\s\S]*?heater_pwm/, "heater off on shutdown");
  assert.match(controls, /id:\s*heater_auto[\s\S]*?restore_mode:\s*ALWAYS_OFF/, "heater control starts off");
  assert.doesNotMatch(readFileSync(join(dir, "components", "hardware.yaml"), "utf8"), /GPIO12[\s\S]{0,80}pullup:\s*true/, "no pull up on GPIO12");
});
