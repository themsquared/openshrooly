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
  limitAutopilotStep,
  planAutopilotChange,
  runAutopilotForDevice,
  runAutopilotPass,
  setDeviceAutopilotMode,
  setpointsMismatch,
} from "../src/coach-autopilot.js";
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
      reading: { temperature: 22, humidity: 88, age_seconds: 16 * 60 },
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
      device: { status: "claimed", last_seen_at: "2026-10-25T11:40:00Z" },
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
  assert.equal(hidden.data.autopilot, false);
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
  const apply = (run.data.actions || []).find((a) => a.action === "apply");
  assert.ok(apply);
  const undo = await call(ctx, "POST", "/api/coach/autopilot/undo", { token, body: { action_id: apply.id } });
  assert.equal(undo.status, 200, JSON.stringify(undo.data));
  assert.equal(undo.data.restored.temperature_c, 24);
  const after = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-auto"]);
  assert.equal(after.length, 2);
  assert.equal(JSON.parse(after[1].payload).source, "grow-coach-autopilot-undo");
  assert.equal(JSON.parse(after[1].payload).temperature_c, 24);
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
    new Date(Date.now() - 20 * 60 * 1000).toISOString()
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
  assert.match(status.data.pause_reason, /you changed a setpoint/i);
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
  assert.equal(cmds.length, 1);
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
  assert.match(second.reason, /you changed a setpoint/i);
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-lan", { token });
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
  assert.match(status.data.pause_reason, /you changed a setpoint/i);
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
  assert.equal(undo.data.restored.temperature_c, 10);
  assert.equal(undo.data.restored.humidity_percent, 98);
  assert.equal(undo.data.restored.fan_speed_percent, 10);
  const cmds = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-undo"]);
  assert.equal(cmds.length, 2);
  assert.equal(JSON.parse(cmds[1].payload).source, "grow-coach-autopilot-undo");
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-undo", { token });
  assert.equal(status.data.status, "paused");
  assert.ok((status.data.actions || []).some((a) => a.action === "undo"));
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
