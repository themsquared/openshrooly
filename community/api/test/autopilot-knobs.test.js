import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nowIso } from "../src/crypto.js";
import { fanRangeForStage, pickAutopilotStage, recipeKnobs, steerFan } from "../src/autopilot-knobs.js";
import { deviceCapabilities, growPhaseForStage, sameGrowPhase } from "../src/device-capabilities.js";
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
  // Grow days count from 1 like the chamber: day 14 is the last day of a 14 day colonization.
  assert.equal(pickAutopilotStage(pearl, { grow_day: 14, grow_phase: "Colonizing" }, caps105).stageId, "colonization");
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
  // Still a few points under the 88 target: keep the lower fan, even though 86.83 is inside the 85-91 hysteresis band.
  const short = steerFan(stage, { humidity: 86.83 }, caps105);
  assert.equal(short.fan, 35);
  assert.match(short.reason, /low/);
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

async function setup(email, deviceId, doc, profile = pearl, before = null) {
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
    profile.id,
    JSON.stringify(profile),
    user.id,
    1,
    nowIso(),
    nowIso(),
  ]);
  if (before) await before(ctx);
  await addReading(ctx, deviceId, doc);
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", { token, body: { device_id: deviceId, mode: "autopilot", profile_id: profile.id } });
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
  assert.equal(cmd.air_exchange_speed, 25, "RH 91 is under the pinning 93 target, so the fan steps toward a reduced 25, not the full 35");
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

test("someone changing the light on the chamber does not pause Autopilot", async () => {
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
  assert.notEqual(again.data.paused, true, JSON.stringify(again.data));
  assert.equal(again.data.applied, true, JSON.stringify(again.data));
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

test("a fruiting grow on a chamber still showing its default Colonizing phase stays fruiting (prod regression)", async () => {
  const lions = JSON.parse(readFileSync(new URL("../../../data/profiles/culinary/lions-mane.json", import.meta.url), "utf8"));
  assert.equal(pickAutopilotStage(lions, { grow_day: 2, grow_phase: "Colonizing" }, caps105, { chosenStage: "fruiting" }).stageId, "fruiting");
  // The real first 1.0.5-sl.1 reading from Mike's chamber, after a site apply of lions-mane fruiting.
  const doc = reading105({
    day: 2,
    phase: "Colonizing",
    temperature: 21.52,
    humidity: 89.21,
    temperature_setpoint: 17,
    humidity_setpoint: 90,
    air_exchange_speed: 30,
    air_exchange_period_min: 15,
    air_exchange_run_sec: 30,
    light_hours: 5,
    white_intensity: 150,
    color_b: 100,
  });
  const { ctx, token } = await setup("knobs-prod@example.com", "dev-k5", doc, lions, (c) =>
    c.db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
      "dev-k5",
      "apply_profile",
      JSON.stringify({ profile_id: lions.id, stage: "fruiting", source: "fleet" }),
      nowIso(),
      nowIso(),
    ])
  );
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-k5" } });
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  assert.notEqual(run.data.paused, true);
  assert.equal(run.data.stage, "fruiting");
  const cmd = (await openCommands(ctx, "dev-k5")).at(-1);
  assert.equal(cmd.temperature_c, 17, "already on the fruiting target");
  assert.equal(cmd.grow_phase, "Fruiting");
  assert.equal(cmd.air_exchange_speed, 25);
  assert.equal(cmd.light_hours, 12);
  assert.equal(cmd.white_intensity, 190);
  assert.equal(cmd.air_exchange_period_min, 18);
  const apply = run.data.actions.find((a) => a.action === "apply");
  assert.match(apply.reason, /to match the fruiting stage you applied/);
});

test("Colonizing and Colonization are the same stage, named for the chamber", () => {
  assert.equal(growPhaseForStage("colonization"), "Colonizing");
  assert.equal(growPhaseForStage("Colonization"), "Colonizing");
  assert.equal(growPhaseForStage("colonizing"), "Colonizing");
  const lykyn = deviceCapabilities({ firmware_version: "0.2.0", capabilities: CAPS_105, ranges: { white_intensity: [0, 100, 1], air_exchange_speed: [33, 100, 1] } }, "lykyn_chamber");
  assert.equal(growPhaseForStage("colonization", lykyn), "Colonization");
  assert.equal(growPhaseForStage("Colonizing", lykyn), "Colonization");
  assert.equal(sameGrowPhase("Colonizing", "Colonization"), true);
  assert.equal(sameGrowPhase("Colonizing", "Fruiting"), false);
  assert.equal(pickAutopilotStage(pearl, { grow_day: 3, grow_phase: "Colonization" }, lykyn).stageId, "colonization");
  const pin = pickAutopilotStage(pearl, { grow_day: 15, grow_phase: "Colonization" }, lykyn);
  assert.equal(pin.stageId, "pinning");
  assert.equal(pin.transition, true);
  const col = pearl.stages.find((st) => st.id === "colonization");
  const knobs = recipeKnobs(col, "colonization", lykyn);
  assert.equal(knobs.grow_phase, "Colonization");
  assert.equal(knobs.white_intensity, 0);
  assert.equal(knobs.light_hours, 0);
  const fruiting = pearl.stages.find((st) => st.id === "fruiting");
  assert.equal(recipeKnobs(fruiting, "fruiting", lykyn).white_intensity, 20);
  assert.equal(recipeKnobs(fruiting, "fruiting", caps105).white_intensity, 92);
  assert.equal(recipeKnobs(col, "colonization", caps105).grow_phase, "Colonizing");
});

test("a Shrooly colonization grow still lands Colonizing, not Fruiting", async () => {
  const doc = reading105({
    day: 3,
    phase: "Idle",
    temperature: 18,
    humidity: 86,
    temperature_setpoint: 16,
    humidity_setpoint: 88,
    air_exchange_speed: 50,
    air_exchange_period_min: 10,
    air_exchange_run_sec: 40,
    light_hours: 12,
    white_intensity: 92,
    color_b: 80,
  });
  const { ctx, token } = await setup("knobs-colo-shrooly@example.com", "dev-k-colo", doc);
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-k-colo" } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  assert.equal(run.data.stage, "colonization");
  const cmd = (await openCommands(ctx, "dev-k-colo")).at(-1);
  assert.equal(cmd.grow_phase, "Colonizing");
  assert.equal(cmd.temperature_c, 17, "temperature still steps 1 C at a time toward 24");
  assert.equal(cmd.air_exchange_speed, 40, "fan steps 10 toward the colonization 20");
  assert.equal(cmd.air_exchange_period_min, 60);
  assert.equal(cmd.light_hours, 0);
  assert.equal(cmd.white_intensity, 0);
});

test("a failed colonization apply does not let Autopilot silently steer fruiting", async () => {
  const doc = reading105({
    day: 3,
    phase: "Fruiting",
    temperature: 18.7,
    humidity: 86.83,
    temperature_setpoint: 16,
    humidity_setpoint: 90,
    air_exchange_speed: 50,
    air_exchange_period_min: 10,
    air_exchange_run_sec: 40,
    light_hours: 12,
    white_intensity: 92,
    color_b: 80,
  });
  const { ctx, token } = await setup("knobs-failed-colo@example.com", "dev-k-fail", doc, pearl, (c) =>
    c.db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
      "dev-k-fail",
      "setpoints",
      JSON.stringify({
        profile_id: pearl.id,
        stage: "colonization",
        source: "fleet",
        grow_phase: "Colonizing",
        temperature_c: 24,
        humidity_percent: 90,
        _ack: { status: "failed", reason: "grow_phase is not an option" },
      }),
      nowIso(),
      nowIso(),
    ])
  );
  const before = (await ctx.db.all("SELECT id FROM device_commands WHERE device_id=?", ["dev-k-fail"])).length;
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-k-fail" } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.applied, false, JSON.stringify(run.data));
  assert.equal(run.data.status, "failed");
  assert.equal(run.data.skipped, "phase_apply_failed");
  assert.match(run.data.error, /grow_phase is not an option/);
  assert.notEqual(run.data.stage, "fruiting");
  const open = await openCommands(ctx, "dev-k-fail");
  assert.equal(open.length, 0, "no new Autopilot command was queued");
  const after = (await ctx.db.all("SELECT id FROM device_commands WHERE device_id=?", ["dev-k-fail"])).length;
  assert.equal(after, before);
});
