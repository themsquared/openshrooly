import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { SQL } from "../src/alerts/store.js";
import { runAlerts } from "../src/alerts/cron.js";
import { call, testEnv } from "./helpers.js";
import { sha256Hex } from "../src/crypto.js";

const root = new URL("../", import.meta.url);
const MIGRATION = readFileSync(new URL("migrations/0003_grow_alerts.sql", root), "utf8");
const MIN = 60000;
const T0 = Date.parse("2026-07-15T18:00:00Z");
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/** The schema as production had it before this change: schema.sql at the base commit. */
function baseSchema() {
  try {
    return execFileSync("git", ["show", "0edd16e:community/api/schema.sql"], { cwd: root, encoding: "utf8" });
  } catch {
    // Without git history, strip this change's tables from the current schema.
    return readFileSync(new URL("schema.sql", root), "utf8").split("-- Grow alerts")[0];
  }
}

function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function apply(d1, sql) {
  for (const s of statements(sql)) await d1.prepare(s).run();
}

/** Record every statement so the test can prove each SQL constant ran against real SQLite. */
function recording(db) {
  const seen = new Set();
  const wrap = (fn) => async (sql, params) => {
    seen.add(sql);
    return fn(sql, params);
  };
  return { db: { ...db, all: wrap(db.all), one: wrap(db.one), run: wrap(db.run) }, seen };
}

async function withD1(fn) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
  try {
    const d1 = await mf.getD1Database("DB");
    await fn(d1);
  } finally {
    await mf.dispose();
  }
}

test("migration 0003 is additive and safe to run twice", async () => {
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, "").replace(/ON DELETE CASCADE/g, ""), /\b(DROP|ALTER|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  for (const s of statements(MIGRATION)) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, s.slice(0, 60));
  await withD1(async (d1) => {
    await apply(d1, baseSchema());
    await d1.prepare("INSERT INTO users (username, email, email_verified, role, created_at) VALUES ('keep', 'keep@example.com', 1, 'user', '2026-01-01T00:00:00Z')").run();
    const before = (await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results.map((r) => r.name);
    await apply(d1, MIGRATION);
    await apply(d1, MIGRATION);
    const after = (await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results.map((r) => r.name);
    assert.deepEqual(after.filter((t) => !before.includes(t)).sort(), ["alert_cron", "alert_prefs", "alert_rules", "alert_state", "alerts"]);
    assert.ok(before.every((t) => after.includes(t)), "nothing removed");
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 1, "existing rows untouched");
    const idx = (await d1.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_device_telemetry_device'").first());
    assert.ok(idx, "telemetry index created");
  });
});

test("the feature runs end to end on real SQLite, every statement included, and overlapping runs send once", async () => {
  await withD1(async (d1) => {
    await apply(d1, readFileSync(new URL("schema.sql", root), "utf8"));
    await apply(d1, MIGRATION);
    const { db, seen } = recording(createD1Db(d1));
    // Real D1 turns every dev stub off, so the user and bearer token are seeded the way the prod suite does it.
    const ctx = testEnv({ db, NOW_MS: String(T0), COMMUNITY_SECRET: "d1-test-only-secret" });
    await d1.prepare("INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES ('owner', '!no-login', 'owner@example.com', 1, 'Owner', 'user', ?)").bind(iso(T0)).run();
    const owner = { user: await d1.prepare("SELECT id FROM users WHERE username='owner'").first(), token: "d1-test-bearer" };
    await d1.prepare("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, 'test', ?, ?)").bind(owner.user.id, await sha256Hex(owner.token), iso(T0)).run();
    const deviceId = "dev_d1_test";
    await d1
      .prepare("INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, '{}', 'Kitchen', 'active', ?, 1, ?, ?)")
      .bind(deviceId, "hw_d1", owner.user.id, iso(T0), iso(T0))
      .run();
    const put = (body) => call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, body });
    assert.equal((await put({ quiet: { enabled: false }, timezone: "UTC" })).status, 200);
    assert.equal((await call(ctx, "PUT", `/api/devices/${deviceId}/alerts`, { token: owner.token, body: { temperature: { minutes: 10 } } })).status, 200);
    const tel = async (at, doc) => {
      await d1.prepare("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)").bind(
        deviceId,
        JSON.stringify({ temperature_setpoint: 20, humidity_setpoint: 90, temperature: 20, humidity: 90, water_level: 60, ...doc }),
        iso(at)
      ).run();
      await d1.prepare("UPDATE cloud_devices SET last_seen_at=? WHERE id=?").bind(iso(at), deviceId).run();
    };
    for (let m = 15; m >= 0; m -= 5) await tel(T0 - m * MIN, { temperature: 27 });

    const runs = await Promise.all([runAlerts(ctx, { now: T0 }), runAlerts(ctx, { now: T0 })]);
    assert.ok(runs.some((r) => r.skipped), "the second run saw the lease");
    // A repeat run after the lease frees changes nothing.
    assert.equal((await runAlerts(ctx, { now: T0 + 1000 })).notices, 0);
    // A run whose lease expired mid flight replays the same minute: state CAS and dedupe keys hold.
    const saved = await d1.prepare("SELECT * FROM alert_state WHERE rule='temperature'").first();
    await d1.prepare("UPDATE alert_cron SET lease_until=0").run();
    await d1.prepare("UPDATE alert_state SET status='ok', rev=rev+1 WHERE rule='temperature'").run();
    assert.equal((await runAlerts(ctx, { now: T0 })).notices, 0, "the same episode cannot alert twice");
    await d1
      .prepare("UPDATE alert_state SET status=?, episode_key=?, opened_at=?, last_open_notice_at=?, open_notified=? WHERE rule='temperature'")
      .bind(saved.status, saved.episode_key, saved.opened_at, saved.last_open_notice_at, saved.open_notified)
      .run();
    const rows = (await d1.prepare("SELECT rule, kind, status FROM alerts").all()).results;
    assert.deepEqual(rows, [{ rule: "temperature", kind: "open", status: "stub" }]);

    // Quiet hours hold, then release after the problem clears.
    await put({ quiet: { enabled: true, start: "18:00", end: "19:00" } });
    for (let m = 1; m <= 16; m += 5) await tel(T0 + m * MIN, { temperature: 20 });
    await runAlerts(ctx, { now: T0 + 16 * MIN });
    assert.equal((await d1.prepare("SELECT status FROM alerts WHERE kind='recovered'").first()).status, "held");
    await tel(T0 + 60 * MIN, { temperature: 20 });
    await runAlerts(ctx, { now: T0 + 61 * MIN });
    assert.equal((await d1.prepare("SELECT status FROM alerts WHERE kind='recovered'").first()).status, "stub");
    assert.equal((await d1.prepare("SELECT cursor, lease_until FROM alert_cron").first()).lease_until, 0);

    const list = await call(ctx, "GET", `/api/alerts?device=${deviceId}`, { token: owner.token });
    assert.equal(list.data.alerts.length, 2);
    assert.equal((await call(ctx, "GET", "/api/alerts", { token: owner.token })).data.alerts.length, 2);
    const preview = await call(ctx, "GET", `/api/alerts/${list.data.alerts[0].id}/email`, { token: owner.token });
    assert.equal(preview.status, 200);
    assert.equal((await call(ctx, "GET", `/api/devices/${deviceId}/alerts`, { token: owner.token })).status, 200);
    await put({ quiet: { enabled: false } });
    assert.equal((await call(ctx, "POST", "/api/alerts/test", { token: owner.token, body: {} })).status, 200);
    const sent = await d1.prepare(SQL.sentSince).bind(owner.user.id, iso(T0 - 86400000)).first();
    assert.equal(sent.n, 3);
    const token = new URL(preview.data.headers["List-Unsubscribe"].slice(1, -1)).searchParams.get("token");
    assert.equal((await call(ctx, "POST", "/api/alerts/unsubscribe", { body: { token } })).status, 200);

    // Statements only reached on rarer paths still have to be valid SQL here.
    await d1.prepare(SQL.alertsHeld).bind(1).all();
    const unused = Object.entries(SQL).filter(([, sql]) => !seen.has(sql)).map(([name]) => name);
    assert.deepEqual(unused, [], "every SQL constant ran against real SQLite");
  });
});
