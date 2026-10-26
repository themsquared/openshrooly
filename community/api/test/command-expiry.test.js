import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_TTL_MS, commandSupersedes } from "../src/device-capabilities.js";
import { AUTOPILOT_LIMITS, autopilotCommandExpired } from "../src/coach-autopilot.js";

const cmd = (id, kind, payload, extra = {}) => ({ id, device_id: "d1", kind, payload: JSON.stringify(payload), ...extra });

test("commands outlive a cap-deferred poll: 2 h, not 30 min", () => {
  assert.equal(AUTOPILOT_LIMITS.commandTtlMs, 2 * 60 * 60 * 1000);
  assert.equal(COMMAND_TTL_MS, 2 * 60 * 60 * 1000);
  const issued = Date.parse("2026-10-26T07:05:05Z");
  const c = { issued_at: "2026-10-26T07:05:05Z", payload: JSON.stringify({ source: "grow-coach-autopilot" }) };
  // The prod miss: the next poll came 31.5 min after issue.
  assert.equal(autopilotCommandExpired(c, Date.parse("2026-10-26T07:36:32Z")), false);
  assert.equal(autopilotCommandExpired(c, issued + AUTOPILOT_LIMITS.commandTtlMs + 1000), true);
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
