import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chamberEndpoints,
  humidityMeasuredValue,
  temperatureMeasuredValue,
  waterContactClosed,
} from "../src/mapping.js";
import { isValidPasscode, randomPasscode } from "../src/identity.js";

describe("hub to Matter mapping", () => {
  it("converts temperature to hundredths of a degree C", () => {
    assert.equal(temperatureMeasuredValue(22.5), 2250);
    assert.equal(temperatureMeasuredValue(0), 0);
    assert.equal(temperatureMeasuredValue(null), null);
    assert.equal(temperatureMeasuredValue("unavailable"), null);
  });

  it("converts humidity to hundredths of a percent and clamps", () => {
    assert.equal(humidityMeasuredValue(90), 9000);
    assert.equal(humidityMeasuredValue(87.6), 8760);
    assert.equal(humidityMeasuredValue(120), 10000);
    assert.equal(humidityMeasuredValue(null), null);
  });

  it("maps needs-water to an open contact", () => {
    assert.equal(waterContactClosed(true), false);
    assert.equal(waterContactClosed(false), true);
    assert.equal(waterContactClosed(null), null);
  });

  it("builds reachable endpoints for an online chamber", () => {
    const mapped = chamberEndpoints({
      id: 7,
      name: "Kitchen",
      online: true,
      temperature_c: 21.25,
      humidity_pct: 91,
      needs_water: true,
      light_on: false,
    });
    assert.equal(mapped.id, "7");
    assert.equal(mapped.reachable, true);
    assert.equal(mapped.temperature, 2125);
    assert.equal(mapped.humidity, 9100);
    assert.equal(mapped.waterClosed, false);
    assert.equal(mapped.lightOn, false);
  });

  it("marks offline chambers unreachable", () => {
    const mapped = chamberEndpoints({
      id: 2,
      name: "Shed",
      online: false,
      temperature_c: 18,
      humidity_pct: 40,
      needs_water: null,
    });
    assert.equal(mapped.reachable, false);
    assert.equal(mapped.waterClosed, null);
  });
});

describe("passcode", () => {
  it("never emits the well-known test passcode", () => {
    for (let i = 0; i < 20; i += 1) {
      const passcode = randomPasscode();
      assert.ok(isValidPasscode(passcode));
      assert.notEqual(passcode, 20202021);
    }
  });
});
