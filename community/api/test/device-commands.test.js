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

test("with Autopilot steering, a profile apply switches its target and sends nothing direct", async () => {
  const { ctx, token } = await setup("steer@example.com");
  await grantCoach(ctx, token);
  const on = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-1", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const before = (await rows(ctx)).length;
  const res = await applyProfile(ctx, token);
  const r = res.data.results[0];
  assert.equal(r.status, "applied");
  assert.match(r.message, /Coach now adjusts toward/i);
  assert.equal((await rows(ctx)).length, before);
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-1", { token });
  assert.equal(status.data.mode, "autopilot");
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
  assert.equal(p.white_intensity, 1165);
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
