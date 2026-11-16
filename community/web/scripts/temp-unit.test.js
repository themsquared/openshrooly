import test from "node:test";
import assert from "node:assert/strict";
import { cToF, defaultTempUnit, formatTemp, formatTempValue, fromDisplayTemp, fToC, setTempUnit, tempDisplayField, tempUnit, toDisplayTemp } from "../public/js/temp-unit.js";

test("default is F for a US locale, C otherwise", () => {
  assert.equal(defaultTempUnit("en-US"), "F");
  assert.equal(defaultTempUnit("en-us"), "F");
  assert.equal(defaultTempUnit("en_US"), "F");
  assert.equal(defaultTempUnit("en-GB"), "C");
  assert.equal(defaultTempUnit("de-DE"), "C");
  assert.equal(defaultTempUnit(""), "C");
});

test("C to F and back lands on the same whole Fahrenheit degree", () => {
  for (let f = 32; f <= 104; f += 1) {
    const c = fToC(f);
    assert.equal(Math.round(cToF(c)), f, `${f} F`);
    assert.equal(Number(formatTempValue(c, "F")), f);
    assert.equal(Math.round(cToF(fromDisplayTemp(f, "F"))), f);
  }
});

test("a Celsius slider step comes back as the same tenth", () => {
  for (const c of [0, 16, 16.5, 21.2, 24, 40]) {
    assert.equal(fromDisplayTemp(c, "C"), c);
    assert.equal(toDisplayTemp(fromDisplayTemp(formatTempValue(c, "C"), "C"), "C"), c);
  }
});

test("24 C is 75 F on the slider, and writing 75 F stores 23.9 C", () => {
  assert.equal(Math.round(cToF(24)), 75);
  assert.equal(fromDisplayTemp(75, "F"), 23.9);
  assert.equal(formatTemp(21.19, "F"), "70.1 °F");
  assert.equal(formatTemp(21.19, "C"), "21.2 °C");
  assert.equal(formatTemp(24, "F", { style: "target" }), "75 °F");
});

test("the F slider is whole degrees from 32 to 104", () => {
  assert.deepEqual(tempDisplayField("F"), { min: 32, max: 104, step: 1, unit: "°F" });
  assert.deepEqual(tempDisplayField("C"), { min: 0, max: 40, step: 0.1, unit: "°C" });
});

test("setTempUnit persists F and C on the shared key", () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (Object.hasOwn(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
  setTempUnit("F");
  assert.equal(tempUnit(), "F");
  assert.equal(store["sl-temp-unit"], "F");
  setTempUnit("C");
  assert.equal(tempUnit(), "C");
  delete globalThis.localStorage;
});
