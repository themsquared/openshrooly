import { test } from "node:test";
import assert from "node:assert/strict";
import { nowIso } from "../src/crypto.js";
import { adminIds, isAdmin } from "../src/admin.js";
import { call, register, testEnv } from "./helpers.js";

const ROUTES = ["/api/admin/overview", "/api/admin/users", "/api/admin/devices", "/api/admin/activations", "/api/admin/spend"];

async function addDevice(ctx, userId, id, { status = "active", lastSeen = nowIso(), hw = `AABBCC${id}` } = {}) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, hw, "{}", `Chamber ${id}`, status, userId, null, null, null, 1, lastSeen, nowIso()]
  );
}

test("admin ids default to 82 and parse a list", () => {
  assert.deepEqual([...adminIds({})], [82]);
  assert.deepEqual([...adminIds({ ADMIN_USER_IDS: "1, 7,x" })], [1, 7]);
  assert.equal(isAdmin({}, { id: 82 }), true);
  assert.equal(isAdmin({}, { id: 1 }), false);
  assert.equal(isAdmin({ ADMIN_USER_IDS: "" }, { id: 82 }), false);
  assert.equal(isAdmin({}, null), false);
});

test("every admin route is a plain 404 for signed-out and non-admin callers", async () => {
  const ctx = testEnv({ ADMIN_USER_IDS: "1" });
  const admin = await register(ctx, "boss@example.com");
  const other = await register(ctx, "grower@example.com");
  assert.equal(admin.user.id, 1);
  const unknown = await call(ctx, "GET", "/api/does-not-exist");
  for (const path of [...ROUTES, "/api/admin", "/api/admin/nope"]) {
    for (const token of [undefined, other.token, "garbage"]) {
      const res = await call(ctx, "GET", path, { token });
      assert.equal(res.status, 404, `${path} ${token ? "token" : "signed out"}`);
      assert.deepEqual(res.data, unknown.data);
    }
  }
  for (const path of ROUTES) {
    assert.equal((await call(ctx, "GET", path, { token: admin.token })).status, 200, path);
    assert.equal((await call(ctx, "POST", path, { token: admin.token, body: {} })).status, 404, path);
  }
  const me = await call(ctx, "GET", "/api/me", { token: admin.token });
  assert.doesNotMatch(JSON.stringify(me.data), /admin/i);
});

test("default admin is user 82 only", async () => {
  const ctx = testEnv();
  const first = await register(ctx, "one@example.com");
  for (const path of ROUTES) assert.equal((await call(ctx, "GET", path, { token: first.token })).status, 404);
});

test("admin numbers come from the tables", async () => {
  const ctx = testEnv({ ADMIN_USER_IDS: "1", STRIPE_SECRET_KEY: "" });
  const admin = await register(ctx, "boss@example.com");
  const grower = await register(ctx, "grower@example.com");
  const gid = grower.user.id;
  await addDevice(ctx, gid, "dev-a");
  await addDevice(ctx, gid, "dev-b", { lastSeen: null });
  await addDevice(ctx, null, "dev-c", { status: "revoked", lastSeen: new Date(Date.now() - 3 * 86400000).toISOString() });
  await ctx.db.run("INSERT INTO security_events (user_id, kind, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)", [gid, "device_claim", "dev-a", "1.2.3.4", nowIso()]);
  await ctx.db.run("INSERT INTO security_events (user_id, kind, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)", [gid, "refresh_rotate", "", "1.2.3.4", nowIso()]);
  const today = nowIso().slice(0, 10);
  await ctx.db.run("INSERT OR REPLACE INTO coach_cache (cache_key, value, expires_at) VALUES (?, ?, ?)", [
    `jev:device:dev-a:${today}`,
    JSON.stringify({ calls: 10, tokens: 0 }),
    nowIso(),
  ]);
  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  await ctx.db.run(
    "INSERT INTO coach_autopilot_log (device_id, user_id, action, old_value, new_value, reason, readings, undone_at, command_id, apply_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["dev-a", gid, "temperature", "18", "17", "jev", JSON.stringify({ decider: { decider: "jev", usage: { input_tokens: 1e6 } } }), null, null, null, old]
  );
  await ctx.db.run(
    "INSERT INTO checkouts (id, user_id, item_id, provider, status, amount_cents, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["cs_test_1", gid, "grow-coach", "stripe", "paid", 499, JSON.stringify({ plan: "monthly" }), nowIso()]
  );
  await ctx.db.run("INSERT INTO coach_subs (user_id, status, period_end, auto_tune, created_at) VALUES (?, ?, ?, ?, ?)", [
    gid,
    "active",
    new Date(Date.now() + 86400000).toISOString(),
    0,
    nowIso(),
  ]);

  const o = (await call(ctx, "GET", "/api/admin/overview", { token: admin.token })).data;
  assert.equal(o.users.total, 2);
  assert.equal(o.users.new_24h, 2);
  assert.equal(o.chambers.linked, 2);
  assert.equal(o.chambers.seen_24h, 1);
  assert.equal(o.beta_cap.cap, 50);
  assert.equal(o.subscriptions.active, 1);
  assert.equal(o.payments_mode, "off");

  const u = (await call(ctx, "GET", "/api/admin/users", { token: admin.token })).data.users;
  const g = u.find((r) => r.id === gid);
  assert.equal(g.chambers, 2);
  assert.equal(g.subscription.status, "active");
  assert.equal(g.subscription.plan, "monthly");
  assert.ok(g.last_login_at);
  assert.equal(g.feedback, null);

  const d = (await call(ctx, "GET", "/api/admin/devices", { token: admin.token })).data.devices;
  const byId = Object.fromEntries(d.map((r) => [r.id, r]));
  assert.equal(byId["dev-a"].state, "online");
  assert.equal(byId["dev-a"].mac_tail, "Cdev-a");
  assert.equal(byId["dev-a"].mode, "manual");
  assert.equal(byId["dev-b"].state, "never");
  assert.equal(byId["dev-c"].state, "offline");
  assert.equal(byId["dev-c"].owner, null);

  const a = (await call(ctx, "GET", "/api/admin/activations", { token: admin.token })).data;
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].device_id, "dev-a");
  assert.doesNotMatch(JSON.stringify(a), /1\.2\.3\.4/);

  const s = (await call(ctx, "GET", "/api/admin/spend", { token: admin.token })).data;
  const row = s.users.find((r) => r.user_id === gid);
  assert.equal(row.jev_calls.today, 10);
  assert.equal(row.jev_calls["7d"], 11);
  assert.equal(row.jev_cost.today, 0.00114);
  assert.equal(row.jev_cost["7d"], 0.04314);
  assert.equal(row.revenue_test_cents.today, 499);
  assert.equal(row.revenue_cents.today, 0);
  assert.ok(row.emails["30d"] >= 1, "sign-in link counts as an email");
  assert.equal(s.chambers[0].device_id, "dev-a");
  assert.equal(s.chambers[0].lower_bound_days.today, 0);
  assert.equal(s.chambers[0].lower_bound_days["7d"], 1);
  assert.doesNotMatch(JSON.stringify(s), /sk_|whsec/);
});
