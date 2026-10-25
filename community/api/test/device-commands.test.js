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
  assert.match(light.data.results[0].error, /can't take light settings from the cloud/i);
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
  assert.match(r.message, /Autopilot now steers/i);
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
  assert.match(queued.reason, /can't run profile commands/i);
  const delivered = commandState(cmd, { device: { last_inbox_at: "2026-10-25T19:31:00Z" }, caps, now: Date.parse("2026-10-25T19:32:00Z") });
  assert.equal(delivered.status, "delivered");
  const expired = commandState(cmd, { device: {}, caps, now: Date.parse("2026-10-26T19:15:00Z") });
  assert.equal(expired.status, "expired");
  assert.match(expired.reason, /firmware/i);
});
