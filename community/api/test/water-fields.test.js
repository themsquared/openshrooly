import { test } from "node:test";
import assert from "node:assert/strict";
import { readWater, waterSeverity } from "../src/alerts/water.js";
import { latestReading } from "../src/coach-learn.js";

const T = Date.parse("2026-07-15T18:00:00Z");
const row = (doc, ago = 1) => ({ created_at: new Date(T - ago * 60000).toISOString(), document: JSON.stringify(doc) });

test("readWater accepts the telemetry water fields and ignores junk", () => {
  assert.deepEqual(readWater({ water_level: 42.5, water_state: "OK ", water_source: "sensor", water_low: false }), {
    level: 42.5,
    state: "ok",
    source: "sensor",
    low: false,
  });
  assert.deepEqual(readWater({ water_state: "suspect", water_source: "inferred", water_low: "true" }), {
    level: null,
    state: "suspect",
    source: "inferred",
    low: true,
  });
  assert.deepEqual(readWater({ water_state: "flooded", water_source: 7, water_low: "maybe", water_level: "abc" }), {
    level: null,
    state: null,
    source: null,
    low: null,
  });
  assert.deepEqual(readWater(null), { level: null, state: null, source: null, low: null });
  assert.equal(readWater({ water: 12 }).level, 12, "older chambers sent `water`");
});

test("waterSeverity uses the number first, the state second, and never guesses", () => {
  const th = { below: 30, empty: 12 };
  assert.equal(waterSeverity(readWater({ water_level: 5 }), th), "empty");
  assert.equal(waterSeverity(readWater({ water_level: 29 }), th), "low");
  assert.equal(waterSeverity(readWater({ water_level: 30 }), th), "ok");
  assert.equal(waterSeverity(readWater({ water_state: "suspect" }), th), "empty");
  assert.equal(waterSeverity(readWater({ water_state: "unknown" }), th), "unknown");
  assert.equal(waterSeverity(readWater({}), th), "unknown");
});

test("the latest reading carries the water state to the device page", () => {
  const r = latestReading(
    [
      row({ humidity: 80, temperature: 20, water_level: 60 }, 30),
      row({ humidity: 70, temperature: 20, water_level: 4, water_state: "empty", water_source: "sensor", water_low: true }, 1),
    ],
    T
  );
  assert.equal(r.water_level, 4);
  assert.equal(r.water_state, "empty");
  assert.equal(r.water_source, "sensor");
  assert.equal(r.water_low, true);
  const old = latestReading([row({ humidity: 80, temperature: 20 })], T);
  assert.equal(old.water_state, null, "older firmware reports no state");
  assert.equal(old.water_level, null);
});
