import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_TTL_MS, commandSupersedes } from "../src/device-capabilities.js";
import { AUTOPILOT_LIMITS, autopilotCommandExpired } from "../src/coach-autopilot.js";

const cmd = (id, kind, payload, extra = {}) => ({ id, device_id: "d1", kind, payload: JSON.stringify(payload), ...extra });

test("Autopilot commands expire after 35 minutes; grower commands still last 2 hours", () => {
  assert.equal(AUTOPILOT_LIMITS.commandTtlMs, 35 * 60 * 1000);
  assert.equal(COMMAND_TTL_MS, 2 * 60 * 60 * 1000);
  const issued = Date.parse("2026-11-15T22:20:05Z");
  const c = {
    issued_at: "2026-11-15T22:20:05Z",
    payload: JSON.stringify({
      source: "grow-coach-autopilot",
      // A leftover 2-hour expires_at must not keep a stale Autopilot command alive.
      expires_at: "2026-11-16T00:20:05Z",
    }),
  };
  assert.equal(autopilotCommandExpired(c, issued + 34 * 60 * 1000), false);
  assert.equal(autopilotCommandExpired(c, issued + 35 * 60 * 1000 + 1000), true);
});

test("a later stage pick drops a queued Autopilot command even if it does not repeat every knob", () => {
  const older = cmd(39, "setpoints", {
    source: "grow-coach-autopilot",
    temperature_c: 22,
    humidity_percent: 88,
    air_exchange_speed: 60,
    light_hours: 12,
    white_intensity: 20,
    color_b: 80,
  });
  const stageOnly = cmd(40, "setpoints", { source: "fleet", grow_phase: "Colonization" });
  assert.equal(commandSupersedes(stageOnly, older), true);
  assert.equal(commandSupersedes(cmd(40, "setpoints", { source: "fleet", stage: "colonization" }), older), true);
  assert.equal(commandSupersedes(cmd(40, "setpoints", { source: "site", color_b: 50 }), older), false, "a later color-only write does not drop Autopilot");
  assert.equal(commandSupersedes(cmd(38, "setpoints", { source: "fleet", grow_phase: "Colonization" }), older), false, "an older stage pick does not cancel a later Autopilot command");
});

test("a newer command supersedes an older one only when it covers every knob the older one sets", () => {
  const older = cmd(1, "setpoints", { air_exchange_speed: 30, light_hours: 5, source: "site", from: { x: 1 } });
  assert.equal(commandSupersedes(cmd(2, "setpoints", { air_exchange_speed: 25, light_hours: 10, white_intensity: 200 }), older), true);
  assert.equal(commandSupersedes(cmd(2, "setpoints", { light_hours: 10 }), older), false, "partial newer leaves the fan change");
  assert.equal(commandSupersedes(cmd(2, "setpoints", { fan_speed_percent: 25, light_hours: 10 }), older), true, "legacy fan key counts as air speed");
  assert.equal(commandSupersedes(cmd(0, "setpoints", { air_exchange_speed: 25, light_hours: 10 }), older), false, "must be newer");
  assert.equal(commandSupersedes(cmd(2, "schedule", { air_exchange_speed: 25, light_hours: 10 }), older), false, "same kind only");
  assert.equal(
    commandSupersedes(cmd(2, "setpoints", { air_exchange_speed: 25, light_hours: 10, _ack: { status: "refused" } }), older),
    false,
    "a refused newer command does not cancel the older one"
  );
  assert.equal(commandSupersedes(cmd(2, "setpoints", { air_exchange_speed: 25, light_hours: 10 }, { device_id: "d2" }), older), false);
  assert.equal(commandSupersedes(cmd(5, "apply_profile", { profile_id: "a", stage: "pinning" }), cmd(4, "apply_profile", { profile_id: "a", stage: "fruiting" })), true);
  assert.equal(commandSupersedes(cmd(5, "firmware_notice", {}), cmd(4, "firmware_notice", {})), false);
});
