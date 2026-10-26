import { test } from "node:test";
import assert from "node:assert/strict";
import { call, register, testEnv } from "./helpers.js";
import { runAlerts } from "../src/alerts/cron.js";
import { makeUnsubToken } from "../src/alerts/unsub.js";

const MIN = 60000;
const T0 = Date.parse("2026-07-15T18:00:00Z"); // 11:00 in Los Angeles
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

async function addDevice(ctx, ownerId, { id = `dev_${ownerId}_${Math.random().toString(36).slice(2, 8)}`, name = "Kitchen", seen = T0 } = {}) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw_${id}`, "{}", name, "active", ownerId, null, null, null, 1, iso(seen), iso(T0 - 86400000)]
  );
  return id;
}

async function reading(ctx, deviceId, at, doc) {
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    deviceId,
    JSON.stringify({ temperature_setpoint: 20, humidity_setpoint: 90, temperature: 20, humidity: 90, water_level: 60, ...doc }),
    iso(at),
  ]);
  await ctx.db.run("UPDATE cloud_devices SET last_seen_at=? WHERE id=?", [iso(at), deviceId]);
}

async function setup(extra = {}) {
  const ctx = testEnv({ NOW_MS: String(T0), ...extra });
  const owner = await register(ctx, "owner@example.com");
  const other = await register(ctx, "other@example.com");
  const deviceId = await addDevice(ctx, owner.user.id);
  const otherDevice = await addDevice(ctx, other.user.id, { name: "Garage" });
  return { ctx, owner, other, deviceId, otherDevice };
}

function captureLogs() {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  return { lines, restore: () => (console.log = orig) };
}

test("alert endpoints need a signed in, verified user", async () => {
  const { ctx, owner, deviceId } = await setup();
  for (const [method, path] of [
    ["GET", "/api/alerts"],
    ["GET", "/api/alerts/prefs"],
    ["PUT", "/api/alerts/prefs"],
    ["POST", "/api/alerts/test"],
    ["GET", "/api/alerts/1/email"],
    ["GET", `/api/devices/${deviceId}/alerts`],
    ["PUT", `/api/devices/${deviceId}/alerts`],
  ]) {
    const res = await call(ctx, method, path, { body: method === "GET" ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${path} anonymous`);
    const bad = await call(ctx, method, path, { token: "not-a-real-session", body: method === "GET" ? undefined : {} });
    assert.equal(bad.status, 401, `${method} ${path} junk session`);
  }
  await ctx.db.run("UPDATE users SET email_verified=? WHERE id=?", [0, owner.user.id]);
  for (const [method, path] of [
    ["GET", "/api/alerts"],
    ["PUT", "/api/alerts/prefs"],
    ["POST", "/api/alerts/test"],
    ["GET", `/api/devices/${deviceId}/alerts`],
  ]) {
    const res = await call(ctx, method, path, { token: owner.token, body: method === "GET" ? undefined : { email: true } });
    assert.equal(res.status, 403, `${method} ${path} unverified`);
    assert.match(res.data.error, /verified email/);
  }
});

test("no one can read or change another person's device alerts (IDOR)", async () => {
  const { ctx, owner, other, deviceId, otherDevice } = await setup();
  await reading(ctx, otherDevice, T0 - 5 * MIN, { water_level: 3 });
  await runAlerts(ctx, { now: T0 });
  const theirs = await call(ctx, "GET", "/api/alerts", { token: other.token });
  assert.equal(theirs.data.alerts.length, 1);
  const theirAlertId = theirs.data.alerts[0].id;

  const cases = [
    ["GET", `/api/devices/${otherDevice}/alerts`],
    ["PUT", `/api/devices/${otherDevice}/alerts`, { water: { enabled: false } }],
    ["GET", `/api/alerts?device=${otherDevice}`],
    ["GET", "/api/devices/does-not-exist/alerts"],
    ["PUT", "/api/devices/does-not-exist/alerts", { water: { enabled: false } }],
  ];
  for (const [method, path, body] of cases) {
    const res = await call(ctx, method, path, { token: owner.token, body });
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(res.data.error, "not your device");
  }
  const preview = await call(ctx, "GET", `/api/alerts/${theirAlertId}/email`, { token: owner.token });
  assert.equal(preview.status, 404, "another person's alert email is not found");
  const mine = await call(ctx, "GET", "/api/alerts", { token: owner.token });
  assert.equal(mine.data.alerts.length, 0, "the list is scoped to the caller");

  // Rules written for a device stop applying once it changes hands.
  await call(ctx, "PUT", `/api/devices/${deviceId}/alerts`, { token: owner.token, body: { water: { enabled: false } } });
  await ctx.db.run("UPDATE cloud_devices SET status=?, owner_id=?, cloud_enabled=?, public_jwk=?, enroll_hash=?, claim_code_hash=?, claim_expires_at=? WHERE id=?", [
    "active", other.user.id, 1, "{}", null, null, null, deviceId,
  ]);
  const handed = await call(ctx, "GET", `/api/devices/${deviceId}/alerts`, { token: other.token });
  assert.equal(handed.status, 200);
  assert.equal(handed.data.rules.water.enabled, true, "new owner starts from defaults, not the old owner's rules");
  const old = await call(ctx, "GET", `/api/devices/${deviceId}/alerts`, { token: owner.token });
  assert.equal(old.status, 403);
});

test("settings round trip, validation errors, and body limits", async () => {
  const { ctx, owner, deviceId } = await setup();
  const view = await call(ctx, "GET", `/api/devices/${deviceId}/alerts`, { token: owner.token });
  assert.equal(view.status, 200);
  assert.equal(view.headers.get("cache-control"), "no-store");
  assert.equal(view.data.rules.temperature.minutes, 30);
  assert.equal(view.data.delivery.email, "stub");
  assert.equal(view.data.delivery.push, "not available");
  assert.ok(view.data.profiles.some((p) => p.id === "lions-mane"));
  assert.ok(!view.data.profiles.some((p) => p.id === "golden-teacher"));

  const put = await call(ctx, "PUT", `/api/devices/${deviceId}/alerts`, {
    token: owner.token,
    body: { temperature: { minutes: 45 }, grow: { profile_id: "lions-mane", started_on: "2026-07-01" } },
  });
  assert.equal(put.status, 200);
  assert.equal(put.data.rules.temperature.minutes, 45);
  for (const body of [{ temperature: { minutes: 2 } }, { grow: { profile_id: "golden-teacher", started_on: "2026-07-01" } }, { offline: { minutes: "x" } }]) {
    const res = await call(ctx, "PUT", `/api/devices/${deviceId}/alerts`, { token: owner.token, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const prefs = await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, body: { timezone: "Europe/Berlin", quiet: { enabled: true, start: "23:00", end: "06:00" } } });
  assert.equal(prefs.status, 200);
  assert.equal(prefs.data.prefs.timezone, "Europe/Berlin");
  assert.equal((await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, body: { timezone: "Nowhere/Land" } })).status, 400);
  assert.equal((await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, rawBody: "[1,2]" })).status, 400);
  const big = await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, rawBody: JSON.stringify({ pad: "x".repeat(9000) }) });
  assert.equal(big.status, 413);
});

test("alert writes share the 30 per hour limit, and test emails stop at 5 per hour", async () => {
  const { ctx, owner, deviceId } = await setup();
  let last;
  for (let i = 0; i < 31; i += 1) {
    const path = i % 2 ? "/api/alerts/prefs" : `/api/devices/${deviceId}/alerts`;
    last = await call(ctx, "PUT", path, { token: owner.token, body: i % 2 ? { cooldown_minutes: 60 } : { water: { below: 20 } } });
    if (i < 30) assert.equal(last.status, 200, `write ${i}`);
  }
  assert.equal(last.status, 429);

  const fresh = await setup();
  for (let i = 0; i < 5; i += 1) {
    const res = await call(fresh.ctx, "POST", "/api/alerts/test", { token: fresh.owner.token, body: {} });
    assert.equal(res.status, 200, `test ${i}`);
    assert.equal(res.data.alert.status, "stub");
    fresh.ctx.NOW_MS = String(Number(fresh.ctx.NOW_MS) + 1000);
  }
  assert.equal((await call(fresh.ctx, "POST", "/api/alerts/test", { token: fresh.owner.token, body: {} })).status, 429);
});

test("one click unsubscribe: POST only, signed, idempotent, rate limited", async () => {
  const { ctx, owner } = await setup();
  const token = await makeUnsubToken(ctx, owner.user.id, T0);
  const get = await call(ctx, "GET", `/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`);
  assert.equal(get.status, 302);
  assert.match(get.headers.get("location"), /\/alerts-unsub\?token=/);
  assert.equal((await call(ctx, "GET", "/api/alerts/prefs", { token: owner.token })).data.prefs.email, true, "GET changed nothing");

  const bad = await call(ctx, "POST", `/api/alerts/unsubscribe?token=${encodeURIComponent(token.slice(0, -2))}xx`);
  assert.equal(bad.status, 400);
  const expired = await makeUnsubToken(ctx, owner.user.id, T0 - 61 * 86400000);
  assert.equal((await call(ctx, "POST", "/api/alerts/unsubscribe", { body: { token: expired } })).status, 400);

  // Mail clients send a form body: List-Unsubscribe=One-Click
  const ok = await call(ctx, "POST", `/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`, {
    rawBody: "List-Unsubscribe=One-Click",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(ok.status, 200);
  const after = await call(ctx, "GET", "/api/alerts/prefs", { token: owner.token });
  assert.equal(after.data.prefs.email, false);
  assert.equal(after.data.prefs.unsubscribed, true);
  assert.equal((await call(ctx, "POST", "/api/alerts/unsubscribe", { body: { token } })).status, 200, "repeat is fine");
  assert.equal((await call(ctx, "POST", "/api/alerts/test", { token: owner.token, body: {} })).status, 409);
  const back = await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, body: { email: true } });
  assert.equal(back.data.prefs.unsubscribed, false);

  let status;
  // Four POSTs so far; the limit is 30 per hour per client.
  for (let i = 0; i < 26; i += 1) status = (await call(ctx, "POST", "/api/alerts/unsubscribe", { body: { token: "x" } })).status;
  assert.equal(status, 400);
  assert.equal((await call(ctx, "POST", "/api/alerts/unsubscribe", { body: { token } })).status, 429);
});

test("cron: a hot chamber alerts once, recovers once, and the stub log carries no address", async () => {
  const { ctx, owner, deviceId } = await setup();
  await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, body: { quiet: { enabled: false } } });
  for (let m = 40; m >= 0; m -= 5) await reading(ctx, deviceId, T0 - m * MIN, { temperature: 26 });
  const logs = captureLogs();
  let first;
  try {
    first = await runAlerts(ctx, { now: T0 });
    const again = await runAlerts(ctx, { now: T0 + 1000 });
    assert.equal(again.notices, 0, "a repeat run adds nothing");
  } finally {
    logs.restore();
  }
  assert.equal(first.notices, 1);
  assert.equal(first.delivered, 1);
  const stub = logs.lines.filter((l) => l.includes("alert_email_stub"));
  assert.equal(stub.length, 1);
  assert.ok(!stub[0].includes("owner@example.com"), "no address in logs");

  const list = await call(ctx, "GET", "/api/alerts", { token: owner.token });
  assert.deepEqual(list.data.alerts.map((a) => [a.rule, a.kind, a.status]), [["temperature", "open", "stub"]]);
  assert.match(list.data.alerts[0].title, /^Kitchen: temperature is too high$/);
  const email = await call(ctx, "GET", `/api/alerts/${list.data.alerts[0].id}/email`, { token: owner.token });
  assert.equal(email.data.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(email.data.headers["List-Unsubscribe"], /^<https?:\/\/[^>]+\/api\/alerts\/unsubscribe\?token=/);
  assert.ok(email.data.text.includes("Works with Shrooly devices running OpenShrooly."));

  for (let m = 1; m <= 15; m += 5) await reading(ctx, deviceId, T0 + m * MIN, { temperature: 20 });
  const rec = await runAlerts(ctx, { now: T0 + 12 * MIN });
  assert.equal(rec.notices, 1);
  const after = await call(ctx, "GET", `/api/alerts?device=${deviceId}`, { token: owner.token });
  assert.deepEqual(after.data.alerts.map((a) => [a.kind, a.status]), [["recovered", "stub"], ["open", "stub"]]);
  const state = await call(ctx, "GET", `/api/devices/${deviceId}/alerts`, { token: owner.token });
  assert.equal(state.data.states.temperature, "ok");
});

test("cron: quiet hours hold alerts, then one combined email; a night that fixed itself stays quiet", async () => {
  // 2026-07-16 05:00 UTC is 22:00 in Los Angeles: quiet hours (22:00 to 07:00) are on.
  const night = Date.parse("2026-07-16T05:00:00Z");
  const { ctx, owner, deviceId, otherDevice } = await setup({ NOW_MS: String(night) });
  for (const at of [night, night + 61 * MIN, Date.parse("2026-07-16T14:05:00Z")]) await reading(ctx, otherDevice, at - MIN, {});
  const second = await addDevice(ctx, owner.user.id, { name: "Closet", seen: night });
  await reading(ctx, deviceId, night - MIN, { water_level: 4 });
  await reading(ctx, second, night - MIN, { water_level: 6 });
  const held = await runAlerts(ctx, { now: night });
  assert.equal(held.notices, 2);
  assert.equal(held.delivered, 0);

  // The closet gets refilled overnight: its open notice expires and its recovery is never sent.
  await reading(ctx, second, night + 60 * MIN, { water_level: 80 });
  await reading(ctx, deviceId, night + 60 * MIN, { water_level: 4 });
  await runAlerts(ctx, { now: night + 61 * MIN });

  const morning = Date.parse("2026-07-16T14:05:00Z"); // 07:05 PDT
  await reading(ctx, deviceId, morning - MIN, { water_level: 4 });
  await reading(ctx, second, morning - MIN, { water_level: 80 });
  const logs = captureLogs();
  let out;
  try {
    out = await runAlerts(ctx, { now: morning });
  } finally {
    logs.restore();
  }
  assert.equal(out.delivered, 1, "one email in the morning");
  assert.equal(logs.lines.filter((l) => l.includes("alert_email_stub")).length, 1);
  const list = (await call(ctx, "GET", "/api/alerts", { token: owner.token })).data.alerts;
  const by = Object.fromEntries(list.map((a) => [`${a.device_id === second ? "closet" : "kitchen"}:${a.kind}`, a.status]));
  assert.deepEqual(by, { "kitchen:open": "stub", "closet:open": "expired", "closet:recovered": "expired" });
});

test("cron: unverified or muted owners never get email, and the record says why", async () => {
  const { ctx, owner, other, deviceId, otherDevice } = await setup();
  await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, body: { quiet: { enabled: false } } });
  await call(ctx, "PUT", "/api/alerts/prefs", { token: other.token, body: { email: false, quiet: { enabled: false } } });
  await ctx.db.run("UPDATE users SET email_verified=? WHERE id=?", [0, owner.user.id]);
  await reading(ctx, deviceId, T0 - MIN, { water_level: 2 });
  await reading(ctx, otherDevice, T0 - MIN, { water_level: 2 });
  const out = await runAlerts(ctx, { now: T0 });
  assert.equal(out.notices, 2);
  assert.equal(out.delivered, 0);
  const rows = await ctx.db.all("SELECT * FROM alerts WHERE user_id=? ORDER BY id DESC LIMIT ?", [owner.user.id, 50]);
  assert.equal(rows[0].status, "unverified");
  const muted = (await call(ctx, "GET", "/api/alerts", { token: other.token })).data.alerts;
  assert.equal(muted[0].status, "muted");
});

test("cron: overlapping runs never double send", async () => {
  const { ctx, owner, deviceId } = await setup();
  await call(ctx, "PUT", "/api/alerts/prefs", { token: owner.token, body: { quiet: { enabled: false } } });
  await reading(ctx, deviceId, T0 - MIN, { water_level: 1 });
  const logs = captureLogs();
  let results;
  try {
    results = await Promise.all([runAlerts(ctx, { now: T0 }), runAlerts(ctx, { now: T0 }), runAlerts(ctx, { now: T0 + 1 })]);
  } finally {
    logs.restore();
  }
  assert.equal(results.filter((r) => r.skipped).length, 2, "the lease lets one run work");
  assert.equal(logs.lines.filter((l) => l.includes("alert_email_stub")).length, 1);
  const after = await runAlerts(ctx, { now: T0 + 60000 });
  assert.equal(after.notices, 0);
  const list = (await call(ctx, "GET", "/api/alerts", { token: owner.token })).data.alerts;
  assert.equal(list.length, 1);
});
