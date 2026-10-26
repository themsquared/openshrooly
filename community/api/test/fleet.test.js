import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import { downsampleHistory, HISTORY_MAX_POINTS } from "../src/coach-learn.js";
import { commandExpired, deviceIsOnline, FLEET_ONLINE_MS, validateFleetChange } from "../src/fleet.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);
const MIGRATION = readFileSync(new URL("../migrations/0008_fleet.sql", import.meta.url), "utf8");

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", FLEET_UI_ENABLED: "1", COACH_AUTOPILOT_ENABLED: "1", ...extra });
}

async function addDevice(ctx, userId, id, { status = "active", lastSeen = nowIso(), name = "Kitchen" } = {}) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", name, status, userId, null, null, null, 1, lastSeen, nowIso()]
  );
}

async function addReading(ctx, deviceId, doc, createdAt = nowIso()) {
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    deviceId,
    JSON.stringify(doc),
    createdAt,
  ]);
}

async function addProfile(ctx, userId, profile) {
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [profile.id, JSON.stringify(profile), userId, 1, nowIso(), nowIso()]
  );
}

async function grantCoach(ctx, token) {
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

function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

test("0008 migration is additive CREATE TABLE/INDEX only", () => {
  const body = MIGRATION.replace(/--.*$/gm, "").replace(/ON DELETE CASCADE/g, "");
  assert.doesNotMatch(body, /\b(DROP|ALTER|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  for (const s of statements(MIGRATION)) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  assert.match(MIGRATION, /device_groups/);
  assert.match(MIGRATION, /fleet_audit/);
  assert.match(MIGRATION, /owner_id/);
});

test("kill switch hides fleet bulk tools and leaves the Devices path on", async () => {
  const ctx = env({ FLEET_UI_ENABLED: "0" });
  const { token, user } = await register(ctx, "off@example.com");
  await addDevice(ctx, user.id, "dev-off-flag");
  const catalog = await call(ctx, "GET", "/api/fleet", { token });
  assert.equal(catalog.data.available, false);
  const list = await call(ctx, "GET", "/api/fleet/devices", { token });
  assert.equal(list.status, 200);
  assert.equal(list.data.devices.length, 1);
  assert.equal(list.data.devices[0].device_type, "shrooly_chamber");
  assert.equal(list.data.devices[0].device_type_label, "Shrooly chamber");
  const groups = await call(ctx, "GET", "/api/fleet/groups", { token });
  assert.equal(groups.status, 404);
  const bulk = await call(ctx, "POST", "/api/fleet/apply", {
    token,
    body: { action: "setpoints", device_ids: ["dev-off-flag"], payload: { temperature_c: 18 } },
  });
  assert.equal(bulk.status, 404);
  const audit = await call(ctx, "GET", "/api/fleet/audit", { token });
  assert.equal(audit.status, 404);
});

test("users only see and manage their own chambers", async () => {
  const ctx = env();
  const a = await register(ctx, "owner@example.com");
  const b = await register(ctx, "other@example.com");
  await addDevice(ctx, a.user.id, "dev-a");
  await addReading(ctx, "dev-a", { temperature: 20, humidity: 88, temperature_setpoint: 20, humidity_setpoint: 88 });
  const mine = await call(ctx, "GET", "/api/fleet/devices", { token: a.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.devices.length, 1);
  assert.equal(mine.data.devices[0].id, "dev-a");
  const other = await call(ctx, "GET", "/api/fleet/devices", { token: b.token });
  assert.equal(other.data.devices.length, 0);
  const sneak = await call(ctx, "GET", "/api/fleet/devices/dev-a", { token: b.token });
  assert.equal(sneak.status, 403);
  const rename = await call(ctx, "PATCH", "/api/fleet/devices/dev-a", { token: b.token, body: { name: "Stolen" } });
  assert.equal(rename.status, 403);
});

test("bulk setpoints clamp to global limits and record per-device results", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "bulk@example.com");
  await addDevice(ctx, user.id, "dev-hot", { lastSeen: nowIso() });
  await addDevice(ctx, user.id, "dev-off", { lastSeen: new Date(Date.now() - 40 * 60 * 1000).toISOString() });
  await addReading(ctx, "dev-hot", { temperature: 22, humidity: 88, temperature_setpoint: 22, humidity_setpoint: 88 });
  await addReading(ctx, "dev-off", { temperature: 18, humidity: 90, temperature_setpoint: 18, humidity_setpoint: 90 });
  await addProfile(ctx, user.id, pearlOyster);
  const preview = await call(ctx, "POST", "/api/fleet/preview", {
    token,
    body: { action: "setpoints", device_ids: ["dev-hot", "dev-off"], payload: { temperature_c: 40, humidity_percent: 99 } },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.results.length, 2);
  assert.ok(preview.data.results.every((r) => r.preview.to.temperature_c <= 32));
  assert.ok(preview.data.results.every((r) => r.preview.to.humidity_percent <= 98));
  const applied = await call(ctx, "POST", "/api/fleet/apply", {
    token,
    body: { action: "setpoints", device_ids: ["dev-hot", "dev-off"], payload: { temperature_c: 18, humidity_percent: 88 } },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const byId = Object.fromEntries(applied.data.results.map((r) => [r.device_id, r]));
  // Enqueue is never "applied": both wait for the chamber, online or not.
  assert.equal(byId["dev-hot"].status, "queued");
  assert.equal(byId["dev-off"].status, "queued");
  assert.ok(byId["dev-hot"].command_id);
  const audit = await call(ctx, "GET", "/api/fleet/audit", { token });
  assert.ok(audit.data.entries.some((e) => e.action === "setpoints" && e.results.length === 2));
});

test("offline queue expires and is omitted from the device inbox", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "queue@example.com");
  await addDevice(ctx, user.id, "dev-q", { lastSeen: new Date(Date.now() - 40 * 60 * 1000).toISOString() });
  const applied = await call(ctx, "POST", "/api/fleet/apply", {
    token,
    body: { action: "setpoints", device_ids: ["dev-q"], payload: { temperature_c: 18 } },
  });
  assert.equal(applied.data.results[0].status, "queued");
  const rows = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["dev-q"]);
  assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payload);
  assert.ok(payload.expires_at);
  assert.equal(commandExpired({ expires_at: new Date(Date.now() - 1000).toISOString() }), true);
  assert.equal(commandExpired({ expires_at: new Date(Date.now() + 60_000).toISOString() }), false);
  payload.expires_at = new Date(Date.now() - 1000).toISOString();
  rows[0].payload = JSON.stringify(payload);
  assert.equal(commandExpired(JSON.parse(rows[0].payload)), true);
});

test("Off-menu profiles cannot take a Coach mode change", () => {
  const plan = validateFleetChange({
    action: "coach_mode",
    payload: { mode: "autopilot" },
    profile: { id: "psi-cube", pack: "psilocybin", restricted: true, tags: ["psilocybin"] },
  });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /off-menu/i);
});

test("groups stay on owner_id and cannot take another user's chamber", async () => {
  const ctx = env();
  const a = await register(ctx, "g1@example.com");
  const b = await register(ctx, "g2@example.com");
  await addDevice(ctx, a.user.id, "dev-g");
  await addDevice(ctx, b.user.id, "dev-b");
  const created = await call(ctx, "POST", "/api/fleet/groups", { token: a.token, body: { name: "Garage rack" } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.group.owner_id, a.user.id);
  const stolen = await call(ctx, "POST", `/api/fleet/groups/${created.data.group.id}/members`, {
    token: a.token,
    body: { device_ids: ["dev-b"] },
  });
  assert.equal(stolen.status, 403);
  const peek = await call(ctx, "PATCH", `/api/fleet/groups/${created.data.group.id}`, {
    token: b.token,
    body: { name: "Mine" },
  });
  assert.equal(peek.status, 404);
});

test("rename and Unlink require confirm and stay on the owner", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "name@example.com");
  await addDevice(ctx, user.id, "dev-n", { name: "Old" });
  const named = await call(ctx, "PATCH", "/api/fleet/devices/dev-n", { token, body: { name: "Tent one" } });
  assert.equal(named.status, 200);
  assert.equal(named.data.name, "Tent one");
  const no = await call(ctx, "POST", "/api/fleet/devices/dev-n/unlink", { token, body: {} });
  assert.equal(no.status, 400);
  const yes = await call(ctx, "POST", "/api/fleet/devices/dev-n/unlink", { token, body: { confirm: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-n"]);
  assert.equal(row.status, "revoked");
});

test("fleet setpoint apply pauses Autopilot immediately", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "pause@example.com");
  await grantCoach(ctx, token);
  await addDevice(ctx, user.id, "dev-pause");
  await addReading(ctx, "dev-pause", { temperature: 20, humidity: 88, temperature_setpoint: 20, humidity_setpoint: 88 });
  await addProfile(ctx, user.id, pearlOyster);
  const on = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-pause", mode: "autopilot", profile_id: pearlOyster.id },
  });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const applied = await call(ctx, "POST", "/api/fleet/apply", {
    token,
    body: { action: "setpoints", device_ids: ["dev-pause"], payload: { temperature_c: 18 } },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.results[0].status, "queued");
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-pause", { token });
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
  assert.match(status.data.pause_reason, /you changed a target yourself/i);
});

test("fleet profile action requires a published or owned profile and does not leak names", async () => {
  const ctx = env();
  const owner = await register(ctx, "prof-owner@example.com");
  const other = await register(ctx, "prof-other@example.com");
  await addDevice(ctx, owner.user.id, "dev-prof");
  await addProfile(ctx, owner.user.id, pearlOyster);
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      "secret-draft",
      JSON.stringify({ id: "secret-draft", name: "Hidden Draft", pack: "culinary", stages: [] }),
      other.user.id,
      0,
      nowIso(),
      nowIso(),
    ]
  );
  const leaked = await call(ctx, "POST", "/api/fleet/preview", {
    token: owner.token,
    body: { action: "profile", device_ids: ["dev-prof"], payload: { profile_id: "secret-draft" } },
  });
  assert.equal(leaked.data.results[0].status, "failed");
  assert.doesNotMatch(JSON.stringify(leaked.data), /Hidden Draft/);
  const ok = await call(ctx, "POST", "/api/fleet/preview", {
    token: owner.token,
    body: { action: "profile", device_ids: ["dev-prof"], payload: { profile_id: pearlOyster.id } },
  });
  assert.equal(ok.data.results[0].status, "ok", JSON.stringify(ok.data));
  assert.equal(ok.data.results[0].preview.profile_id, pearlOyster.id);
  assert.equal(ok.data.results[0].preview.profile_name, undefined);
});

test("fleet and single-device light payloads are validated", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "light@example.com");
  await addDevice(ctx, user.id, "dev-light");
  await addProfile(ctx, user.id, pearlOyster);
  const bad = await call(ctx, "POST", "/api/fleet/preview", {
    token,
    body: {
      action: "light",
      device_ids: ["dev-light"],
      payload: { light: { sunrise_hour: 30, duration_hours: 12, white_led_lux: 90, red_percent: 0, green_percent: 0, blue_percent: 80 } },
    },
  });
  assert.equal(bad.data.results[0].status, "failed");
  assert.match(bad.data.results[0].error, /sunrise/i);
  const ok = validateFleetChange({
    action: "light",
    payload: { light: { sunrise_hour: 8, duration_hours: 12, white_led_lux: 90, red_percent: 0, green_percent: 0, blue_percent: 80 } },
  });
  assert.equal(ok.ok, true);
  const single = await call(ctx, "POST", "/api/devices/dev-light/commands", {
    token,
    body: { kind: "schedule", payload: { light: { sunrise_hour: 30 } } },
  });
  assert.equal(single.status, 400);
  assert.match(single.data.error, /sunrise/i);
  const zeroHours = await call(ctx, "POST", "/api/devices/dev-light/commands", {
    token,
    body: {
      kind: "schedule",
      payload: { light: { sunrise_hour: 7, duration_hours: 0, white_led_lux: 150, red_percent: 0, green_percent: 0, blue_percent: 80 } },
    },
  });
  assert.equal(zeroHours.status, 400);
  assert.match(zeroHours.data.error, /duration/i);
});

test("group deletion is audited and the audit list is newest first", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "del@example.com");
  await addDevice(ctx, user.id, "dev-del");
  const created = await call(ctx, "POST", "/api/fleet/groups", { token, body: { name: "Old rack" } });
  const id = created.data.group.id;
  const gone = await call(ctx, "DELETE", `/api/fleet/groups/${id}`, { token });
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  const audit = await call(ctx, "GET", "/api/fleet/audit", { token });
  assert.equal(audit.data.entries[0].action, "group_delete");
  assert.equal(audit.data.entries[0].target, String(id));
  assert.ok(audit.data.entries.every((e, i, all) => i === 0 || Number(all[i - 1].id) >= Number(e.id)));
});

test("deviceIsOnline tolerates the 15 minute heartbeat plus drift", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(deviceIsOnline({ last_seen_at: "2026-10-25T11:50:00Z" }, now), true);
  assert.equal(deviceIsOnline({ last_seen_at: "2026-10-25T11:44:30Z" }, now), true);
  assert.equal(deviceIsOnline({ last_seen_at: "2026-10-25T11:39:00Z" }, now), false);
  assert.equal(FLEET_ONLINE_MS, 20 * 60 * 1000);
});

test("fleet 168h history downsamples and still covers the week", async () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const samples = [
    {
      document: JSON.stringify({ temperature: 10, humidity: 70, temperature_setpoint: 10, humidity_setpoint: 70 }),
      created_at: new Date(now - 167 * 3600 * 1000).toISOString(),
    },
  ];
  for (let i = 0; i < 2500; i++) {
    samples.push({
      document: JSON.stringify({ temperature: 20, humidity: 88, temperature_setpoint: 20, humidity_setpoint: 88 }),
      created_at: new Date(now - i * 60 * 1000).toISOString(),
    });
  }
  const week = downsampleHistory(samples, { hours: 168 });
  assert.ok(week.length <= HISTORY_MAX_POINTS);
  assert.ok(now - Date.parse(week[0].at) >= 100 * 3600 * 1000, "week view keeps the old end of the range");
  const short = downsampleHistory(samples.slice(-40), { hours: 24 });
  assert.equal(short.length, 40);

  const ctx = env();
  const { token, user } = await register(ctx, "week@example.com");
  await addDevice(ctx, user.id, "dev-week");
  await addReading(
    ctx,
    "dev-week",
    { temperature: 10, humidity: 70, temperature_setpoint: 10, humidity_setpoint: 70 },
    new Date(Date.now() - 160 * 3600 * 1000).toISOString()
  );
  for (let i = 0; i < 2100; i++) {
    await addReading(
      ctx,
      "dev-week",
      { temperature: 20, humidity: 88, temperature_setpoint: 20, humidity_setpoint: 88 },
      new Date(Date.now() - i * 20 * 1000).toISOString()
    );
  }
  const detail = await call(ctx, "GET", "/api/fleet/devices/dev-week?hours=168", { token });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.ok(detail.data.history.length <= HISTORY_MAX_POINTS);
  assert.ok(Date.now() - Date.parse(detail.data.history[0].at) >= 100 * 3600 * 1000);
});

test("device identity includes type, species, and grow day without the fleet flag", async () => {
  const ctx = env({ FLEET_UI_ENABLED: "0" });
  const { token, user } = await register(ctx, "id@example.com");
  await addDevice(ctx, user.id, "dev-id");
  await addProfile(ctx, user.id, pearlOyster);
  await addReading(ctx, "dev-id", {
    temperature: 16,
    humidity: 88,
    temperature_setpoint: 16,
    humidity_setpoint: 88,
    stage: "fruiting",
    grow_day: 6,
    water_level: 42,
    fan_speed: 30,
  });
  const applied = await call(ctx, "POST", "/api/fleet/devices/dev-id/apply", {
    token,
    body: { action: "profile", payload: { profile_id: pearlOyster.id, stage: "fruiting" } },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.results[0].status, "queued");
  const detail = await call(ctx, "GET", "/api/fleet/devices/dev-id", { token });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  const d = detail.data.device;
  assert.equal(d.device_type, "shrooly_chamber");
  assert.equal(d.device_type_label, "Shrooly chamber");
  assert.equal(d.profile.id, pearlOyster.id);
  assert.equal(d.profile.species, pearlOyster.species);
  assert.equal(d.profile.name, pearlOyster.name);
  assert.equal(d.stage.id, "fruiting");
  assert.equal(d.grow.day, 6);
  assert.equal(d.grow.phase, d.stage.name);
  assert.equal(d.reading.water_level, 42);
  assert.ok(Array.isArray(d.cloud_controls));
  assert.ok(d.local_only.some((item) => item.id === "water_calibration"));
});

test("device payload hides Coach from users without Coach beta or entitlement", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "nocoach@example.com");
  await addDevice(ctx, user.id, "dev-nocoach");
  const detail = await call(ctx, "GET", "/api/fleet/devices/dev-nocoach", { token });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.device.coach, null);
  const list = await call(ctx, "GET", "/api/fleet/devices", { token });
  assert.equal(list.data.devices[0].coach, null);

  await grantCoach(ctx, token);
  const entitled = await call(ctx, "GET", "/api/fleet/devices/dev-nocoach", { token });
  assert.equal(entitled.data.device.coach?.mode, "advisor");

  const betaCtx = env();
  const beta = await register(betaCtx, "beta@example.com");
  betaCtx.COACH_BETA_USER_IDS = String(beta.user.id);
  await addDevice(betaCtx, beta.user.id, "dev-beta");
  const betaList = await call(betaCtx, "GET", "/api/fleet/devices", { token: beta.token });
  assert.equal(betaList.data.devices[0].coach?.mode, "advisor");

  const flagOff = env({ COACH_AUTOPILOT_ENABLED: "0" });
  const off = await register(flagOff, "flagoff@example.com");
  flagOff.COACH_BETA_USER_IDS = String(off.user.id);
  await addDevice(flagOff, off.user.id, "dev-flagoff");
  const offDetail = await call(flagOff, "GET", "/api/fleet/devices/dev-flagoff", { token: off.token });
  assert.equal(offDetail.data.device.coach, null);
});

test("single-device apply checks ownership, clamps, and queues when offline", async () => {
  const ctx = env({ FLEET_UI_ENABLED: "0" });
  const owner = await register(ctx, "own@example.com");
  const other = await register(ctx, "thief@example.com");
  await addDevice(ctx, owner.user.id, "dev-hot", { lastSeen: nowIso() });
  await addDevice(ctx, owner.user.id, "dev-quiet", { lastSeen: new Date(Date.now() - 40 * 60 * 1000).toISOString() });
  await addDevice(ctx, owner.user.id, "dev-revoked", { status: "revoked" });
  await addReading(ctx, "dev-hot", { temperature: 22, humidity: 88, temperature_setpoint: 22, humidity_setpoint: 88 });
  await addReading(ctx, "dev-quiet", { temperature: 18, humidity: 90, temperature_setpoint: 18, humidity_setpoint: 90 });
  await addProfile(ctx, owner.user.id, pearlOyster);

  const sneak = await call(ctx, "POST", "/api/fleet/devices/dev-hot/apply", {
    token: other.token,
    body: { action: "setpoints", payload: { temperature_c: 18 } },
  });
  assert.equal(sneak.status, 403);

  const preview = await call(ctx, "POST", "/api/fleet/devices/dev-hot/preview", {
    token: owner.token,
    body: { action: "setpoints", payload: { temperature_c: 40, humidity_percent: 99 } },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.ok(preview.data.results[0].preview.to.temperature_c <= 32);
  assert.ok(preview.data.results[0].preview.to.humidity_percent <= 98);

  const hot = await call(ctx, "POST", "/api/fleet/devices/dev-hot/apply", {
    token: owner.token,
    body: { action: "setpoints", payload: { temperature_c: 18, humidity_percent: 88 } },
  });
  assert.equal(hot.data.results[0].status, "queued");

  const quiet = await call(ctx, "POST", "/api/fleet/devices/dev-quiet/apply", {
    token: owner.token,
    body: { action: "setpoints", payload: { temperature_c: 18 } },
  });
  assert.equal(quiet.data.results[0].status, "queued");

  const dead = await call(ctx, "POST", "/api/fleet/devices/dev-revoked/apply", {
    token: owner.token,
    body: { action: "setpoints", payload: { temperature_c: 18 } },
  });
  assert.equal(dead.data.results[0].status, "failed");
  assert.match(dead.data.results[0].error, /unlinked/i);
});

test("claimed but unlinked chambers cannot take a cloud write", async () => {
  const ctx = env({ FLEET_UI_ENABLED: "0" });
  const { token, user } = await register(ctx, "claim@example.com");
  await addDevice(ctx, user.id, "dev-claim", { status: "claimed" });
  const applied = await call(ctx, "POST", "/api/fleet/devices/dev-claim/apply", {
    token,
    body: { action: "setpoints", payload: { temperature_c: 18 } },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.results[0].status, "failed");
  assert.match(applied.data.results[0].error, /not linked/i);
});

test("applying a new profile starts at day 1 of the first stage, not fruiting", async () => {
  const ctx = env({ FLEET_UI_ENABLED: "0" });
  const { token, user } = await register(ctx, "fresh-grow@example.com");
  await addDevice(ctx, user.id, "dev-fresh");
  await addProfile(ctx, user.id, pearlOyster);
  // The chamber still reports a day from whatever it ran before.
  await addReading(ctx, "dev-fresh", { temperature: 21, humidity: 89, temperature_setpoint: 21, humidity_setpoint: 90, grow_day: 19 });
  const applied = await call(ctx, "POST", "/api/fleet/devices/dev-fresh/apply", {
    token,
    body: { action: "profile", payload: { profile_id: pearlOyster.id } },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.notEqual(applied.data.results[0].status, "failed", JSON.stringify(applied.data));
  const first = pearlOyster.stages[0];
  assert.equal(applied.data.results[0].preview.stage, first.id);
  const detail = await call(ctx, "GET", "/api/fleet/devices/dev-fresh", { token });
  const d = detail.data.device;
  assert.equal(d.stage.id, first.id);
  assert.equal(d.grow.day, 0, "day 0 elapsed, shown as day 1");
});
