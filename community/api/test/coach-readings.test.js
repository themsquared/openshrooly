import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeChamberUrl,
  readingsFromEntities,
  sensorValue,
  telemetryDocument,
} from "../scripts/coach-readings.js";

test("ESPHome sensor payloads become Coach telemetry", () => {
  assert.equal(sensorValue({ value: 91.2, state: "91.2 %" }), 91.2);
  assert.equal(sensorValue({ state: "20.4 °C" }), 20.4);
  const readings = readingsFromEntities({
    temperature: { value: 20.4 },
    humidity: { value: 91.2 },
    humidity_setpoint: { value: 90 },
    temperature_setpoint: { value: 20 },
    water_level: { value: 42 },
  });
  const doc = telemetryDocument(readings, { source: "http://192.168.1.42" });
  assert.equal(doc.humidity, 91.2);
  assert.equal(doc.humidity_setpoint, 90);
  assert.equal(doc.temperature_c, 20.4);
  assert.equal(doc.water_level, 42);
  assert.equal(normalizeChamberUrl("192.168.1.42"), "http://192.168.1.42");
});
