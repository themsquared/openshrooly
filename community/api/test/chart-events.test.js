import test from "node:test";
import assert from "node:assert/strict";
import { buildChartEvents, gapThresholdMs, telemetryEvents, durationText } from "../src/chart-events.js";

const T0 = Date.parse("2026-10-26T00:00:00Z");
const at = (min) => new Date(T0 + min * 60000).toISOString().replace(".000Z", "Z");
const reading = (min, doc) => ({ created_at: at(min), document: JSON.stringify({ temperature: 20, humidity: 90, ...doc }) });

test("offline gaps become spans, never a joined line", () => {
  const samples = [0, 15, 30, 45, 90, 105].map((m) => reading(m, {}));
  const ev = telemetryEvents(samples, { now: T0 + 110 * 60000 });
  assert.deepEqual(ev.map((e) => [e.type, e.at, e.end]), [["offline", at(45), at(90)]]);
  assert.equal(ev[0].detail, "Nothing for 45 min");
});

test("a chamber that stopped reporting shows an ongoing gap", () => {
  const ev = telemetryEvents([reading(0, {}), reading(15, {})], { now: T0 + 120 * 60000 });
  assert.equal(ev.at(-1).type, "offline");
  assert.equal(ev.at(-1).ongoing, true);
});

test("gap threshold never drops under 20 minutes", () => {
  assert.equal(gapThresholdMs([0, 60000, 120000, 180000]), 20 * 60000);
  assert.equal(gapThresholdMs([0, 15 * 60000, 30 * 60000]), 37.5 * 60000);
});

test("firmware changes come from telemetry", () => {
  const ev = telemetryEvents([reading(0, { firmware_version: "1.0.5" }), reading(15, { firmware_version: "1.0.6" })], { now: T0 + 16 * 60000 });
  assert.deepEqual(ev.map((e) => [e.type, e.detail]), [["firmware", "1.0.5 to 1.0.6"]]);
});

test("autopilot, coach, profile and setpoint records map to events", () => {
  const log = [
    { action: "apply", created_at: at(5), old_value: JSON.stringify({ temperature_c: 18 }), new_value: JSON.stringify({ temperature_c: 17 }), reason: "Too warm", apply_status: "acked" },
    { action: "expired", created_at: at(6) },
    { action: "pause", created_at: at(7), reason: "" },
  ];
  const commands = [
    { kind: "setpoints", issued_at: at(10), payload: JSON.stringify({ source: "grow-coach-autopilot", temperature_c: 17 }) },
    { kind: "setpoints", issued_at: at(11), payload: JSON.stringify({ source: "grow-coach", humidity_percent: 92 }) },
    { kind: "setpoints", issued_at: at(12), payload: JSON.stringify({ translated_from: "apply_profile", profile_id: "lions-mane", stage: "fruiting", _ack: { status: "refused" } }) },
    { kind: "setpoints", issued_at: at(13), payload: JSON.stringify({ temperature_c: 21 }) },
    { kind: "firmware_notice", issued_at: at(14), payload: "{}" },
  ];
  const ev = buildChartEvents({ log, commands, names: new Map([["lions-mane", "Lions mane"]]), since: at(0), now: T0 + 60 * 60000 });
  assert.deepEqual(
    ev.map((e) => [e.type, e.title]),
    [
      ["autopilot", "Autopilot change"],
      ["autopilot", "Autopilot paused"],
      ["coach", "Coach suggestion applied"],
      ["profile", "Profile changed"],
      ["setpoint", "Setpoints changed"],
    ],
  );
  assert.equal(ev[3].detail, "Lions mane, fruiting stage. The chamber refused it.");
});

test("events outside the window are dropped", () => {
  const log = [{ action: "pause", created_at: at(-120) }, { action: "resume", created_at: at(30) }];
  const ev = buildChartEvents({ log, since: at(0), now: T0 + 60 * 60000 });
  assert.deepEqual(ev.map((e) => e.title), ["Autopilot resumed"]);
});

test("duration text stays plain", () => {
  assert.equal(durationText(41 * 60000), "41 min");
  assert.equal(durationText(3 * 3600000), "3 h");
  assert.equal(durationText(72 * 3600000), "3 days");
});
