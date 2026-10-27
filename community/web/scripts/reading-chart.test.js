import test from "node:test";
import assert from "node:assert/strict";
import { niceTicks, segments, clusterEvents, visibleSeries, valueText, SERIES, nearestIndex, timeTicks, chartPoints } from "../public/js/reading-chart.js";

const M = 60000;

test("nice ticks cover the range with round steps", () => {
  const { min, max, ticks } = niceTicks(17.2, 22.9, 5);
  assert.ok(min <= 17.2 && max >= 22.9);
  assert.deepEqual(ticks, [16, 18, 20, 22, 24]);
});

test("lines break at gaps and offline spans", () => {
  const pts = [0, 15, 30, 90, 105].map((m) => ({ t: m * M, temperature: 20 }));
  assert.deepEqual(segments(pts, "temperature").map((r) => r.length), [3, 2]);
  const tight = [0, 15, 30, 45].map((m) => ({ t: m * M, temperature: 20 }));
  assert.deepEqual(segments(tight, "temperature", { offline: [{ start: 15 * M, end: 30 * M }] }).map((r) => r.length), [2, 2]);
});

test("markers merge until no two icons overlap", () => {
  const ev = [0, 10, 25, 40, 100].map((x) => ({ t: x }));
  const groups = clusterEvents(ev, (t) => t);
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i].x - groups[i - 1].x >= 20);
  assert.equal(groups.reduce((n, g) => n + g.events.length, 0), 5);
});

test("only reported channels get a panel", () => {
  const keys = visibleSeries([{ temperature: 20, humidity: 90, fan_speed: 25 }]).map((s) => s.key);
  assert.deepEqual(keys, ["temperature", "humidity", "fan_speed"]);
});

test("values carry units in the chosen temperature scale", () => {
  const temp = SERIES.find((s) => s.key === "temperature");
  assert.equal(valueText(temp, 20, "C"), "20.0 °C");
  assert.equal(valueText(temp, 20, "F"), "68.0 °F");
  assert.equal(valueText(SERIES.find((s) => s.key === "humidity"), 91.6), "92%");
});

test("nearest reading and time ticks", () => {
  const pts = chartPoints([{ at: "2026-10-26T01:00:00Z" }, { at: "2026-10-26T00:00:00Z" }]);
  assert.equal(nearestIndex(pts, Date.parse("2026-10-26T00:40:00Z")), 1);
  const t0 = Date.parse("2026-10-25T23:00:00Z");
  const ticks = timeTicks(t0, t0 + 24 * 3600000, 330);
  assert.ok(ticks.length >= 5 && ticks.length <= 9);
});
