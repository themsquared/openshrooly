import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderRobots, sitemapEntries } from "./generate-seo.js";
import {
  accessText,
  canAccept,
  coachView,
  priceText,
  changeText,
  decisionTitle,
  deciderText,
  modeText,
  outcomeText,
  renderChamberCard,
  renderDecision,
  renderRecommendation,
  renderRecommendations,
  withUnit,
} from "../public/js/coach-page.js";

const DASHES = /[\u2013\u2014\u2192]/;

const chamber = (over = {}) => ({
  device: {
    id: "d1",
    name: "Thing One",
    online: true,
    last_seen_at: new Date().toISOString(),
    controllable: true,
    controls: { temperature: { supported: true }, fan: { supported: true } },
    profile: { id: "lions-mane", name: "Lion's Mane", species: "Hericium erinaceus" },
    grow: { phase: "Fruiting", grow_day: 23, stage_day: 2, stage_days: 12, total_days: 33 },
    reading: { temperature: 20.3, humidity: 91.46, fan_speed: 25, reading_at: new Date().toISOString() },
    setpoints: { temperature_c: 17, humidity_percent: 90, fan_speed_percent: 25 },
    targets: { temperature_min: 15, temperature_max: 18, humidity_min: 85, humidity_max: 95, fan_speed_percent: 30 },
    chamber_light: { sunrise_hour: 8, duration_hours: 10, white_led_lux: 200 },
    light: { duration_hours: 12, white_led_lux: 400 },
    ...over.device,
  },
  autopilot: { mode: "advisor", status: "advisor", ...over.autopilot },
  recommendation: {
    profile_id: "lions-mane",
    stage: { id: "fruiting", name: "Fruiting" },
    suggestion: { temperature_c: 16, humidity_percent: 92, fan_speed_percent: 30, reasons: ["Cooler air helps fruiting."], within_bounds: true },
    current: { temperature_c: 17, humidity_percent: 90, fan_speed_percent: 25 },
    differs: true,
    todo: [],
    pending: null,
    ...over.recommendation,
  },
});

test("values and changes read plainly", () => {
  assert.equal(withUnit(17, "°C"), "17 °C");
  assert.equal(withUnit(90.04, "%"), "90%");
  assert.equal(withUnit(8, ":00"), "8:00");
  assert.equal(changeText({ label: "Temperature", unit: "°C", from: 18, to: 17 }), "Temperature 18 to 17 °C");
  assert.equal(changeText({ label: "Phase", unit: "", from: "Colonizing", to: "Fruiting" }), "Phase Colonizing to Fruiting");
  assert.equal(changeText({ label: "Fan", unit: "%", from: null, to: 25 }), "Fan set to 25%");
  assert.equal(changeText({ label: "Lights on at", unit: ":00", from: null, to: 8 }), "Lights on at 8:00");
  const many = ["A", "B", "C", "D", "E", "F"].map((label) => ({ label, unit: "%", from: 1, to: 2 }));
  assert.equal(decisionTitle({ action: "apply", changes: many }), "A 1% to 2%, B 1% to 2%, C 1% to 2%, D 1% to 2% and 2 more");
});

test("decision entries show what changed, who decided, why, outcome, and Undo", () => {
  const entry = {
    id: 7,
    action: "apply",
    device_name: "Thing One",
    changes: [{ key: "temperature_c", label: "Temperature", unit: "°C", from: 18, to: 17 }],
    decider: { who: "jev", confidence: 0.82 },
    reason: "Warmer than the recipe.",
    outcome: "applied",
    apply_status: "applied",
    undoable: true,
    created_at: new Date().toISOString(),
  };
  const html = renderDecision(entry);
  assert.match(html, /Temperature 18 to 17 °C/);
  assert.match(html, /Jev, 82% sure/);
  assert.match(html, /Warmer than the recipe/);
  assert.match(html, /Applied on the chamber/);
  assert.match(html, /data-undo="7"/);
  assert.doesNotMatch(html, DASHES);
  assert.equal(deciderText({ who: "rules" }), "Rules");
  assert.equal(outcomeText({ outcome: "not_applied", apply_status: "expired" }), "Expired before the chamber picked it up");
  assert.equal(decisionTitle({ action: "pause", changes: [] }), "Coach stopped adjusting");
  assert.doesNotMatch(renderDecision({ ...entry, undoable: false }), /data-undo/);
});

test("recommendations offer Accept in advisor mode and explain autopilot otherwise", () => {
  const advisor = renderRecommendation(chamber());
  assert.match(advisor, /Coach suggests/);
  assert.match(advisor, /data-accept="d1"/);
  assert.match(advisor, /now 17 °C/);
  assert.doesNotMatch(advisor, DASHES);
  const auto = chamber({ autopilot: { mode: "autopilot", status: "autopilot" } });
  assert.equal(canAccept(auto), false);
  assert.match(renderRecommendation(auto), /steering toward/);
  const pending = chamber({ recommendation: { pending: { id: 9, undoable: true, changes: [{ label: "Temperature", unit: "°C", from: 18, to: 17 }] } } });
  assert.match(renderRecommendation(pending), /On its way/);
  assert.match(renderRecommendation(pending), /data-undo="9"/);
  const same = chamber({ recommendation: { differs: false } });
  assert.match(renderRecommendation(same), /Nothing to change/);
  assert.doesNotMatch(renderRecommendation(chamber({ recommendation: { suggestion: { ...chamber().recommendation.suggestion, within_bounds: false } } })), /data-accept/);
});

test("chamber cards show status, growing, readings against targets, check-in, and mode", () => {
  const html = renderChamberCard(chamber({ autopilot: { mode: "autopilot", status: "paused", pause_reason: "The chamber looks offline." } }));
  assert.match(html, /Thing One/);
  assert.match(html, /Online/);
  assert.match(html, /Lion&#39;s Mane|Lion's Mane/);
  assert.match(html, /Fruiting, day 2 of 12/);
  assert.match(html, /Grow day 23 of 33/);
  assert.match(html, /20.3 °C/);
  assert.match(html, /set 17 °C, recipe 15 to 18 °C/);
  assert.match(html, /Fan/);
  assert.match(html, /10 h, 200 lux/);
  assert.match(html, /Paused. The chamber looks offline./);
  assert.match(html, /data-mode="autopilot"/);
  assert.doesNotMatch(html, DASHES);
  assert.equal(modeText({ mode: "advisor", status: "advisor" }), "Advisor. Coach suggests, you approve.");
});

test("a never-seen chamber waits for its first check-in, and off-menu chambers get no Coach", () => {
  const fresh = renderChamberCard(chamber({ device: { online: false, last_seen_at: null, reading: null } }));
  assert.match(fresh, /Waiting for first check-in/);
  assert.doesNotMatch(fresh, /Readings from/);
  assert.doesNotMatch(fresh, /Offline/);
  const off = { device: { id: "d2", name: "Thing 2", off_menu: true, online: true, last_seen_at: new Date().toISOString() }, autopilot: null, recommendation: null };
  const card = renderChamberCard(off);
  assert.match(card, /culinary grows only/);
  assert.doesNotMatch(card, /data-mode/);
  assert.equal(renderRecommendations([off]).includes("Thing 2"), false);
});

test("beta users see Free during the beta and the price after it; paid users see their date", () => {
  const product = { plans: [{ id: "monthly", period: "month", amount_cents: 499 }, { id: "yearly", period: "year", amount_cents: 4900 }] };
  assert.equal(priceText(product), "Grow Coach is $4.99 a month or $49 a year.");
  assert.equal(priceText({}), "Grow Coach is $4.99 a month or $49 a year.");
  assert.equal(accessText({ access: "beta", product }), "Free during the beta. After the beta, Grow Coach is $4.99 a month or $49 a year.");
  assert.equal(accessText({ access: "paid" }, "Nov 3, 2026"), "Active through Nov 3, 2026. Culinary chambers only.");
  assert.match(accessText({ access: "comp" }), /Free on this account/);
  for (const access of ["beta", "paid", "comp"]) assert.doesNotMatch(accessText({ access, product }, "x"), DASHES);
});

test("coach view: access gets the dashboard, no chamber gets the link panel, others get checkout", () => {
  assert.equal(coachView({ entitled: true, autopilot: true, chambers: 1 }, true), "dashboard");
  assert.equal(coachView({ entitled: false, chambers: 1 }, true), "checkout");
  assert.equal(coachView({ entitled: false, chambers: 0 }, true), "link");
  assert.equal(coachView({ entitled: false, chambers: 1, waitlist: true }, true), "waitlist");
  assert.equal(coachView({ entitled: false }, false), "signin");
  assert.equal(coachView({ entitled: false, waitlist: true }, false), "waitlist");
});

const COACH_HTML = readFileSync(new URL("../public/coach.html", import.meta.url), "utf8");

test("/coach is indexable: no noindex, in the sitemap, not blocked in robots, with title, description, canonical, og tags", () => {
  assert.doesNotMatch(COACH_HTML, /noindex/);
  assert.match(COACH_HTML, /<title>Grow Coach: automatic grow control for your Shrooly · Shroom Labs<\/title>/);
  assert.match(COACH_HTML, /<meta name="description" content="Grow Coach reads your Shrooly chamber's live readings[^"]+">/);
  assert.match(COACH_HTML, /<link rel="canonical" href="https:\/\/shroomlabs.io\/coach">/);
  for (const tag of ["og:title", "og:description", "og:url", "og:image"]) assert.match(COACH_HTML, new RegExp(`property="${tag}"`));
  assert.ok(sitemapEntries([]).some((e) => e.path === "/coach"));
  assert.doesNotMatch(renderRobots(), /Disallow: \/coach/);
});

test("/coach static HTML is the signed-out pitch: hero and how it works visible, skeleton and dashboard hidden", () => {
  assert.match(COACH_HTML, /<section id="coach-hero" class="hero coach-hero" /);
  assert.match(COACH_HTML, /<section id="coach-pitch" class="coach-pitch"/);
  assert.match(COACH_HTML, /id="coach-skeleton" class="device-skeleton hidden"/);
  assert.match(COACH_HTML, /id="gated" class="hidden/);
  assert.match(COACH_HTML, /<h1>Automatic grow control for your Shrooly.<\/h1>/);
  const pitch = COACH_HTML.slice(COACH_HTML.indexOf('id="coach-hero"'), COACH_HTML.indexOf('id="gated"'));
  assert.doesNotMatch(pitch, DASHES);
  assert.doesNotMatch(pitch, /psilocybin|off-menu/i);
});

test("/coach dashboard order: chambers, then recommendations, then the decisions feed", () => {
  const at = (id) => COACH_HTML.indexOf(`<section id="${id}"`);
  assert.ok(at("coach-chambers") > 0);
  assert.ok(at("coach-chambers") < at("coach-recs"), "chambers before recommendations");
  assert.ok(at("coach-recs") < at("coach-feed"), "recommendations before decisions");
});
