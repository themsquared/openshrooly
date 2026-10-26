import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nowIso } from "../src/crypto.js";
import { fanRangeForStage, pickAutopilotStage, recipeKnobs, steerFan } from "../src/autopilot-knobs.js";
import { deviceCapabilities } from "../src/device-capabilities.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

const pearl = JSON.parse(readFileSync(new URL("../../../data/profiles/culinary/pearl-oyster.json", import.meta.url), "utf8"));
const CAPS_105 = [
  "setpoints.temperature",
  "setpoints.humidity",
  "setpoints.multi",
  "ack.refused",
  "setpoints.fan",
  "air.schedule",
  "light.schedule",
  "light.color",
  "grow.day",
  "grow.phase",
];
const caps105 = deviceCapabilities({ firmware_version: "1.0.5-sl.1", capabilities: CAPS_105 });
const legacyCaps = deviceCapabilities({ temperature_setpoint: 24, humidity_setpoint: 90 });

/** A 1.0.5 colonizing chamber, in the colonization recipe, on grow day `day`. */
function reading105({ day = 15, phase = "Colonizing", ...extra } = {}) {
  return {
    firmware_version: "1.0.5-sl.1",
    capabilities: CAPS_105,
    humidity: 91,
    humidity_setpoint: 90,
    temperature: 23.8,
    temperature_setpoint: 24,
    air_exchange_speed: 20,
    air_exchange_period_min: 60,
    air_exchange_run_sec: 15,
    sunrise_hour: 8,
    light_hours: 0,
    white_intensity: 0,
    color_r: 0,
    color_g: 0,
    color_b: 0,
    grow_day: day,
    grow_phase: phase,
    ...extra,
  };
}

test("grow day moves Autopilot forward through the profile, never back", () => {
  assert.equal(pickAutopilotStage(pearl, { grow_day: 3, grow_phase: "Colonizing" }, caps105).stageId, "colonization");
  const pin = pickAutopilotStage(pearl, { grow_day: 15, grow_phase: "Colonizing" }, caps105);
  assert.equal(pin.stageId, "pinning");
  assert.equal(pin.transition, true);
  assert.equal(pin.phase, "Pinning");
  assert.equal(pickAutopilotStage(pearl, { grow_day: 25, grow_phase: "Pinning" }, caps105).stageId, "fruiting");
  // A chamber already fruiting on a low day count stays fruiting.
  const stay = pickAutopilotStage(pearl, { grow_day: 2, grow_phase: "Fruiting" }, caps105);
  assert.equal(stay.stageId, "fruiting");
  assert.equal(stay.transition, false);
  // Past the end: the last stage. Firmware that reports neither keeps the fruiting target.
  assert.equal(pickAutopilotStage(pearl, { grow_day: 90, grow_phase: "Fruiting" }, caps105).stageId, "fruiting");
  assert.equal(pickAutopilotStage(pearl, { grow_day: 3 }, legacyCaps).stageId, "fruiting");
});

test("fan guardrail is the stage fan +/- 20, inside 15 to 80, and RH steers one step", () => {
  const fruiting = pearl.stages.find((s) => s.id === "fruiting");
  assert.deepEqual(fanRangeForStage(fruiting, caps105), [25, 65]);
  const colonization = pearl.stages.find((s) => s.id === "colonization");
  assert.deepEqual(fanRangeForStage(colonization, caps105), [15, 40]);
  const stage = { ...fruiting, humidity_target_min: 85, humidity_target_max: 91 };
  assert.equal(steerFan(stage, { humidity: 88 }, caps105).fan, 45);
  const wet = steerFan(stage, { humidity: 95 }, caps105);
  assert.equal(wet.fan, 55);
  assert.match(wet.reason, /high/);
  assert.equal(steerFan(stage, { humidity: 80 }, caps105).fan, 35);
  assert.equal(steerFan({ fan: { speed_percent: 75 }, humidity_percent: 80 }, { humidity: 99 }, caps105).fan, 80);
});

test("recipe knobs are only the ones this chamber reports", () => {
  const pinning = pearl.stages.find((s) => s.id === "pinning");
  const full = recipeKnobs(pinning, "pinning", caps105);
  assert.deepEqual(full, {
    air_exchange_period_min: 15,
    air_exchange_run_sec: 35,
    sunrise_hour: 8,
    light_hours: 12,
    white_intensity: 92,
    color_r: 0,
    color_g: 0,
    color_b: 80,
    grow_phase: "Pinning",
  });
  assert.deepEqual(recipeKnobs(pinning, "pinning", legacyCaps), {});
});

function env() {
  return testEnv({ GROW_COACH_STUB: "1", COACH_AUTOPILOT_ENABLED: "1" });
}

async function setup(email, deviceId, doc) {
  const ctx = env();
  const { token, user } = await register(ctx, email);
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  const me = await call(ctx, "GET", "/api/me", { token });
  await signedWebhook(ctx, stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id }));
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [deviceId, `hw-${deviceId}`, "{}", "Kitchen", "active", user.id, null, null, null, 1, nowIso(), nowIso()]
  );
  await ctx.db.run("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    pearl.id,
    JSON.stringify(pearl),
    user.id,
    1,
    nowIso(),
    nowIso(),
  ]);
  await addReading(ctx, deviceId, doc);
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", { token, body: { device_id: deviceId, mode: "autopilot", profile_id: pearl.id } });
  assert.equal(mode.status, 200, JSON.stringify(mode.data));
  return { ctx, token, user };
}

async function addReading(ctx, deviceId, doc, createdAt = nowIso()) {
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [deviceId, JSON.stringify(doc), createdAt]);
}

async function openCommands(ctx, deviceId) {
  const rows = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", [deviceId]);
  return rows.map((r) => JSON.parse(r.payload));
}

test("on 1.0.5 Autopilot moves the grow to pinning by day: one command with fan, air, light and phase", async () => {
  const { ctx, token } = await setup("knobs-ap@example.com", "dev-k1", reading105({ day: 15 }));
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-k1" } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  assert.equal(run.data.stage, "pinning");
  assert.equal(run.data.transition, true);
  const [cmd] = await openCommands(ctx, "dev-k1");
  assert.equal(cmd.source, "grow-coach-autopilot");
  assert.equal(cmd.grow_phase, "Pinning");
  assert.equal(cmd.temperature_c, 23, "temperature still steps 1 C at a time");
  assert.equal(cmd.air_exchange_speed, 30, "fan steps 10 toward the pinning 35");
  assert.equal(cmd.fan_speed_percent, undefined, "firmware keys only");
  assert.equal(cmd.air_exchange_period_min, 15);
  assert.equal(cmd.air_exchange_run_sec, 35);
  assert.equal(cmd.light_hours, 12);
  assert.equal(cmd.white_intensity, 90, "snapped to the chamber's 5 lux step");
  assert.equal(cmd.color_b, 80);
  assert.equal(cmd.grow_day, undefined, "the chamber counts days itself");
  const apply = run.data.actions.find((a) => a.action === "apply");
  assert.match(apply.reason, /Grow day 15: moving the chamber to Pinning/);
  assert.equal(apply.old_value.grow_phase, "Colonizing");
  assert.equal(apply.old_value.light_hours, 0);

  const undo = await call(ctx, "POST", "/api/coach/autopilot/undo", { token, body: { action_id: apply.id } });
  assert.equal(undo.status, 200, JSON.stringify(undo.data));
  const back = (await openCommands(ctx, "dev-k1")).at(-1);
  assert.equal(back.source, "grow-coach-autopilot-undo");
  assert.equal(back.grow_phase, "Colonizing");
  assert.equal(back.air_exchange_speed, 20);
  assert.equal(back.light_hours, 0);
  assert.equal(back.white_intensity, 0);
  assert.equal(back.air_exchange_period_min, 60);
});

test("someone changing the light on the chamber pauses Autopilot like a setpoint change", async () => {
  const { ctx, token } = await setup("knobs-manual@example.com", "dev-k2", reading105({ day: 15 }));
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-k2" } });
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  const [cmd] = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=?", ["dev-k2"]);
  const p = JSON.parse(cmd.payload);
  // The chamber applies it and acks.
  const applied = reading105({
    day: 15,
    phase: "Pinning",
    temperature_setpoint: p.temperature_c,
    humidity_setpoint: p.humidity_percent,
    air_exchange_speed: p.air_exchange_speed,
    air_exchange_period_min: p.air_exchange_period_min,
    air_exchange_run_sec: p.air_exchange_run_sec,
    light_hours: p.light_hours,
    white_intensity: p.white_intensity,
    color_b: p.color_b,
  });
  await addReading(ctx, "dev-k2", { ...applied, ack_command_id: cmd.id, ack_status: "applied" });
  const { noteAutopilotCommandAck } = await import("../src/coach-autopilot.js");
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-k2"]);
  await noteAutopilotCommandAck(ctx.db, device, cmd.id, "applied", {});
  // Two hours later someone turns the white light up on the chamber.
  const later = Date.now() + 2 * 3600 * 1000;
  await addReading(ctx, "dev-k2", { ...applied, white_intensity: 600 }, new Date(later - 60_000).toISOString().replace(/\.\d+Z$/, "Z"));
  const { runAutopilotForDevice } = await import("../src/coach-autopilot.js");
  const user = await ctx.db.one("SELECT * FROM users WHERE id=?", [device.owner_id]);
  const again = { data: await runAutopilotForDevice(ctx.db, ctx, { device: { ...device, last_seen_at: new Date(later).toISOString() }, user, now: later }) };
  assert.equal(again.data.paused, true, JSON.stringify(again.data));
  assert.match(again.data.reason, /changed a target yourself/);
});

test("a chamber that kept the Autopilot knobs does not trip the manual override", async () => {
  const { ctx, token } = await setup("knobs-steady@example.com", "dev-k4", reading105({ day: 15 }));
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-k4" } });
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  const [cmd] = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=?", ["dev-k4"]);
  const p = JSON.parse(cmd.payload);
  // The chamber applies it and acks.
  const applied = reading105({
    day: 15,
    phase: "Pinning",
    temperature_setpoint: p.temperature_c,
    humidity_setpoint: p.humidity_percent,
    air_exchange_speed: p.air_exchange_speed,
    air_exchange_period_min: p.air_exchange_period_min,
    air_exchange_run_sec: p.air_exchange_run_sec,
    light_hours: p.light_hours,
    white_intensity: p.white_intensity,
    color_b: p.color_b,
  });
  await addReading(ctx, "dev-k4", { ...applied, ack_command_id: cmd.id, ack_status: "applied" });
  const { noteAutopilotCommandAck } = await import("../src/coach-autopilot.js");
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-k4"]);
  await noteAutopilotCommandAck(ctx.db, device, cmd.id, "applied", {});
  // Two hours later someone turns the white light up on the chamber.
  const later = Date.now() + 2 * 3600 * 1000;
  await addReading(ctx, "dev-k4", { ...applied, grow_day: 16 }, new Date(later - 60_000).toISOString().replace(/\.\d+Z$/, "Z"));
  const { runAutopilotForDevice } = await import("../src/coach-autopilot.js");
  const user = await ctx.db.one("SELECT * FROM users WHERE id=?", [device.owner_id]);
  const again = { data: await runAutopilotForDevice(ctx.db, ctx, { device: { ...device, last_seen_at: new Date(later).toISOString() }, user, now: later }) };
  assert.notEqual(again.data.paused, true, JSON.stringify(again.data));
});

test("a chamber with old firmware still gets temperature and RH only", async () => {
  const { ctx, token } = await setup("knobs-legacy@example.com", "dev-k3", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-k3" } });
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  const [cmd] = await openCommands(ctx, "dev-k3");
  assert.equal(cmd.temperature_c, 23);
  for (const key of ["grow_phase", "air_exchange_speed", "light_hours", "white_intensity", "air_exchange_period_min"]) {
    assert.equal(cmd[key], undefined, key);
  }
});
