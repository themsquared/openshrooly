import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import {
  AUTOPILOT_LIMITS,
  clampAutopilotSetpoints,
  coachAutopilotFlagOn,
  evaluateAutopilotPause,
  getDeviceMode,
  inferAutopilotApplyFromReading,
  limitAutopilotStep,
  noteAutopilotCommandAck,
  planAutopilotChange,
  reconcileAutopilotCommands,
  runAutopilotForDevice,
  runAutopilotPass,
  setDeviceAutopilotMode,
  setpointsMismatch,
} from "../src/coach-autopilot.js";
import { withBridgeResult } from "../src/coach-bridge.js";
import { suggestSetpoints } from "../src/coach-learn.js";
import { profileStageTargets } from "../src/coach.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);
const fruiting = profileStageTargets((pearlOyster.stages || []).find((s) => s.id === "fruiting") || pearlOyster.stages[0]);
const MIGRATION = readFileSync(new URL("../migrations/0007_coach_autopilot.sql", import.meta.url), "utf8");

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", COACH_AUTOPILOT_ENABLED: "1", ...extra });
}

async function subscribe(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(
    ctx,
    stripeCheckoutEvent({
      sessionId: session.data.id,
      itemId: session.data.item_id,
      userId: me.data.user.id,
    })
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
}

async function addDevice(ctx, userId, id, { status = "active", lastSeen = nowIso() } = {}) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", "Kitchen", status, userId, null, null, null, 1, lastSeen, nowIso()]
  );
}

async function addReading(ctx, deviceId, doc, createdAt = nowIso()) {
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    deviceId,
    JSON.stringify(doc),
    createdAt,
  ]);
}

async function addPublishedProfile(ctx, userId, profile = pearlOyster) {
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [profile.id, JSON.stringify(profile), userId, 1, nowIso(), nowIso()]
  );
}

function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

test("0007 migration is additive CREATE TABLE/INDEX only", () => {
  const body = MIGRATION.replace(/--.*$/gm, "").replace(/ON DELETE CASCADE/g, "");
  assert.doesNotMatch(body, /\b(DROP|ALTER|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  for (const s of statements(MIGRATION)) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  assert.match(MIGRATION, /coach_device_mode/);
  assert.match(MIGRATION, /coach_autopilot_log/);
});

test("kill switch defaults off and no-ops the loop", async () => {
  assert.equal(coachAutopilotFlagOn({}), false);
  assert.equal(coachAutopilotFlagOn({ COACH_AUTOPILOT_ENABLED: "0" }), false);
  assert.equal(coachAutopilotFlagOn({ COACH_AUTOPILOT_ENABLED: "1" }), true);
  const out = await runAutopilotPass(testEnv({ GROW_COACH_STUB: "1" }));
  assert.equal(out.skipped, "kill_switch");
  assert.equal(out.ran, 0);
});

test("clamp stays inside the profile stage target and the global 10-32 C / 60-98% limits", () => {
  const clamped = clampAutopilotSetpoints({ temperature_c: 24, humidity_percent: 99, fan_speed_percent: 5 }, fruiting);
  assert.ok(clamped.temperature_c <= fruiting.temperature_target_max);
  assert.ok(clamped.temperature_c >= fruiting.temperature_target_min);
  assert.ok(clamped.temperature_c >= 10 && clamped.temperature_c <= 32);
  assert.ok(clamped.humidity_percent <= fruiting.humidity_target_max);
  assert.ok(clamped.humidity_percent >= 60 && clamped.humidity_percent <= 98);
  assert.equal(clamped.fan_speed_percent, 10);
  const floor = clampAutopilotSetpoints({ temperature_c: 4, humidity_percent: 10 }, { temperature_c: 8, humidity_percent: 50 });
  assert.equal(floor.temperature_c, 10);
  assert.equal(floor.humidity_percent, 60);
});

test("step limiter moves at most 1.0 C and 3% RH toward the target", () => {
  const next = limitAutopilotStep(
    { temperature_c: 24, humidity_percent: 80, fan_speed_percent: 30 },
    { temperature_c: 16, humidity_percent: 90, fan_speed_percent: 60 }
  );
  assert.equal(next.temperature_c, 23);
  assert.equal(next.humidity_percent, 83);
  assert.equal(next.fan_speed_percent, 40);
});

test("interval and daily cap block further changes", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const suggestion = { temperature_c: 16, humidity_percent: 88, fan_speed_percent: 30, reasons: ["Toward target."] };
  const current = { temperature_c: 24, humidity_percent: 80, fan_speed_percent: 30 };
  const interval = planAutopilotChange({
    suggestion,
    currentSetpoints: current,
    stage: fruiting,
    state: { last_change_at: "2026-10-25T11:30:00Z" },
    now,
  });
  assert.equal(interval.ok, false);
  assert.match(interval.reason, /minimum interval/i);
  assert.match(interval.reason, /Next eligible at 2026-10-25T12:30:00.000Z/);
  assert.equal(interval.next_eligible_at, "2026-10-25T12:30:00.000Z");
  const cap = planAutopilotChange({
    suggestion,
    currentSetpoints: current,
    stage: fruiting,
    state: { changes_day: "2026-10-25", changes_count: AUTOPILOT_LIMITS.dailyCap },
    now,
  });
  assert.equal(cap.ok, false);
  assert.match(cap.reason, /daily/i);
  assert.match(cap.reason, /Next eligible at 2026-10-26T00:00:00.000Z/);
  assert.equal(cap.next_eligible_at, "2026-10-26T00:00:00.000Z");
  const ok = planAutopilotChange({ suggestion, currentSetpoints: current, stage: fruiting, state: {}, now });
  assert.equal(ok.ok, true);
  assert.equal(ok.next.temperature_c, 23);
});

test("stale, missing, implausible, and offline readings pause Autopilot", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.match(evaluateAutopilotPause({ reading: null, now }).reason, /missing/i);
  assert.match(
    evaluateAutopilotPause({
      reading: { temperature: 22, humidity: 88, age_seconds: 21 * 60 },
      now,
    }).reason,
    /stale/i
  );
  assert.match(
    evaluateAutopilotPause({
      reading: { temperature: 80, humidity: 88, age_seconds: 10 },
      now,
    }).reason,
    /physical range/i
  );
  assert.match(
    evaluateAutopilotPause({
      reading: { temperature: 30, humidity: 88, age_seconds: 10 },
      previous: { temperature: 20, humidity: 88 },
      now,
    }).reason,
    /jumped/i
  );
  assert.match(
    evaluateAutopilotPause({
      reading: { temperature: 20, humidity: 88, age_seconds: 10 },
      device: { status: "claimed", last_seen_at: "2026-10-25T11:39:00Z" },
      now,
    }).reason,
    /offline/i
  );
  assert.equal(
    evaluateAutopilotPause({
      reading: { temperature: 20, humidity: 88, age_seconds: 10 },
      device: { status: "active", last_seen_at: "2026-10-25T11:55:00Z" },
      now,
    }).pause,
    false
  );
});

test("catalog hides Autopilot unless the kill switch is on", async () => {
  const off = env({ COACH_AUTOPILOT_ENABLED: "0" });
  const { token } = await register(off, "off@example.com");
  await subscribe(off, token);
  const hidden = await call(off, "GET", "/api/coach", { token });
  assert.deepEqual(hidden.data, { available: false });
  const ctx = env();
  const paid = await register(ctx, "on@example.com");
  await subscribe(ctx, paid.token);
  const shown = await call(ctx, "GET", "/api/coach", { token: paid.token });
  assert.equal(shown.data.autopilot, true);
});

test("kill switch returns 404 for GET, mode, run, and undo", async () => {
  const ctx = env({ COACH_AUTOPILOT_ENABLED: "0" });
  const { token, user } = await register(ctx, "kill@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-kill");
  const get = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-kill", { token });
  assert.equal(get.status, 404);
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-kill", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 404);
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-kill" } });
  assert.equal(run.status, 404);
  const undo = await call(ctx, "POST", "/api/coach/autopilot/undo", { token, body: { action_id: 1 } });
  assert.equal(undo.status, 404);
});

test("Off-menu profiles cannot enable Autopilot", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "psi@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-psi");
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      "psi-cube",
      JSON.stringify({ id: "psi-cube", pack: "psilocybin", restricted: true, tags: ["psilocybin"], stages: [] }),
      user.id,
      1,
      nowIso(),
      nowIso(),
    ]
  );
  const refused = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-psi", mode: "autopilot", profile_id: "psi-cube" },
  });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /off-menu/i);
});

test("Autopilot applies a stepped setpoint, logs it, and Undo restores the old value", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "auto@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-auto");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-auto", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-auto", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 200, JSON.stringify(mode.data));
  assert.equal(mode.data.mode, "autopilot");
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-auto" } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.applied, true);
  assert.equal(run.data.next.temperature_c, 23);
  assert.ok(run.data.next.temperature_c >= fruiting.temperature_target_max);
  const cmds = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-auto"]);
  assert.equal(cmds.length, 1);
  const payload = JSON.parse(cmds[0].payload);
  assert.equal(payload.source, "grow-coach-autopilot");
  assert.equal(payload.temperature_c, 23);
  const exp = Date.parse(payload.expires_at);
  assert.ok(Number.isFinite(exp));
  assert.ok(exp - Date.now() <= AUTOPILOT_LIMITS.commandTtlMs);
  assert.ok(exp - Date.now() > AUTOPILOT_LIMITS.commandTtlMs - 10_000);
  const apply = (run.data.actions || []).find((a) => a.action === "apply");
  assert.ok(apply);
  const undo = await call(ctx, "POST", "/api/coach/autopilot/undo", { token, body: { action_id: apply.id } });
  assert.equal(undo.status, 200, JSON.stringify(undo.data));
  assert.equal(undo.data.restored.temperature_c, fruiting.temperature_target_max);
  const after = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-auto"]);
  assert.equal(after.length, 2);
  assert.equal(JSON.parse(after[1].payload).source, "grow-coach-autopilot-undo");
  assert.equal(JSON.parse(after[1].payload).temperature_c, fruiting.temperature_target_max);
});

test("stale threshold is the heartbeat plus 5 minutes of drift", () => {
  assert.equal(AUTOPILOT_LIMITS.staleMs, 20 * 60 * 1000);
  const now = Date.parse("2026-10-25T12:00:00Z");
  const seen = (ageS) => ({ status: "active", last_seen_at: new Date(now - ageS * 1000).toISOString() });
  assert.equal(
    evaluateAutopilotPause({ reading: { temperature: 22, humidity: 88, age_seconds: 15 * 60 + 30 }, device: seen(15 * 60 + 30), now }).pause,
    false
  );
  const late = evaluateAutopilotPause({ reading: { temperature: 22, humidity: 88, age_seconds: 21 * 60 }, device: seen(10), now });
  assert.equal(late.pause, true);
  assert.match(late.reason, /older than 20 minutes/);
  assert.match(evaluateAutopilotPause({ reading: { temperature: 22, humidity: 88, age_seconds: 10 }, device: seen(21 * 60), now }).reason, /offline/i);
});

async function runWithReadingAge(email, deviceId, ageMs) {
  const ctx = env();
  const { token, user } = await register(ctx, email);
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, deviceId);
  await addPublishedProfile(ctx, user.id);
  const now = Date.now();
  const at = new Date(now - ageMs).toISOString();
  await addReading(ctx, deviceId, { humidity: 88, humidity_setpoint: 90, temperature: 20, temperature_setpoint: 20 }, at);
  const enabled = await setDeviceAutopilotMode(ctx.db, ctx, user, { deviceId, mode: "autopilot", profileId: pearlOyster.id });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  device.last_seen_at = at;
  const result = await runAutopilotForDevice(ctx.db, ctx, { device, user, now });
  const status = await call(ctx, "GET", `/api/coach/autopilot?device_id=${deviceId}`, { token });
  return { result, status };
}

test("readings 15 min 30 s old keep Autopilot active", async () => {
  const { result, status } = await runWithReadingAge("late-ok@example.com", "dev-late-ok", (15 * 60 + 30) * 1000);
  assert.notEqual(result.paused, true, JSON.stringify(result));
  assert.equal(status.data.mode, "autopilot");
  assert.notEqual(status.data.status, "paused");
});

test("readings 21 min old pause Autopilot to Advisor", async () => {
  const { result, status } = await runWithReadingAge("late-stale@example.com", "dev-late-stale", 21 * 60 * 1000);
  assert.equal(result.paused, true);
  assert.equal(result.flipped_to, "advisor");
  assert.match(result.reason, /stale|offline/i);
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
});

test("stale readings flip Autopilot back to Advisor with a visible reason", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "stale@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-stale");
  await addPublishedProfile(ctx, user.id);
  await addReading(
    ctx,
    "dev-stale",
    { humidity: 88, humidity_setpoint: 90, temperature: 20, temperature_setpoint: 20 },
    new Date(Date.now() - 25 * 60 * 1000).toISOString()
  );
  const enabled = await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-stale",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const result = await runAutopilotForDevice(ctx.db, ctx, {
    device: await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-stale"]),
    user,
  });
  assert.equal(result.paused, true);
  assert.equal(result.flipped_to, "advisor");
  assert.match(result.reason, /stale/i);
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-stale", { token });
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
  assert.match(status.data.pause_reason, /stale/i);
});

test("a manual setpoint change pauses Autopilot for 12 hours", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "manual@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-manual");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-manual", { humidity: 88, humidity_setpoint: 90, temperature: 20, temperature_setpoint: 20 });
  const on = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-manual", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(on.status, 200);
  const cmd = await call(ctx, "POST", "/api/devices/dev-manual/commands", {
    token,
    body: { kind: "setpoints", payload: { temperature_c: 18 } },
  });
  assert.equal(cmd.status, 200, JSON.stringify(cmd.data));
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-manual", { token });
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
  assert.match(status.data.pause_reason, /you changed a target yourself/i);
  const until = Date.parse(status.data.pause_until);
  assert.ok(until - Date.now() > 11 * 60 * 60 * 1000);
  const again = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-manual", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(again.status, 409);
});

test("enabling Autopilot requires a published culinary profile", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "noprof@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-noprof");
  const missing = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-noprof", mode: "autopilot" },
  });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /profile/i);
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      "draft-oyster",
      JSON.stringify({ id: "draft-oyster", pack: "culinary", stages: [] }),
      user.id,
      0,
      nowIso(),
      nowIso(),
    ]
  );
  const unpublished = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-noprof", mode: "autopilot", profile_id: "draft-oyster" },
  });
  assert.equal(unpublished.status, 400);
  assert.match(unpublished.data.error, /profile/i);
});

test("GET, run, and undo require the current owner", async () => {
  const ctx = env();
  const owner = await register(ctx, "owner@example.com");
  const other = await register(ctx, "other@example.com");
  await subscribe(ctx, owner.token);
  await subscribe(ctx, other.token);
  await addDevice(ctx, owner.user.id, "dev-own");
  await addPublishedProfile(ctx, owner.user.id);
  await addReading(ctx, "dev-own", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token: owner.token,
    body: { device_id: "dev-own", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 200, JSON.stringify(mode.data));
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", {
    token: owner.token,
    body: { device_id: "dev-own" },
  });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.applied, true);
  const apply = (run.data.actions || []).find((a) => a.action === "apply");
  assert.ok(apply);

  const strangerGet = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-own", { token: other.token });
  assert.equal(strangerGet.status, 404);
  const strangerRun = await call(ctx, "POST", "/api/coach/autopilot/run", {
    token: other.token,
    body: { device_id: "dev-own" },
  });
  assert.equal(strangerRun.status, 404);
  const strangerUndo = await call(ctx, "POST", "/api/coach/autopilot/undo", {
    token: other.token,
    body: { action_id: apply.id },
  });
  assert.equal(strangerUndo.status, 404);

  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-own"]);
  device.owner_id = other.user.id;
  const previousGet = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-own", { token: owner.token });
  assert.equal(previousGet.status, 404);
  const previousRun = await call(ctx, "POST", "/api/coach/autopilot/run", {
    token: owner.token,
    body: { device_id: "dev-own" },
  });
  assert.equal(previousRun.status, 404);
  const previousUndo = await call(ctx, "POST", "/api/coach/autopilot/undo", {
    token: owner.token,
    body: { action_id: apply.id },
  });
  assert.equal(previousUndo.status, 404);
});

test("force-run still respects the interval and daily cap", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "force@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-force");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-force", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-force", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 200, JSON.stringify(mode.data));
  const first = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-force" } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.applied, true);
  const queued = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-force"]);
  assert.equal(queued.length, 1);
  queued[0].consumed_at = nowIso();
  const again = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-force" } });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.applied, undefined);
  assert.match(again.data.reason, /minimum interval/i);
  assert.match(again.data.reason, /Next eligible at/i);
  assert.ok(again.data.next_eligible_at);

  const row = await ctx.db.one("SELECT * FROM coach_device_mode WHERE device_id=?", ["dev-force"]);
  row.last_change_at = null;
  row.last_setpoints = JSON.stringify({ temperature_c: 24, humidity_percent: 90, fan_speed_percent: 30 });
  row.changes_day = new Date().toISOString().slice(0, 10);
  row.changes_count = AUTOPILOT_LIMITS.dailyCap;
  const capped = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-force" } });
  assert.equal(capped.status, 200, JSON.stringify(capped.data));
  assert.equal(capped.data.applied, undefined);
  assert.match(capped.data.reason, /daily/i);
  assert.match(capped.data.reason, /Next eligible at/i);
  const cmds = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-force"]);
  assert.equal(cmds.length, 0);
});

test("a missing profile pauses Autopilot and reverts to Advisor", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "gone@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-gone");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-gone", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const enabled = await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-gone",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const saved = await getDeviceMode(ctx.db, "dev-gone", user.id);
  saved.profile_id = "does-not-exist";
  const result = await runAutopilotForDevice(ctx.db, ctx, {
    device: await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-gone"]),
    user,
  });
  assert.equal(result.paused, true);
  assert.equal(result.flipped_to, "advisor");
  assert.match(result.reason, /profile/i);
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-gone", { token });
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
  assert.match(status.data.pause_reason, /profile/i);
});

test("reported setpoints that differ from last_setpoints pause for 12 hours", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "lan@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-lan");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-lan", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const enabled = await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-lan",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const t0 = Date.now();
  const first = await runAutopilotForDevice(ctx.db, ctx, {
    device: await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-lan"]),
    user,
    now: t0,
  });
  assert.equal(first.applied, true, JSON.stringify(first));
  const t1 = t0 + 20 * 60 * 1000;
  await addReading(
    ctx,
    "dev-lan",
    { humidity: 88, humidity_setpoint: 80, temperature: 22, temperature_setpoint: 18 },
    new Date(t1).toISOString()
  );
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-lan"]);
  device.last_seen_at = new Date(t1).toISOString();
  const second = await runAutopilotForDevice(ctx.db, ctx, {
    device,
    user,
    now: t1,
  });
  assert.equal(second.paused, true);
  assert.equal(second.flipped_to, "advisor");
  assert.match(second.reason, /you changed a target yourself/i);
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-lan", { token });
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
  assert.match(status.data.pause_reason, /you changed a target yourself/i);
});

test("setpointsMismatch ignores a just-applied command and detects a LAN change", () => {
  const last = { temperature_c: 23, humidity_percent: 87 };
  const reading = { temperature_setpoint: 18, humidity_setpoint: 80 };
  const now = Date.parse("2026-10-25T12:20:00Z");
  assert.equal(setpointsMismatch(reading, last, { now, lastChangeAt: "2026-10-25T12:10:00Z" }), false);
  assert.equal(setpointsMismatch(reading, last, { now, lastChangeAt: "2026-10-25T12:00:00Z" }), true);
  assert.equal(setpointsMismatch(reading, {}, { now }), false);
});

test("Undo stays allowed while paused, clamps, queues, and logs", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "undo-pause@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-undo");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-undo", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-undo", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 200, JSON.stringify(mode.data));
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-undo" } });
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  const apply = (run.data.actions || []).find((a) => a.action === "apply");
  const log = await ctx.db.one("SELECT * FROM coach_autopilot_log WHERE id=?", [apply.id]);
  log.old_value = JSON.stringify({ temperature_c: 5, humidity_percent: 99, fan_speed_percent: 5 });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-undo"]);
  device.status = "claimed";
  device.last_seen_at = "2026-10-24T00:00:00Z";
  const saved = await getDeviceMode(ctx.db, "dev-undo", user.id);
  saved.mode = "advisor";
  saved.paused = 1;
  saved.pause_reason = "You changed a setpoint. Autopilot is paused for 12 hours.";
  saved.pause_until = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const undo = await call(ctx, "POST", "/api/coach/autopilot/undo", { token, body: { action_id: apply.id } });
  assert.equal(undo.status, 200, JSON.stringify(undo.data));
  assert.equal(undo.data.restored.temperature_c, fruiting.temperature_target_min);
  assert.equal(undo.data.restored.humidity_percent, fruiting.humidity_target_max);
  assert.equal(undo.data.restored.fan_speed_percent, 10);
  const cmds = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-undo"]);
  assert.equal(cmds.length, 2);
  assert.equal(JSON.parse(cmds[1].payload).source, "grow-coach-autopilot-undo");
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-undo", { token });
  assert.equal(status.data.status, "paused");
  assert.ok((status.data.actions || []).some((a) => a.action === "undo"));
});

test("switching to Advisor is not blocked by a missing profile", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "advisor-bad@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-adv");
  const off = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-adv", mode: "advisor", profile_id: "does-not-exist" },
  });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.mode, "advisor");
});

test("changing the profile while Autopilot is on updates the saved profile_id", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "picker@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-pick");
  await addPublishedProfile(ctx, user.id);
  const other = {
    id: "elm-oyster",
    name: "Elm Oyster",
    pack: "culinary",
    tags: ["culinary"],
    stages: [{ id: "fruiting", temperature_c: 18, humidity_percent: 90 }],
  };
  await addPublishedProfile(ctx, user.id, other);
  const on = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-pick", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const changed = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-pick", mode: "autopilot", profile_id: other.id },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-pick", { token });
  assert.equal(status.data.profile_id, other.id);
  assert.equal(status.data.mode, "autopilot");
});

test("targets come from suggestSetpoints, never invented light fields", () => {
  const suggestion = suggestSetpoints(
    { humidity_droop: 0, temperature_calibration: null },
    fruiting,
    { reading: { temperature: 22.76, humidity: 88, temperature_setpoint: 24, humidity_setpoint: 90 } }
  );
  const plan = planAutopilotChange({
    suggestion,
    currentSetpoints: { temperature_c: 24, humidity_percent: 90, fan_speed_percent: suggestion.fan_speed_percent },
    stage: fruiting,
    now: Date.parse("2026-10-25T12:00:00Z"),
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(Object.keys(plan.next).sort(), ["fan_speed_percent", "humidity_percent", "temperature_c"]);
  assert.equal(plan.next.light, undefined);
  assert.equal(plan.next.temperature_c, 23);
});

test("0009 ack migration is additive ALTER/INDEX only", () => {
  const sql = readFileSync(new URL("../migrations/0009_coach_autopilot_ack.sql", import.meta.url), "utf8");
  const body = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(body, /\b(DROP|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  assert.match(sql, /pending_command_id/);
  assert.match(sql, /apply_status/);
  assert.match(sql, /command_id/);
  assert.match(sql, /delivery/);
});

test("queued Autopilot commands use the cloud inbox payload and keep last_setpoints at from", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "cloudq@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "sldev_q1");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "sldev_q1", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "sldev_q1", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 200, JSON.stringify(mode.data));
  assert.equal(mode.data.delivery || (await getDeviceMode(ctx.db, "sldev_q1", user.id)).delivery, "cloud");
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "sldev_q1" } });
  assert.equal(run.data.applied, true, JSON.stringify(run.data));
  assert.equal(run.data.delivery, "cloud");
  const cmds = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["sldev_q1"]);
  assert.equal(cmds.length, 1);
  const payload = JSON.parse(cmds[0].payload);
  assert.equal(payload.delivery, "cloud");
  assert.equal(payload.temperature_c, 23);
  assert.equal(payload.temperature_target, 23);
  assert.equal(payload.target_humidity, payload.humidity_percent);
  assert.equal(payload.source, "grow-coach-autopilot");
  const state = await getDeviceMode(ctx.db, "sldev_q1", user.id);
  const last = JSON.parse(state.last_setpoints);
  assert.equal(last.temperature_c, 24);
  assert.equal(last.humidity_percent, 90);
  const apply = (run.data.actions || []).find((a) => a.action === "apply");
  assert.equal(apply.apply_status, "queued");
  assert.equal(apply.command_id, cmds[0].id);
});

test("failed, refused, or expired commands restore last_setpoints to from", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "failapply@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-fail");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-fail", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-fail",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-fail"]);
  const t0 = Date.now();
  const first = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t0 });
  assert.equal(first.applied, true, JSON.stringify(first));
  const state = await getDeviceMode(ctx.db, "dev-fail", user.id);
  assert.equal(JSON.parse(state.last_setpoints).temperature_c, 24);
  state.last_setpoints = JSON.stringify({ temperature_c: 23, humidity_percent: 90, fan_speed_percent: 30 });
  const expireAt = t0 + AUTOPILOT_LIMITS.commandTtlMs + 1000;
  device.last_seen_at = new Date(expireAt).toISOString();
  await addReading(
    ctx,
    "dev-fail",
    { humidity: 88, humidity_setpoint: 90, temperature: 22.76, temperature_setpoint: 24 },
    new Date(expireAt).toISOString()
  );
  const expired = await runAutopilotForDevice(ctx.db, ctx, {
    device,
    user,
    now: expireAt,
  });
  assert.equal(expired.applied, undefined);
  const afterExpire = await getDeviceMode(ctx.db, "dev-fail", user.id);
  assert.equal(JSON.parse(afterExpire.last_setpoints).temperature_c, 24);
  const logs = await ctx.db.all("SELECT * FROM coach_autopilot_log WHERE device_id=? ORDER BY id DESC LIMIT ?", [
    "dev-fail",
    8,
  ]);
  assert.ok(logs.some((row) => row.action === "expired" || row.apply_status === "expired"));

  afterExpire.last_change_at = null;
  afterExpire.changes_count = 0;
  const t2 = expireAt + 60 * 60 * 1000;
  device.last_seen_at = new Date(t2).toISOString();
  await addReading(
    ctx,
    "dev-fail",
    { humidity: 88, humidity_setpoint: 90, temperature: 22.76, temperature_setpoint: 24 },
    new Date(t2).toISOString()
  );
  const second = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t2 });
  assert.equal(second.applied, true, JSON.stringify(second));
  const failed = await noteAutopilotCommandAck(ctx.db, device, second.command_id, "failed", { reason: "refused by chamber" });
  assert.equal(failed.status, "failed");
  const afterFail = await getDeviceMode(ctx.db, "dev-fail", user.id);
  assert.equal(JSON.parse(afterFail.last_setpoints).temperature_c, 24);

  afterFail.last_change_at = null;
  afterFail.changes_count = 0;
  const t3 = t2 + 60 * 60 * 1000;
  device.last_seen_at = new Date(t3).toISOString();
  await addReading(
    ctx,
    "dev-fail",
    { humidity: 88, humidity_setpoint: 90, temperature: 22.76, temperature_setpoint: 24 },
    new Date(t3).toISOString()
  );
  const third = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t3 });
  assert.equal(third.applied, true, JSON.stringify(third));
  const refused = await noteAutopilotCommandAck(ctx.db, device, third.command_id, "refused", { ack_reason: "local change wins" });
  assert.equal(refused.status, "refused");
  const afterRefuse = await getDeviceMode(ctx.db, "dev-fail", user.id);
  assert.equal(JSON.parse(afterRefuse.last_setpoints).temperature_c, 24);
});

test("device ack or matching readings mark the command applied and set last_setpoints", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "ack@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-ack");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-ack", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-ack",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-ack"]);
  const t0 = Date.now();
  const first = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t0 });
  assert.equal(first.applied, true, JSON.stringify(first));
  const acked = await noteAutopilotCommandAck(ctx.db, device, first.command_id, "applied");
  assert.equal(acked.status, "applied");
  const afterAck = await getDeviceMode(ctx.db, "dev-ack", user.id);
  assert.equal(JSON.parse(afterAck.last_setpoints).temperature_c, 23);
  const apply = (await ctx.db.all("SELECT * FROM coach_autopilot_log WHERE device_id=? ORDER BY id DESC LIMIT ?", ["dev-ack", 8])).find(
    (row) => row.action === "apply"
  );
  assert.equal(apply.apply_status, "applied");

  afterAck.last_change_at = null;
  afterAck.changes_count = 0;
  const t2 = t0 + 5 * 60 * 1000;
  device.last_seen_at = new Date(t2).toISOString();
  await addReading(
    ctx,
    "dev-ack",
    {
      humidity: 88,
      humidity_setpoint: 90,
      temperature: 22,
      temperature_setpoint: 23,
    },
    new Date(t2).toISOString()
  );
  const second = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t2 });
  assert.equal(second.applied, true, JSON.stringify(second));
  assert.equal(JSON.parse((await getDeviceMode(ctx.db, "dev-ack", user.id)).last_setpoints).temperature_c, 23);
  const tInfer = t2 + 60_000;
  await addReading(
    ctx,
    "dev-ack",
    {
      humidity: 87,
      humidity_setpoint: second.next.humidity_percent,
      temperature: 22,
      temperature_setpoint: second.next.temperature_c,
    },
    new Date(tInfer).toISOString()
  );
  const inferred = await reconcileAutopilotCommands(ctx.db, {
    device,
    user,
    now: tInfer,
    reading: {
      temperature_setpoint: second.next.temperature_c,
      humidity_setpoint: second.next.humidity_percent,
    },
  });
  assert.ok(inferred.reconciled.some((row) => row.status === "applied"));
  const afterInfer = await getDeviceMode(ctx.db, "dev-ack", user.id);
  assert.equal(JSON.parse(afterInfer.last_setpoints).temperature_c, second.next.temperature_c);
});

test("Autopilot works for a beta user without an AI binding", async () => {
  const ctx = env({ GROW_COACH_PROVIDER: "stub", GROW_COACH_STUB: "1" });
  delete ctx.AI;
  const { token, user } = await register(ctx, "beta-auto@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);
  await addDevice(ctx, user.id, "dev-beta");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-beta", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.equal(catalog.data.autopilot, true);
  assert.equal(catalog.data.beta, false);
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-beta", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 200, JSON.stringify(mode.data));
  const run = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-beta" } });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.applied, true);
  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "hi" } });
  assert.equal(chat.status, 402);
});

test("Autopilot stays hidden without the allowlist or a paid sub", async () => {
  const ctx = env({ COACH_BETA_USER_IDS: "82", COACH_PUBLIC: "" });
  const { token, user } = await register(ctx, "nope@example.com");
  await addDevice(ctx, user.id, "dev-nope");
  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.deepEqual(catalog.data, { available: false });
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-nope", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(mode.status, 404);
});

test("a pending cloud command blocks another Autopilot change", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "pend@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-pend");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-pend", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-pend",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const first = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-pend" } });
  assert.equal(first.data.applied, true);
  const again = await call(ctx, "POST", "/api/coach/autopilot/run", { token, body: { device_id: "dev-pend" } });
  assert.equal(again.data.applied, undefined);
  assert.match(again.data.reason, /waiting for the chamber/i);
  const cmds = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-pend"]);
  assert.equal(cmds.length, 1);
});

test("Coach and Autopilot read a 24h telemetry window, not every row", async () => {
  const learn = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/coach-learn.js"), "utf8");
  const coach = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/coach.js"), "utf8");
  const auto = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/coach-autopilot.js"), "utf8");
  const fleet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/fleet.js"), "utf8");
  assert.match(learn, /TELEMETRY_WINDOW_SQL/);
  assert.match(learn, /ORDER BY created_at DESC LIMIT/);
  assert.match(coach, /loadRecentTelemetry/);
  assert.match(auto, /loadRecentTelemetry/);
  assert.match(fleet, /loadRecentTelemetry/);
  assert.doesNotMatch(coach, /SELECT \* FROM device_telemetry WHERE device_id=\?", \[deviceId\]/);
  assert.doesNotMatch(auto, /SELECT \* FROM device_telemetry WHERE device_id=\?", \[device\.id\]/);

  const ctx = env();
  const { token, user } = await register(ctx, "window@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-window");
  await addPublishedProfile(ctx, user.id);
  await addReading(
    ctx,
    "dev-window",
    { humidity: 88, humidity_setpoint: 88, temperature: 16, temperature_setpoint: 16 },
    new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  );
  const enabled = await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-window",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const result = await runAutopilotForDevice(ctx.db, ctx, {
    device: await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-window"]),
    user,
  });
  assert.equal(result.paused, true);
  assert.match(result.reason, /missing/i);
});

test("local bridge success then next pass does not pause as a manual change", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "rep@example.com");
  await subscribe(ctx, token);
  const t0 = Date.now();
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["local-chamber", "hw", "{}", "LAN", "claimed", user.id, null, null, null, 1, nowIso(), nowIso()]
  );
  await addPublishedProfile(ctx, user.id);
  const rd = (sp, rh, at) =>
    ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
      "local-chamber",
      JSON.stringify({ humidity: 88, humidity_setpoint: rh, temperature: 21, temperature_setpoint: sp }),
      new Date(at).toISOString(),
    ]);
  await rd(24, 90, t0);
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "local-chamber",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["local-chamber"]);
  const first = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t0 });
  assert.equal(first.applied, true, JSON.stringify(first));
  const cmd = await ctx.db.one("SELECT * FROM device_commands WHERE id=?", [first.command_id]);
  await ctx.db.run("UPDATE device_commands SET consumed_at=?, payload=? WHERE id=? AND device_id=?", [
    nowIso(),
    JSON.stringify(withBridgeResult(cmd, { status: "sent", sent: true })),
    cmd.id,
    "local-chamber",
  ]);
  const t1 = t0 + 65 * 60 * 1000;
  device.last_seen_at = new Date(t1).toISOString();
  await rd(first.next.temperature_c, first.next.humidity_percent, t1);
  const second = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t1 });
  assert.equal(second.paused, undefined, JSON.stringify(second));
  assert.notEqual(second.flipped_to, "advisor");
  const after = await getDeviceMode(ctx.db, "local-chamber", user.id);
  assert.notEqual(Number(after.pending_command_id), Number(first.command_id));
  assert.equal(JSON.parse(after.last_setpoints).temperature_c, first.next.temperature_c);
  assert.equal(after.mode, "autopilot");
  const firstCmd = await ctx.db.one("SELECT * FROM device_commands WHERE id=?", [first.command_id]);
  assert.match(firstCmd.payload, /"_ack"/);
});

test("unknown ack_status is treated as failed, not applied", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "badack@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-badack");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-badack", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-badack",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-badack"]);
  const first = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: Date.now() });
  assert.equal(first.applied, true);
  const acked = await noteAutopilotCommandAck(ctx.db, device, first.command_id, "wat");
  assert.equal(acked.status, "failed");
  const state = await getDeviceMode(ctx.db, "dev-badack", user.id);
  assert.equal(JSON.parse(state.last_setpoints).temperature_c, 24);
  assert.equal(state.pending_command_id, null);
});

test("finalize is idempotent on replayed acks", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "idem@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-idem");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-idem", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-idem",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-idem"]);
  const first = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: Date.now() });
  assert.equal(first.applied, true);
  const once = await noteAutopilotCommandAck(ctx.db, device, first.command_id, "applied");
  assert.equal(once.status, "applied");
  const logsAfter = await ctx.db.all("SELECT * FROM coach_autopilot_log WHERE device_id=?", ["dev-idem"]);
  const replay = await noteAutopilotCommandAck(ctx.db, device, first.command_id, "failed");
  assert.equal(replay.skipped, "already_finalized");
  assert.equal(replay.status, "applied");
  const state = await getDeviceMode(ctx.db, "dev-idem", user.id);
  assert.equal(JSON.parse(state.last_setpoints).temperature_c, 23);
  const logsReplay = await ctx.db.all("SELECT * FROM coach_autopilot_log WHERE device_id=?", ["dev-idem"]);
  assert.equal(logsReplay.length, logsAfter.length);
});

test("Undo refuses apply rows that failed, expired, or were refused", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "noundo@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-noundo");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-noundo", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-noundo",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-noundo"]);
  const t0 = Date.now();
  const first = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: t0 });
  assert.equal(first.applied, true);
  await noteAutopilotCommandAck(ctx.db, device, first.command_id, "failed");
  const apply = (await ctx.db.all("SELECT * FROM coach_autopilot_log WHERE device_id=? ORDER BY id DESC LIMIT ?", [
    "dev-noundo",
    8,
  ])).find((row) => row.action === "apply");
  assert.equal(apply.apply_status, "failed");
  const undo = await call(ctx, "POST", "/api/coach/autopilot/undo", { token, body: { action_id: apply.id } });
  assert.equal(undo.status, 400);
});

test("inferAutopilotApplyFromReading does not throw when 0009 columns are missing", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "schema@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-schema");
  await addPublishedProfile(ctx, user.id);
  await addReading(ctx, "dev-schema", {
    humidity: 88,
    humidity_setpoint: 90,
    temperature: 22.76,
    temperature_setpoint: 24,
  });
  await setDeviceAutopilotMode(ctx.db, ctx, user, {
    deviceId: "dev-schema",
    mode: "autopilot",
    profileId: pearlOyster.id,
  });
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-schema"]);
  const first = await runAutopilotForDevice(ctx.db, ctx, { device, user, now: Date.now() });
  assert.equal(first.applied, true);
  const original = ctx.db.run.bind(ctx.db);
  ctx.db.run = async (sql, params) => {
    if (String(sql).includes("pending_command_id") || String(sql).includes("apply_status")) {
      throw new Error("no such column: pending_command_id");
    }
    return original(sql, params);
  };
  const inferred = await inferAutopilotApplyFromReading(ctx.db, device, {
    temperature_setpoint: first.next.temperature_c,
    humidity_setpoint: first.next.humidity_percent,
  });
  assert.equal(inferred.skipped, "schema");
  assert.deepEqual(inferred.reconciled, []);
});


