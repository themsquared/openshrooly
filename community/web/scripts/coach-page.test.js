import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccept,
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
    grow: { phase: "Fruiting", day: 1 },
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
  assert.match(html, /Fruiting · day 2/);
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
