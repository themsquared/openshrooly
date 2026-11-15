import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import {
  commandState,
  controlSupport,
  deviceCapabilities,
  planForCapabilities,
  COMMAND_TTL_MS,
} from "../src/device-capabilities.js";
import { latestStagedCommand, runAutopilotForDevice, setDeviceAutopilotMode } from "../src/coach-autopilot.js";
import { deviceAdapter, CANONICAL_STAGES } from "../src/device-adapters.js";
import { validateStageLight } from "../src/profile-schema.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);
const fruiting = pearlOyster.stages.find((s) => s.id === "fruiting");
// What 1.0.4-sl.2 sends today: numbers only, no firmware_version, no capabilities.
const SL2_READING = {
  temperature: 20,
  temperature_c: 20,
  humidity: 88,
  humidity_percent: 88,
  temperature_target: 20,
  temperature_setpoint: 20,
  target_humidity: 88,
  humidity_setpoint: 88,
  temperature_target_min: 15,
  temperature_target_max: 35,
  target_humidity_min: 30,
  target_humidity_max: 100,
};

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", FLEET_UI_ENABLED: "1", COACH_AUTOPILOT_ENABLED: "1", ...extra });
}

async function grantCoach(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(
    ctx,
    stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id })
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
}

async function addDevice(ctx, userId, id, { lastSeen = nowIso() } = {}) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", "Kitchen", "active", userId, null, null, null, 1, lastSeen, nowIso()]
  );
}

async function addReading(ctx, deviceId, doc = SL2_READING) {
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    deviceId,
    JSON.stringify(doc),
    nowIso(),
  ]);
}

async function setup(email = "truth@example.com") {
  const ctx = env();
  const { token, user } = await register(ctx, email);
  await addDevice(ctx, user.id, "dev-1");
  await addReading(ctx, "dev-1");
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [pearlOyster.id, JSON.stringify(pearlOyster), user.id, 1, nowIso(), nowIso()]
  );
  return { ctx, token, user };
}

function rows(ctx, id = "dev-1") {
  return ctx.db.all("SELECT * FROM device_commands WHERE device_id=?", [id]);
}

const applyProfile = (ctx, token, extra = {}) =>
  call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "profile", payload: { profile_id: pearlOyster.id, stage: "fruiting", ...extra } },
  });

test("sl.2 telemetry infers setpoint-only capabilities and says so per control", () => {
  const caps = deviceCapabilities(SL2_READING);
  assert.equal(caps.firmware, null);
  assert.deepEqual(caps.list, ["setpoints.temperature", "setpoints.humidity"]);
  assert.equal(caps.apply_profile, false);
  assert.equal(caps.fan, false);
  assert.deepEqual(caps.ranges.temperature_c, [15, 32]);
  assert.deepEqual(caps.ranges.humidity_percent, [60, 98]);
  const controls = controlSupport(caps);
  assert.equal(controls.temperature.supported, true);
  assert.equal(controls.fan.supported, false);
  assert.match(controls.fan.note, /can't change fan speed/i);
  assert.equal(controls.light.supported, false);
  assert.match(controls.light.note, /light settings/i);
  assert.equal(controls.profile.supported, true);
  assert.equal(controls.profile.mode, "translated");
});

test("reported capabilities are honoured", () => {
  const caps = deviceCapabilities({ firmware_version: "2.0.0", capabilities: ["setpoints.temperature", "setpoints.humidity", "setpoints.fan", "light.schedule", "apply_profile"] });
  assert.equal(caps.source, "reported");
  assert.equal(caps.firmware, "2.0.0");
  assert.equal(controlSupport(caps).profile.mode, "native");
  const plan = planForCapabilities({ ok: true, kind: "apply_profile", payload: { profile_id: "x", stage: "fruiting" } }, caps, { stage: fruiting });
  assert.equal(plan.ok, true);
  assert.equal(plan.commands[0].kind, "apply_profile");
});

test("apply never reports applied on enqueue; the command starts queued", async () => {
  const { ctx, token } = await setup();
  const res = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { temperature_c: 18, humidity_percent: 90 } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const r = res.data.results[0];
  assert.equal(r.status, "queued");
  assert.ok(r.command_id);
  assert.doesNotMatch(r.message || "", /\bapplied\b/i);
  const list = await call(ctx, "GET", "/api/fleet/devices/dev-1/commands", { token });
  assert.equal(list.status, 200);
  assert.equal(list.data.commands[0].id, r.command_id);
  assert.equal(list.data.commands[0].status, "queued");
});

test("profile apply on sl.2 becomes the stage's temperature and RH setpoints; fan and light skipped plainly", async () => {
  const { ctx, token } = await setup();
  const res = await applyProfile(ctx, token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const r = res.data.results[0];
  assert.equal(r.status, "queued");
  assert.equal(r.translated, true);
  assert.match(r.message, /16 °C/);
  assert.match(r.message, /88% RH/);
  assert.ok(r.skipped.some((s) => /fan/i.test(s.note)));
  assert.ok(r.skipped.some((s) => /light/i.test(s.note)));
  const [cmd] = await rows(ctx);
  assert.equal(cmd.kind, "setpoints");
  const payload = JSON.parse(cmd.payload);
  assert.equal(payload.temperature_c, fruiting.temperature_c);
  assert.equal(payload.humidity_percent, fruiting.humidity_percent);
  assert.equal(payload.fan_speed_percent, undefined);
  assert.equal(payload.translated_from, "apply_profile");
  assert.equal(payload.profile_id, pearlOyster.id);
  assert.ok(payload.expires_at);
});

test("light-only and fan-only changes are refused with a plain message on sl.2", async () => {
  const { ctx, token } = await setup();
  const light = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "light", payload: { profile_id: pearlOyster.id, stage: "fruiting" } },
  });
  assert.equal(light.data.results[0].status, "failed");
  assert.match(light.data.results[0].error, /can't take light settings from the site/i);
  const fan = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { fan_speed_percent: 40 } },
  });
  assert.equal(fan.data.results[0].status, "failed");
  assert.match(fan.data.results[0].error, /fan/i);
  assert.equal((await rows(ctx)).length, 0);
  const raw = await call(ctx, "POST", "/api/devices/dev-1/commands", {
    token,
    body: { kind: "schedule", payload: { light: fruiting.light } },
  });
  assert.equal(raw.status, 409, JSON.stringify(raw.data));
  assert.match(raw.data.error, /light settings/i);
});

test("three quick submits make one command; the repeats come back deduped", async () => {
  const { ctx, token } = await setup();
  const results = [];
  for (let i = 0; i < 3; i += 1) results.push((await applyProfile(ctx, token)).data.results[0]);
  assert.equal((await rows(ctx)).length, 1);
  assert.equal(results[0].deduped, false);
  assert.equal(results[1].deduped, true);
  assert.equal(results[2].deduped, true);
  assert.equal(results[2].command_id, results[0].command_id);
});

test("the same request_id is never queued twice, even outside the window", async () => {
  const { ctx, token } = await setup();
  const first = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { temperature_c: 18, request_id: "req-abc" } },
  });
  const [cmd] = await rows(ctx);
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  cmd.issued_at = old; // memory DB rows are live objects: age the command past the 60 s window
  assert.equal((await rows(ctx))[0].issued_at, old);
  const again = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { temperature_c: 18, request_id: "req-abc" } },
  });
  assert.equal(again.data.results[0].deduped, true);
  assert.equal(again.data.results[0].command_id, first.data.results[0].command_id);
  const different = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { temperature_c: 19, request_id: "req-def" } },
  });
  assert.equal(different.data.results[0].deduped, false);
  assert.equal((await rows(ctx)).length, 2);
});

test("a profile apply sets the active grow profile and species on the card and device page", async () => {
  const { ctx, token } = await setup();
  await applyProfile(ctx, token);
  const detail = await call(ctx, "GET", "/api/fleet/devices/dev-1", { token });
  assert.equal(detail.data.device.profile.id, pearlOyster.id);
  assert.equal(detail.data.device.profile.species, pearlOyster.species);
  assert.equal(detail.data.device.stage.id, "fruiting");
  const list = await call(ctx, "GET", "/api/fleet/devices", { token });
  const card = list.data.devices.find((d) => d.id === "dev-1");
  assert.equal(card.profile.id, pearlOyster.id);
  assert.equal(card.profile.species, pearlOyster.species);
  assert.equal(card.stage.id, "fruiting");
});

test("with Autopilot steering, Start this grow still works and targets stay locked", async () => {
  const { ctx, token } = await setup("steer@example.com");
  await grantCoach(ctx, token);
  const on = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-1", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const res = await applyProfile(ctx, token);
  const r = res.data.results[0];
  assert.notEqual(r.status, "failed", JSON.stringify(r));
  assert.equal((await rows(ctx)).length, 1);
  const locked = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { temperature_c: 18 } },
  });
  assert.equal(locked.data.results[0].status, "failed");
  assert.match(locked.data.results[0].error, /coach is managing targets/i);
  assert.equal((await rows(ctx)).length, 1);
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-1", { token });
  assert.equal(status.data.mode, "autopilot");
  assert.notEqual(status.data.status, "paused");
});

test("command states: queued, delivered, applied by ack or readings, failed, expired", () => {
  const caps = deviceCapabilities(SL2_READING);
  const now = Date.parse("2026-10-25T20:00:00Z");
  const issued = "2026-10-25T19:14:08Z";
  const base = { id: 2, device_id: "d", kind: "setpoints", issued_at: issued, consumed_at: null };
  const pay = (p) => JSON.stringify({ temperature_c: 17, humidity_percent: 90, ...p });
  assert.equal(commandState({ ...base, payload: pay() }, { device: {}, caps, now }).status, "queued");
  assert.equal(
    commandState({ ...base, payload: pay() }, { device: { last_inbox_at: "2026-10-25T19:20:00Z" }, caps, now }).status,
    "delivered"
  );
  const acked = commandState(
    { ...base, consumed_at: issued, payload: pay({ _ack: { status: "applied", at: issued, via: "ack" } }) },
    { caps, now }
  );
  assert.equal(acked.status, "applied");
  const read = commandState(
    { ...base, consumed_at: issued, payload: pay({ _ack: { status: "applied", at: issued, via: "readings" } }) },
    { caps, now }
  );
  assert.equal(read.status, "applied");
  const failed = commandState(
    { ...base, consumed_at: issued, payload: pay({ _ack: { status: "failed", reason: "No setpoints.", at: issued } }) },
    { caps, now }
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason, "No setpoints.");
  const expired = commandState({ ...base, payload: pay() }, { caps, now: Date.parse(issued) + COMMAND_TTL_MS + 1000 });
  assert.equal(expired.status, "expired");
});

test("Mike's 12:14 profile commands read as not runnable on sl.2, never applied", () => {
  const caps = deviceCapabilities(SL2_READING);
  const cmd = {
    id: 2,
    device_id: "d",
    kind: "apply_profile",
    payload: JSON.stringify({ profile_id: "lions-mane", stage: "fruiting", source: "fleet", expires_at: "2026-10-26T19:14:08Z" }),
    issued_at: "2026-10-25T19:14:08Z",
    consumed_at: null,
  };
  const queued = commandState(cmd, { device: {}, caps, now: Date.parse("2026-10-25T19:30:00Z") });
  assert.equal(queued.status, "queued");
  assert.equal(queued.runnable, false);
  assert.match(queued.reason, /can't take profile changes yet/i);
  const delivered = commandState(cmd, { device: { last_inbox_at: "2026-10-25T19:31:00Z" }, caps, now: Date.parse("2026-10-25T19:32:00Z") });
  assert.equal(delivered.status, "delivered");
  const expired = commandState(cmd, { device: {}, caps, now: Date.parse("2026-10-26T19:15:00Z") });
  assert.equal(expired.status, "expired");
  assert.match(expired.reason, /expired unused/i);
});

// What 1.0.5-sl.1 sends: knob values, ranges, and capability tokens.
const SL5_READING = {
  ...SL2_READING,
  firmware_version: "1.0.5-sl.1",
  air_exchange_speed: 30,
  air_exchange_period_min: 20,
  air_exchange_run_sec: 60,
  sunrise_hour: 8,
  light_hours: 0,
  white_intensity: 0,
  color_r: 0,
  color_g: 0,
  color_b: 0,
  grow_day: 3,
  grow_phase: "Colonizing",
  ranges: { air_exchange_speed: [15, 100, 5], white_intensity: [0, 4000, 5], light_hours: [0, 24, 0.25] },
  capabilities: [
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
  ],
};

async function setupSl5(email) {
  const s = await setup(email);
  await s.ctx.db.run("DELETE FROM device_telemetry WHERE device_id=?", ["dev-1"]);
  await addReading(s.ctx, "dev-1", SL5_READING);
  return s;
}

test("1.0.5-sl.1 capabilities turn on fan, air, light and stage controls", () => {
  const caps = deviceCapabilities(SL5_READING);
  assert.equal(caps.firmware, "1.0.5-sl.1");
  assert.equal(caps.multi, true);
  const c = controlSupport(caps);
  for (const key of ["fan", "air", "light", "stage"]) assert.equal(c[key].supported, true, key);
  assert.equal(c.profile.mode, "full");
  assert.equal(deviceCapabilities(SL5_READING, "some_other_box").list.length, 10, "reported caps win for any type");
  assert.deepEqual(deviceCapabilities({}, "some_other_box").list, [], "unknown types assume nothing");
});

test("profile apply on 1.0.5 sends the whole stage in one setpoints command", async () => {
  const { ctx, token } = await setupSl5("full@example.com");
  const res = await applyProfile(ctx, token);
  const r = res.data.results[0];
  assert.equal(r.status, "queued", JSON.stringify(res.data));
  assert.match(r.message, /whole phase/);
  const all = await rows(ctx);
  assert.equal(all.length, 1);
  const p = JSON.parse(all[0].payload);
  assert.equal(all[0].kind, "setpoints");
  assert.equal(p.temperature_c, fruiting.temperature_c);
  assert.equal(p.humidity_percent, fruiting.humidity_percent);
  assert.equal(p.fan_speed_percent, undefined, "never the key the firmware ignores");
  assert.equal(p.air_exchange_speed, Math.round(fruiting.fan.speed_percent / 5) * 5);
  assert.equal(p.air_exchange_period_min, fruiting.fan.period_min);
  assert.equal(p.air_exchange_run_sec, Math.round(fruiting.fan.run_duration_s / 5) * 5);
  for (const key of ["sunrise_hour", "light_hours", "white_intensity", "color_r", "color_g", "color_b"]) assert.notEqual(p[key], undefined, key);
  assert.ok(p.light_hours > 0);
  assert.equal(p.grow_phase, "Fruiting");
  // A new grow starts the chamber on the first grow day of fruiting, counted from 1 like the
  // chamber (its grow_day setter treats the value as day N and ignores 0).
  const before = pearlOyster.stages.slice(0, pearlOyster.stages.findIndex((s) => s.id === "fruiting")).reduce((sum, s) => sum + s.duration_days, 0);
  assert.equal(p.grow_day, before + 1);
});

test("light from the site: white % becomes lux, a lit light never goes out with 0 hours", async () => {
  const { ctx, token } = await setupSl5("light@example.com");
  const res = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { light: { white_percent: 50, red_percent: 10 } } },
  });
  assert.equal(res.data.results[0].status, "queued", JSON.stringify(res.data));
  const p = JSON.parse((await rows(ctx))[0].payload);
  assert.equal(p.white_intensity, 2000, "50% of 4000 lux");
  assert.equal(p.color_r, 10);
  assert.equal(p.color_g, 0);
  assert.equal(p.sunrise_hour, 8);
  assert.equal(p.light_hours, 12, "chamber had 0 h; the light is on, so 12 h");
  const capped = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "setpoints", payload: { white_intensity: 9000, air_exchange_period_min: 999, air_exchange_run_sec: 33 } },
  });
  assert.equal(capped.data.results[0].status, "queued", JSON.stringify(capped.data));
  const q = JSON.parse((await rows(ctx))[1].payload);
  assert.equal(q.white_intensity, 4000);
  assert.equal(q.air_exchange_period_min, 240);
  assert.equal(q.air_exchange_run_sec, 35);
});

test("stage action sets the chamber phase and day; bad values are refused", async () => {
  const { ctx, token } = await setupSl5("stage@example.com");
  const ok = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "stage", payload: { grow_phase: "pinning", grow_day: 14 } },
  });
  assert.equal(ok.data.results[0].status, "queued", JSON.stringify(ok.data));
  const p = JSON.parse((await rows(ctx))[0].payload);
  assert.equal(p.grow_phase, "Pinning");
  assert.equal(p.grow_day, 14);
  const bad = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", { token, body: { action: "stage", payload: { grow_phase: "Sleeping" } } });
  assert.equal(bad.data.results[0].status, "failed");
  const sl2 = await setup("stage-sl2@example.com");
  const old = await call(sl2.ctx, "POST", "/api/fleet/devices/dev-1/apply", { token: sl2.token, body: { action: "stage", payload: { grow_day: 4 } } });
  assert.equal(old.data.results[0].status, "failed");
  assert.equal((await rows(sl2.ctx)).length, 0);
});

test("a reading confirms a knob command only when every knob matches", () => {
  const caps = deviceCapabilities(SL5_READING);
  const target = { temperature_c: 20, air_exchange_speed: 40, light_hours: 12, grow_phase: "Fruiting" };
  const reading = { temperature_setpoint: 20, air_exchange_speed: 40, light_hours: 12, grow_phase: "Fruiting" };
  assert.equal(caps.multi, true);
  return import("../src/device-capabilities.js").then(({ readingMatchesTargets }) => {
    assert.equal(readingMatchesTargets(reading, target), true);
    assert.equal(readingMatchesTargets({ ...reading, air_exchange_speed: 30 }, target), false);
    assert.equal(readingMatchesTargets({ ...reading, grow_phase: "Pinning" }, target), false);
    assert.equal(readingMatchesTargets(reading, {}), false);
  });
});

test("device payload exposes chamber knobs, light in lux and %, and drops the air local-only note", async () => {
  const { ctx, token } = await setupSl5("detail@example.com");
  const d = (await call(ctx, "GET", "/api/fleet/devices/dev-1", { token })).data.device;
  assert.equal(d.chamber.air_exchange_period_min, 20);
  assert.equal(d.chamber.grow_phase, "Colonizing");
  assert.equal(d.chamber_light.white_led_lux, 0);
  assert.equal(d.controls.air.supported, true);
  assert.ok(!d.local_only.some((c) => c.id === "air_period"));
  assert.deepEqual(d.capabilities.knob_ranges.white_intensity, [0, 4000, 5]);
  assert.ok(d.cloud_controls.find((c) => c.id === "stage").supported);
});

const colonization = pearlOyster.stages.find((s) => s.id === "colonization");

const LYKYN_READING = {
  temperature: 18.7,
  humidity: 86.83,
  temperature_c: 18.7,
  humidity_percent: 86.83,
  temperature_setpoint: 16,
  humidity_setpoint: 90,
  temperature_target_min: 15,
  temperature_target_max: 35,
  target_humidity_min: 30,
  target_humidity_max: 100,
  firmware_version: "0.2.0",
  device_type: "lykyn_chamber",
  model: "Lykyn",
  air_exchange_speed: 50,
  air_exchange_period_min: 10,
  air_exchange_run_sec: 40,
  sunrise_hour: 8,
  light_hours: 12,
  white_intensity: 20,
  color_r: 0,
  color_g: 0,
  color_b: 80,
  grow_phase: "Fruiting",
  ranges: {
    air_exchange_speed: [33, 100, 1],
    air_exchange_period_min: [1, 240, 1],
    air_exchange_run_sec: [5, 600, 5],
    sunrise_hour: [0, 23, 1],
    light_hours: [0, 24, 1],
    white_intensity: [0, 100, 0.1],
    color_r: [0, 100, 1],
    color_g: [0, 100, 1],
    color_b: [0, 100, 1],
  },
  capabilities: [
    "setpoints.temperature",
    "setpoints.humidity",
    "setpoints.multi",
    "ack.refused",
    "setpoints.fan",
    "air.schedule",
    "light.schedule",
    "light.color",
    "grow.phase",
  ],
};

async function setupLykyn(email) {
  const s = await setup(email);
  await s.ctx.db.run("UPDATE cloud_devices SET device_type=? WHERE id=?", ["lykyn_chamber", "dev-1"]);
  await s.ctx.db.run("DELETE FROM device_telemetry WHERE device_id=?", ["dev-1"]);
  await addReading(s.ctx, "dev-1", LYKYN_READING);
  return s;
}

test("Shrooly colonization apply still lands Colonizing with the colonization recipe", async () => {
  const { ctx, token } = await setupSl5("colo-shrooly@example.com");
  const res = await applyProfile(ctx, token, { stage: "colonization" });
  const r = res.data.results[0];
  assert.equal(r.status, "queued", JSON.stringify(res.data));
  const p = JSON.parse((await rows(ctx))[0].payload);
  assert.equal(p.grow_phase, "Colonizing");
  assert.equal(p.temperature_c, colonization.temperature_c);
  assert.equal(p.humidity_percent, colonization.humidity_percent);
  assert.equal(p.air_exchange_speed, colonization.fan.speed_percent);
  assert.equal(p.air_exchange_period_min, colonization.fan.period_min);
  assert.equal(p.light_hours, 0);
  assert.equal(p.white_intensity, 0);
});

test("Lykyn colonization apply lands Colonization, clamps fan to 33, and leaves lights off", async () => {
  const { ctx, token } = await setupLykyn("colo-lykyn@example.com");
  const res = await applyProfile(ctx, token, { stage: "colonization" });
  const r = res.data.results[0];
  assert.equal(r.status, "queued", JSON.stringify(res.data));
  const p = JSON.parse((await rows(ctx))[0].payload);
  assert.equal(p.grow_phase, "Colonization");
  assert.equal(p.temperature_c, colonization.temperature_c);
  assert.equal(p.humidity_percent, colonization.humidity_percent);
  assert.equal(p.air_exchange_speed, 33, "profile 20 is below the Lykyn fan minimum");
  assert.equal(p.air_exchange_period_min, colonization.fan.period_min);
  assert.equal(p.air_exchange_run_sec, colonization.fan.run_duration_s);
  assert.equal(p.light_hours, 0);
  assert.equal(p.white_intensity, 0);
});

test("Lykyn fruiting apply converts 92 lux to percent and accepts a Colonization stage name", async () => {
  const { ctx, token } = await setupLykyn("fruit-lykyn@example.com");
  const res = await applyProfile(ctx, token);
  assert.equal(res.data.results[0].status, "queued", JSON.stringify(res.data));
  const p = JSON.parse((await rows(ctx))[0].payload);
  assert.equal(p.grow_phase, "Fruiting");
  assert.equal(p.white_intensity, 2.3, "92 lux is 2.3% of the maximum");
  assert.equal(p.light_hours, fruiting.light.duration_hours);
  const stage = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "stage", payload: { grow_phase: "Colonization" } },
  });
  assert.equal(stage.data.results[0].status, "queued", JSON.stringify(stage.data));
  const q = JSON.parse((await rows(ctx))[1].payload);
  assert.equal(q.grow_phase, "Colonization");
  assert.equal(q.stage, "colonization");
  assert.equal(q.profile_id, pearlOyster.id);
  assert.equal(q.temperature_c, colonization.temperature_c);
  assert.equal(q.humidity_percent, colonization.humidity_percent);
  assert.equal(q.air_exchange_speed, 33, "profile 20 clamps to the Lykyn fan minimum");
  assert.equal(q.air_exchange_period_min, colonization.fan.period_min);
  assert.equal(q.air_exchange_run_sec, colonization.fan.run_duration_s);
  assert.equal(q.light_hours, 0);
  assert.equal(q.white_intensity, 0);
  assert.equal("grow_day" in q, false, "picking a stage must not reset the start date");
  assert.equal(q.translated_from, "stage");
});


// ---- Coach stage tracking, Start this grow under Coach, light percent ----

async function addCommand(ctx, id, { kind = "setpoints", payload, issued, consumed = issued }) {
  await ctx.db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    kind,
    JSON.stringify(payload),
    issued,
    consumed,
  ]);
}

const ACKED = (status = "applied") => ({ _ack: { status, reason: "ok", at: nowIso() } });
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

async function coachOn(ctx, token, user) {
  await grantCoach(ctx, token);
  const on = await setDeviceAutopilotMode(ctx.db, ctx, user, { deviceId: "dev-1", mode: "autopilot", profileId: pearlOyster.id });
  assert.equal(on.ok, true, JSON.stringify(on));
}

async function runCoach(ctx, user) {
  return runAutopilotForDevice(ctx.db, ctx, { device: await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-1"]), user });
}

function coachRows(ctx) {
  return rows(ctx).then((all) => all.filter((r) => JSON.parse(r.payload).source === "grow-coach-autopilot"));
}

// The real sequence: a failed Colonization apply, Coach steering Fruiting because the chamber said
// Fruiting, then the grower sets the chamber phase to Colonization by hand with Coach off.
async function colonizationHistory(ctx, { phase, colonizationPhase }) {
  await addCommand(ctx, "dev-1", {
    payload: { stage: "colonization", profile_id: pearlOyster.id, source: "fleet", grow_phase: "Colonizing", ...ACKED("failed") },
    issued: minutesAgo(300),
  });
  for (let i = 0; i < 3; i += 1) {
    await addCommand(ctx, "dev-1", {
      payload: { stage: "fruiting", profile_id: pearlOyster.id, source: "grow-coach-autopilot", approved: true, ...ACKED() },
      issued: minutesAgo(200 - i * 30),
    });
  }
  await addCommand(ctx, "dev-1", {
    payload: { grow_phase: colonizationPhase, source: "fleet", ...ACKED() },
    issued: minutesAgo(20),
  });
  assert.ok(phase);
}

test("Lykyn: Coach keeps steering Colonization after a manual phase change, not Fruiting", async () => {
  const { ctx, token, user } = await setupLykyn("stage-lykyn@example.com");
  await colonizationHistory(ctx, { phase: "Colonization", colonizationPhase: "Colonization" });
  await ctx.db.run("DELETE FROM device_telemetry WHERE device_id=?", ["dev-1"]);
  await addReading(ctx, "dev-1", {
    ...LYKYN_READING,
    grow_phase: "Colonization",
    temperature: 22,
    temperature_c: 22,
    temperature_setpoint: 24,
    humidity: 90,
    humidity_percent: 90,
    humidity_setpoint: 90,
    air_exchange_speed: 33,
    air_exchange_period_min: 60,
    air_exchange_run_sec: 15,
    light_hours: 12,
    white_intensity: 20,
    color_b: 80,
  });
  const staged = await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id);
  assert.equal(staged.manualPhase, true, "the manual phase change is the grower's latest say");
  assert.equal(staged.stage, "colonization");
  await coachOn(ctx, token, user);
  const result = await runCoach(ctx, user);
  assert.notEqual(result.stage, "fruiting", JSON.stringify(result));
  const mine = await coachRows(ctx);
  for (const row of mine.slice(3)) {
    const p = JSON.parse(row.payload);
    assert.equal(p.stage, "colonization", row.payload);
    assert.ok(!p.grow_phase || p.grow_phase === "Colonization", row.payload);
    assert.equal(p.light_hours, 0, "colonization keeps the light off");
  }
  assert.ok(mine.length >= 4, "Coach corrected the lights for colonization");
});

test("Coach steers Colonization as soon as the grower queues that phase, even if the chamber still says Fruiting", async () => {
  const { ctx, token, user } = await setupLykyn("queued-colo@example.com");
  await addCommand(ctx, "dev-1", {
    kind: "setpoints",
    payload: { grow_phase: "Colonization", source: "fleet" },
    issued: minutesAgo(2),
    consumed: null,
  });
  await ctx.db.run("DELETE FROM device_telemetry WHERE device_id=?", ["dev-1"]);
  await addReading(ctx, "dev-1", {
    ...LYKYN_READING,
    grow_phase: "Fruiting",
    temperature_setpoint: 23,
    humidity_setpoint: 90,
    air_exchange_speed: 50,
    light_hours: 12,
    white_intensity: 28,
  });
  const staged = await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id);
  assert.equal(staged.stage, "colonization");
  await coachOn(ctx, token, user);
  const result = await runCoach(ctx, user);
  assert.notEqual(result.stage, "fruiting", JSON.stringify(result));
  for (const row of await coachRows(ctx)) {
    const p = JSON.parse(row.payload);
    assert.equal(p.stage, "colonization", row.payload);
    assert.equal(p.light_hours, 0, "colonization keeps the light off");
  }
});

test("Shrooly: Coach keeps steering Colonizing after a manual phase change, not Fruiting", async () => {
  const { ctx, token, user } = await setupSl5("stage-shrooly@example.com");
  await colonizationHistory(ctx, { phase: "Colonizing", colonizationPhase: "Colonizing" });
  await ctx.db.run("DELETE FROM device_telemetry WHERE device_id=?", ["dev-1"]);
  await addReading(ctx, "dev-1", {
    ...SL5_READING,
    grow_phase: "Colonizing",
    grow_day: 3,
    humidity: 90,
    humidity_percent: 90,
    humidity_setpoint: 90,
    temperature: 24,
    temperature_c: 24,
    temperature_setpoint: 24,
    light_hours: 12,
    white_intensity: 92,
    color_b: 80,
  });
  await coachOn(ctx, token, user);
  const result = await runCoach(ctx, user);
  assert.notEqual(result.stage, "fruiting", JSON.stringify(result));
  const mine = await coachRows(ctx);
  for (const row of mine.slice(3)) {
    const p = JSON.parse(row.payload);
    assert.equal(p.stage, "colonization", row.payload);
    assert.ok(!p.grow_phase || p.grow_phase === "Colonizing", row.payload);
  }
  assert.ok(mine.length >= 4, "Coach corrected the lights for colonization");
});

test("Coach's own commands are not the grower's stage choice, and a newer manual phase beats an older stage", async () => {
  const { ctx } = await setup("stage-order@example.com");
  await addCommand(ctx, "dev-1", {
    payload: { stage: "fruiting", profile_id: pearlOyster.id, source: "grow-coach-autopilot", ...ACKED() },
    issued: minutesAgo(60),
  });
  assert.equal(await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id), null);
  await addCommand(ctx, "dev-1", {
    payload: { stage: "fruiting", profile_id: pearlOyster.id, source: "fleet", ...ACKED() },
    issued: minutesAgo(50),
  });
  assert.equal((await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id)).stage, "fruiting");
  await addCommand(ctx, "dev-1", { payload: { grow_phase: "Colonizing", source: "fleet", ...ACKED("failed") }, issued: minutesAgo(40) });
  assert.equal((await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id)).stage, "fruiting", "a failed phase change changed nothing");
  await addCommand(ctx, "dev-1", { payload: { grow_phase: "Colonizing", source: "fleet", ...ACKED() }, issued: minutesAgo(30) });
  const last = await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id);
  assert.equal(last.manualPhase, true);
  assert.equal(last.stage, "colonization");
});

test("Start this grow with Coach on sets the grow and Coach steers that stage (Lykyn and Shrooly)", async () => {
  for (const [label, setupFn, phase] of [
    ["lykyn", setupLykyn, "Colonization"],
    ["shrooly", setupSl5, "Colonizing"],
  ]) {
    const { ctx, token, user } = await setupFn(`start-${label}@example.com`);
    await coachOn(ctx, token, user);
    const res = await applyProfile(ctx, token, { stage: "colonization" });
    const r = res.data.results[0];
    assert.equal(r.status, "queued", JSON.stringify(res.data));
    const p = JSON.parse((await rows(ctx))[0].payload);
    assert.equal(p.stage, "colonization");
    assert.equal(p.grow_phase, phase);
    assert.equal(p.light_hours, 0);
    const mode = await ctx.db.one("SELECT * FROM coach_device_mode WHERE device_id=?", ["dev-1"]);
    assert.equal(mode.mode, "autopilot", "Coach stays on");
    assert.equal(mode.profile_id, pearlOyster.id);
    const staged = await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id);
    assert.equal(staged.stage, "colonization");
    // The chamber takes it and reports back; Coach then keeps steering colonization.
    await ctx.db.run("UPDATE device_commands SET consumed_at=? WHERE device_id=?", [nowIso(), "dev-1"]);
    await ctx.db.run("DELETE FROM device_telemetry WHERE device_id=?", ["dev-1"]);
    await addReading(ctx, "dev-1", {
      ...(label === "lykyn" ? LYKYN_READING : SL5_READING),
      grow_phase: phase,
      light_hours: 12,
    });
    const run = await runCoach(ctx, user);
    assert.notEqual(run.stage, "fruiting", JSON.stringify(run));
    for (const row of await coachRows(ctx)) assert.equal(JSON.parse(row.payload).stage, "colonization");
  }
});

const lightApply = (ctx, token, light) =>
  call(ctx, "POST", "/api/fleet/devices/dev-1/apply", {
    token,
    body: { action: "light", payload: { light: { sunrise_hour: 8, duration_hours: 12, red_percent: 0, green_percent: 0, blue_percent: 80, ...light } } },
  });

test("Lykyn light goes out as a percent with no lux round trip, including white 79 to 100", async () => {
  const { ctx, token } = await setupLykyn("white-lykyn@example.com");
  for (const white of [0, 20, 50, 78, 79, 85, 90, 99, 100]) {
    const res = await lightApply(ctx, token, { white_percent: white });
    assert.equal(res.data.results[0].status, "queued", JSON.stringify(res.data));
    const all = await rows(ctx);
    const p = JSON.parse(all[all.length - 1].payload);
    assert.equal(p.white_intensity, white, `white ${white}`);
    assert.equal(p.color_b, 80);
    await ctx.db.run("UPDATE device_commands SET consumed_at=? WHERE device_id=?", [nowIso(), "dev-1"]);
  }
});

test("Lykyn light still converts a recipe in lux, and Shrooly keeps its lux behavior", async () => {
  const lykyn = await setupLykyn("white-recipe@example.com");
  const a = await lightApply(lykyn.ctx, lykyn.token, { white_led_lux: 92 });
  assert.equal(a.data.results[0].status, "queued", JSON.stringify(a.data));
  assert.equal(JSON.parse((await rows(lykyn.ctx))[0].payload).white_intensity, 2.3);
  const shrooly = await setupSl5("white-shrooly@example.com");
  const b = await lightApply(shrooly.ctx, shrooly.token, { white_percent: 50 });
  assert.equal(b.data.results[0].status, "queued", JSON.stringify(b.data));
  assert.equal(JSON.parse((await rows(shrooly.ctx))[0].payload).white_intensity, 2000, "Shrooly still sends lux");
  const c = await lightApply(shrooly.ctx, shrooly.token, { white_led_lux: 400 });
  assert.equal(c.data.results[0].status, "queued", JSON.stringify(c.data));
  const all = await rows(shrooly.ctx);
  assert.equal(JSON.parse(all[all.length - 1].payload).white_intensity, 400);
});

test("validateStageLight keeps white_percent and rejects out of range", () => {
  const ok = validateStageLight({ sunrise_hour: 8, duration_hours: 12, white_percent: 95, red_percent: 0, green_percent: 0, blue_percent: 0 });
  assert.equal(ok.white_percent, 95);
  assert.throws(() => validateStageLight({ sunrise_hour: 8, duration_hours: 12, white_percent: 101 }), /white/i);
  assert.throws(() => validateStageLight({ sunrise_hour: 8, duration_hours: 0, white_percent: 20 }), /duration/i);
  assert.equal("white_percent" in validateStageLight({ sunrise_hour: 8, duration_hours: 12, white_led_lux: 92 }), false);
});

test("command summaries say white in percent on every chamber", () => {
  const payload = { light_hours: 12, sunrise_hour: 8, white_intensity: 40, color_r: 0, color_g: 0, color_b: 80 };
  const lykyn = deviceCapabilities(LYKYN_READING);
  assert.match(commandState({ id: 1, kind: "setpoints", payload: JSON.stringify(payload), issued_at: nowIso(), consumed_at: null }, { caps: lykyn }).summary, /white 40%/);
  const shrooly = deviceCapabilities(SL5_READING);
  assert.match(commandState({ id: 1, kind: "setpoints", payload: JSON.stringify(payload), issued_at: nowIso(), consumed_at: null }, { caps: shrooly }).summary, /white 1%/, "40 lux is 1 percent of the 4000 lux maximum");
  // The same light, in each chamber's own unit, reads the same.
  const same = (caps, raw) => commandState({ id: 1, kind: "setpoints", payload: JSON.stringify({ ...payload, white_intensity: raw }), issued_at: nowIso(), consumed_at: null }, { caps }).summary;
  assert.equal(same(shrooly, 92), same(lykyn, 2.3));
  assert.doesNotMatch(same(shrooly, 92), /lux/);
});

test("white converts to percent and back inside the adapter, exactly, all the way to 100", () => {
  const shrooly = deviceAdapter("shrooly_chamber").white;
  const lykyn = deviceAdapter("lykyn_chamber").white;
  for (let tenth = 0; tenth <= 1000; tenth += 1) {
    const pct = tenth / 10;
    assert.equal(shrooly.toPercent(shrooly.fromPercent(pct)), pct, `${pct}%`);
    assert.equal(lykyn.toPercent(lykyn.fromPercent(pct)), pct);
  }
  for (let lux = 0; lux <= 4000; lux += 5) assert.equal(shrooly.fromPercent(shrooly.toPercent(lux)), lux, `${lux} lux`);
  assert.equal(shrooly.fromPercent(100), 4000, "100% is the chamber maximum, with no cap below it");
  assert.equal(shrooly.fromPercent(78), 3120);
  assert.equal(shrooly.toPercent(4000), 100);
  assert.equal(lykyn.fromPercent(100), 100);
  assert.equal(shrooly.percentFromRecipeLux(150), lykyn.percentFromRecipeLux(150));
  assert.equal(shrooly.percentFromRecipeLux(92), 2.3);
});


// ---- Same Coach, same decisions, on every chamber type ----
//
// The same grow situation is set up on a Shrooly and on a Lykyn, each in its own words (Colonizing
// against Colonization, white in lux against percent). Whatever Coach and the apply path decide must
// match once the commands are read back through the adapter. Coach has no device-type branch, so any
// difference here is a leak.

const FIXTURES = [
  { name: "Shrooly", type: "shrooly_chamber", setup: setupSl5, base: SL5_READING, white: 92 },
  { name: "Lykyn", type: "lykyn_chamber", setup: setupLykyn, base: LYKYN_READING, white: 2.3 },
];
const FAN_FLOOR = 33; // the strictest chamber's minimum: below it both chambers end up at the floor
const WHITE_STEP = 0.125; // the Shrooly takes white in 5 lux steps, which is 0.125 percent
const FAN_STEP = 5; // the coarsest chamber's step: the chambers snap a fan figure to their own step

function canonicalCommand(adapter, p) {
  const out = {
    stage: p.stage ?? null,
    phase: p.grow_phase ? adapter.stage(p.grow_phase) : null,
    temperature_c: p.temperature_c ?? null,
    humidity_percent: p.humidity_percent ?? null,
    fan: p.air_exchange_speed == null ? null : Math.round(Math.max(p.air_exchange_speed, FAN_FLOOR) / FAN_STEP) * FAN_STEP,
    period: p.air_exchange_period_min ?? null,
    run: p.air_exchange_run_sec ?? null,
    light_hours: p.light_hours ?? null,
    white_percent: p.white_intensity == null ? null : Math.round(adapter.white.toPercent(p.white_intensity) / WHITE_STEP) * WHITE_STEP,
    rgb: ["color_r", "color_g", "color_b"].map((k) => p[k] ?? null),
  };
  return out;
}

async function reportReading(ctx, fx, phaseStage, extra = {}) {
  const adapter = deviceAdapter(fx.type);
  await ctx.db.run("DELETE FROM device_telemetry WHERE device_id=?", ["dev-1"]);
  await addReading(ctx, "dev-1", {
    ...fx.base,
    grow_phase: adapter.nativePhase(phaseStage),
    grow_day: 3,
    temperature: 22,
    temperature_c: 22,
    temperature_setpoint: 24,
    humidity: 90,
    humidity_percent: 90,
    humidity_setpoint: 90,
    air_exchange_speed: FAN_FLOOR,
    air_exchange_period_min: 60,
    air_exchange_run_sec: 15,
    light_hours: 12,
    white_intensity: fx.white,
    color_b: 80,
    ...extra,
  });
}

test("adapters name the same four stages and hide each chamber's own words", () => {
  const shrooly = deviceAdapter("shrooly_chamber");
  const lykyn = deviceAdapter("lykyn_chamber");
  assert.deepEqual(CANONICAL_STAGES, ["Colonization", "Pinning", "Fruiting", "Custom"]);
  assert.equal(shrooly.nativePhase("Colonization"), "Colonizing");
  assert.equal(lykyn.nativePhase("Colonization"), "Colonization");
  assert.equal(shrooly.nativePhase("Colonizing"), "Colonizing");
  assert.equal(lykyn.nativePhase("Colonizing"), "Colonization");
  assert.equal(shrooly.nativePhase("Custom"), null);
  assert.equal(lykyn.nativePhase("Custom"), "Custom");
  assert.equal(lykyn.nativePhase("Harvest"), null, "Lykyn has no Harvest phase");
  assert.equal(shrooly.stage("Colonizing"), "Colonization");
  assert.equal(lykyn.stage("Colonization"), "Colonization");
  assert.equal(shrooly.white.fromPercent(2.3), 92);
  assert.equal(lykyn.white.fromPercent(2.3), 2.3);
  assert.equal(shrooly.white.toPercent(92), 2.3);
  assert.equal(lykyn.white.describe(2.3), "white 2.3%");
  assert.equal(shrooly.white.describe(92), "white 2.3%", "a lux chamber is described in percent too");
  assert.deepEqual(lykyn.knobRanges.air_exchange_speed, [33, 100, 1]);
  assert.equal(deviceCapabilities({}, "lykyn_chamber").knob_ranges.air_exchange_speed[0], 33, "fan floor before the chamber reports");
  assert.equal(deviceCapabilities({}, "lykyn_chamber").knob_ranges.white_intensity[1], 100);
  assert.equal(deviceCapabilities({}, "shrooly_chamber").knob_ranges.air_exchange_speed[0], 15);
});

test("Lykyn takes Custom from the site, a Shrooly says it has no such phase", async () => {
  for (const fx of FIXTURES) {
    const { ctx, token } = await fx.setup(`custom-${fx.type}@example.com`);
    const res = await call(ctx, "POST", "/api/fleet/devices/dev-1/apply", { token, body: { action: "stage", payload: { grow_phase: "Custom" } } });
    const r = res.data.results[0];
    if (fx.type === "lykyn_chamber") {
      assert.equal(r.status, "queued", JSON.stringify(res.data));
      const p = JSON.parse((await rows(ctx))[0].payload);
      assert.equal(p.grow_phase, "Custom");
      assert.equal(p.temperature_c, undefined, "Custom has no profile recipe");
      assert.equal(p.translated_from, undefined);
    } else {
      assert.equal(r.status, "failed", JSON.stringify(res.data));
    }
  }
});

test("Start this grow at Colonization and at Fruiting sends the same commands on both chambers", async () => {
  for (const stage of ["colonization", "pinning", "fruiting"]) {
    const seen = [];
    for (const fx of FIXTURES) {
      const { ctx, token } = await fx.setup(`apply-${stage}-${fx.type}@example.com`);
      const res = await applyProfile(ctx, token, { stage });
      assert.equal(res.data.results[0].status, "queued", `${fx.name} ${stage} ${JSON.stringify(res.data)}`);
      seen.push(canonicalCommand(deviceAdapter(fx.type), JSON.parse((await rows(ctx))[0].payload)));
    }
    assert.deepEqual(seen[0], seen[1], `${stage}: Shrooly and Lykyn must get the same command`);
  }
});

test("Coach makes the same decisions on both chambers after a manual Colonization", async () => {
  const seen = [];
  for (const fx of FIXTURES) {
    const { ctx, token, user } = await fx.setup(`parity-colo-${fx.type}@example.com`);
    const adapter = deviceAdapter(fx.type);
    await colonizationHistory(ctx, { phase: adapter.nativePhase("Colonization"), colonizationPhase: adapter.nativePhase("Colonization") });
    await reportReading(ctx, fx, "Colonization");
    const staged = await latestStagedCommand(ctx.db, "dev-1", pearlOyster.id);
    await coachOn(ctx, token, user);
    const result = await runCoach(ctx, user);
    const mine = (await coachRows(ctx)).slice(3).map((r) => canonicalCommand(adapter, JSON.parse(r.payload)));
    seen.push({ manualPhase: staged.manualPhase, stage: staged.stage, picked: result.stage, mine });
  }
  assert.equal(seen[0].manualPhase, true);
  assert.notEqual(seen[0].picked, "fruiting");
  assert.deepEqual(seen[0], seen[1]);
  assert.ok(seen[0].mine.length >= 1, "Coach corrected the lights for colonization on both");
});

test("Coach makes the same decisions on both chambers when the grower is already at Fruiting", async () => {
  const seen = [];
  for (const fx of FIXTURES) {
    const { ctx, token, user } = await fx.setup(`parity-fruit-${fx.type}@example.com`);
    const adapter = deviceAdapter(fx.type);
    await addCommand(ctx, "dev-1", {
      payload: { stage: "fruiting", profile_id: pearlOyster.id, source: "fleet", ...ACKED() },
      issued: minutesAgo(90),
    });
    await reportReading(ctx, fx, "Fruiting", { light_hours: 0, white_intensity: 0, color_b: 0 });
    await coachOn(ctx, token, user);
    const result = await runCoach(ctx, user);
    const mine = (await coachRows(ctx)).map((r) => canonicalCommand(adapter, JSON.parse(r.payload)));
    seen.push({ picked: result.stage, mine });
  }
  assert.equal(seen[0].picked, "fruiting");
  assert.deepEqual(seen[0], seen[1]);
});

test("Coach never steps the humidity target off the profile, on either chamber", async () => {
  const fruiting = pearlOyster.stages.find((s) => s.id === "colonization");
  const seen = [];
  for (const fx of FIXTURES) {
    const { ctx, token, user } = await fx.setup(`parity-rh-${fx.type}@example.com`);
    const adapter = deviceAdapter(fx.type);
    await addCommand(ctx, "dev-1", {
      payload: { stage: "colonization", profile_id: pearlOyster.id, source: "fleet", grow_phase: adapter.nativePhase("Colonization"), ...ACKED() },
      issued: minutesAgo(90),
    });
    await reportReading(ctx, fx, "Colonization", {
      humidity: 93,
      humidity_percent: 93,
      humidity_setpoint: 90,
      temperature: 24,
      temperature_c: 24,
      temperature_setpoint: 24,
      light_hours: 0,
      white_intensity: 0,
      color_b: 0,
    });
    await coachOn(ctx, token, user);
    const result = await runCoach(ctx, user);
    const mine = (await coachRows(ctx)).map((r) => JSON.parse(r.payload));
    for (const p of mine) {
      assert.equal(p.humidity_percent, fruiting.humidity_percent, `${fx.name} ${p.humidity_percent}`);
    }
    if (result.next && result.next.humidity_percent != null) {
      assert.equal(result.next.humidity_percent, fruiting.humidity_percent, `${fx.name} next`);
    }
    seen.push({ picked: result.stage || result.skipped, name: fx.name });
  }
  assert.ok(seen.every((s) => s.picked === "colonization" || s.picked === "no_change" || s.picked === "pending"), JSON.stringify(seen));
});
