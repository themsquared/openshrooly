import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_PAGES, FACTS, SOURCES } from "../../web/scripts/ai/index.js";
import { AUTOPILOT_LIMITS } from "../src/coach-autopilot.js";
import { DEVICE_HEARTBEAT_MS, READINGS_STALE_MINUTES, SAFE_BOUNDS, TEMPERATURE_CLAMP, detectAlerts } from "../src/coach-learn.js";
import { DEFAULT_PREFS, DEFAULT_RULES } from "../src/alerts/rules.js";
import { readWater, waterSeverity } from "../src/alerts/water.js";
import { initialStatus } from "../src/alerts/cron.js";
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
    // The funnel: flash a Shrooly or Lykyn, then Grow Coach, near the top and again at the end, each with cta_click.
    for (const spot of ["ai_top", "ai_bottom"]) {
      for (const [href, type] of [["/install", "flash_shrooly"], ["/lykyn", "flash_lykyn"], ["/coach", "grow_coach"], ["/claim", "link_chamber"]]) {
        assert.ok(html.includes(`href="${href}" data-sl-event="cta_click" data-sl-params='{"location":"${spot}","type":"${type}"}'`), `${p.path} ${spot} ${type}`);
      }
    }
    assert.ok(html.indexOf('"location":"ai_top"') < html.indexOf('class="owner-section"'), `${p.path} top CTA comes right after the answer`);
    assert.match(text(main(html)), /Connect your grow to AI: flash your Lykyn or Shrooly today/);
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

test("water alert levels on the AI pages match the alert rules", async () => {
  assert.equal(FACTS.waterLow, DEFAULT_RULES.water.below);
  assert.equal(FACTS.waterEmpty, DEFAULT_RULES.water.empty);
  // "below" on the page: the mark itself is not yet an alert.
  const sev = (level) => waterSeverity(readWater({ water_level: level }), DEFAULT_RULES.water);
  assert.equal(sev(FACTS.waterLow), "ok");
  assert.equal(sev(FACTS.waterLow - 0.1), "low");
  assert.equal(sev(FACTS.waterEmpty), "low");
  assert.equal(sev(FACTS.waterEmpty - 0.1), "empty");
  // "The empty alert sends even during quiet hours": urgent notices skip the hold, others wait.
  const night = Date.parse("2026-11-21T07:00:00Z"); // 11 PM Pacific, inside the default quiet hours
  const base = { user: { email: "a@b.c", email_verified: 1 }, prefs: DEFAULT_PREFS, now: night, sentToday: async () => 0 };
  assert.equal(await initialStatus({ ...base, notice: { notify: true, urgent: true } }), "pending");
  assert.equal(await initialStatus({ ...base, notice: { notify: true, urgent: false } }), "held");
});

test("Coach alert thresholds on the AI pages match detectAlerts", () => {
  const t0 = Date.parse("2026-10-01T00:00:00Z");
  const day = 86400000;
  const sample = (humidity, setpoint, at) => ({ document: { humidity, humidity_setpoint: setpoint, temperature: 20, temperature_setpoint: 20 }, created_at: new Date(at).toISOString() });
  const kinds = (model, samples, stage, now) => detectAlerts(model, samples, stage, now).map((a) => a.kind);
  const flat = [sample(90, 90, t0)];

  // Humidity trouble: off by the quoted points or more, either direction.
  assert.ok(kinds({ humidity_error: FACTS.humidityTroublePts }, flat, {}, t0).includes("humidity_trouble"));
  assert.ok(kinds({ humidity_error: -FACTS.humidityTroublePts }, flat, {}, t0).includes("humidity_trouble"));
  assert.ok(!kinds({ humidity_error: FACTS.humidityTroublePts - 0.1 }, flat, {}, t0).includes("humidity_trouble"));

  // Stalled colonization: more than the quoted share of the stage, more than the quoted points under, not climbing.
  const col = { id: "colonization", name: "Colonization", duration_days: 10 };
  const under = (pts) => [sample(90 - pts, 90, t0)];
  const past = (pct) => t0 + (col.duration_days * pct) / 100 * day;
  const stalled = (pts, pct, rise = 0) => kinds({ humidity_rise_per_min: rise }, under(pts), col, past(pct)).includes("stalled_colonization");
  assert.ok(stalled(FACTS.stalledHumidityPts + 0.1, FACTS.stalledColonizationPercent + 1));
  assert.ok(!stalled(FACTS.stalledHumidityPts, FACTS.stalledColonizationPercent + 1), "exactly the quoted points under is not stalled");
  assert.ok(!stalled(FACTS.stalledHumidityPts + 0.1, FACTS.stalledColonizationPercent), "exactly the quoted share is not stalled");
  assert.ok(!stalled(FACTS.stalledHumidityPts + 0.1, FACTS.stalledColonizationPercent + 1, 0.05), "climbing humidity is not stalled");

  // Time to harvest: the quoted share of the fruiting stage has passed.
  const fruit = { id: "fruiting", name: "Fruiting", duration_days: 10 };
  const harvest = (pct) => kinds({}, flat, fruit, t0 + (fruit.duration_days * pct) / 100 * day).includes("time_to_harvest");
  assert.ok(harvest(FACTS.harvestPercent));
  assert.ok(!harvest(FACTS.harvestPercent - 1));
});
