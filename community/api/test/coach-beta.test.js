import { test } from "node:test";
import assert from "node:assert/strict";
import { betaActive, betaOwnerIds, coachAccess } from "../src/coach-access.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

// Coach is public. Beta users (a linked chamber among the first BETA_LINK_CAP linked chambers)
// get Coach and Autopilot free while BETA_ACTIVE is on. Everyone else needs a paid plan.

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", FLEET_UI_ENABLED: "1", COACH_AUTOPILOT_ENABLED: "1", COACH_BETA_USER_IDS: "", ...extra });
}

let seq = 0;
async function addDevice(ctx, userId, id, { status = "active" } = {}) {
  // Strictly increasing created_at so beta order is the insert order.
  const created = new Date(Date.UTC(2026, 0, 1) + seq++ * 60000).toISOString();
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", "Kitchen", status, userId, null, null, null, 1, new Date().toISOString(), created]
  );
}

async function pay(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: { plan: "monthly" } });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(ctx, stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id }));
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
}

const SUGGEST = { stage: { humidity_percent: 90, temperature_c: 20 } };

/** Status codes for every Coach surface that checks access. */
async function gates(ctx, token, deviceId) {
  const suggest = await call(ctx, "POST", "/api/coach/suggest", { token, body: SUGGEST });
  const decisions = await call(ctx, "GET", "/api/coach/decisions", { token });
  const overview = await call(ctx, "GET", "/api/coach/overview", { token });
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", { token, body: { device_id: deviceId, mode: "advisor" } });
  const fleet = await call(ctx, "GET", "/api/fleet/devices", { token });
  return {
    suggest: suggest.status,
    decisions: decisions.status,
    overview: overview.status,
    mode: mode.status,
    chamberCoach: fleet.data?.devices?.find((d) => d.id === deviceId)?.coach ? "on" : "off",
  };
}

const OPEN = { suggest: 200, decisions: 200, overview: 200, mode: 200, chamberCoach: "on" };
const PAYWALL = { suggest: 402, decisions: 402, overview: 402, mode: 402, chamberCoach: "off" };

test("BETA_ACTIVE defaults on; only 0/false/off turn it off", () => {
  assert.equal(betaActive({}), true);
  assert.equal(betaActive({ BETA_ACTIVE: "1" }), true);
  for (const v of ["0", "false", "off", " OFF "]) assert.equal(betaActive({ BETA_ACTIVE: v }), false, v);
});

test("beta owners are the owners of the first cap linked chambers, oldest first", () => {
  const rows = [
    { id: "c", owner_id: 3, status: "active", created_at: "2026-01-03" },
    { id: "a", owner_id: 1, status: "claimed", created_at: "2026-01-01" },
    { id: "x", owner_id: 9, status: "revoked", created_at: "2025-12-01" },
    { id: "u", owner_id: null, status: "active", created_at: "2025-12-02" },
    { id: "b", owner_id: 2, status: "active", created_at: "2026-01-02" },
  ];
  assert.deepEqual([...betaOwnerIds(rows, 2)].sort(), [1, 2]);
  assert.deepEqual([...betaOwnerIds(rows, 50)].sort(), [1, 2, 3]);
});

test("a beta user gets Coach and Autopilot with BETA_ACTIVE on and loses them with it off", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "beta@example.com");
  await addDevice(ctx, user.id, "dev-beta");
  assert.deepEqual(await gates(ctx, token, "dev-beta"), OPEN);
  const coach = (await call(ctx, "GET", "/api/coach", { token })).data;
  assert.equal(coach.entitled, true);
  assert.equal(coach.beta, true);
  assert.equal(coach.access, "beta");
  assert.equal(coach.beta_active, true);
  assert.equal(coach.chambers, 1);
  const me = (await call(ctx, "GET", "/api/me", { token })).data.grow_coach;
  assert.equal(me.entitled, true);
  assert.equal(me.access, "beta");

  ctx.BETA_ACTIVE = "0";
  assert.deepEqual(await gates(ctx, token, "dev-beta"), PAYWALL);
  const after = (await call(ctx, "GET", "/api/coach", { token })).data;
  assert.equal(after.available, true);
  assert.equal(after.entitled, false);
  assert.equal(after.access, null);
  assert.equal(after.beta_active, false);
  // Autopilot stops for the chamber too.
  const { runAutopilotForDevice } = await import("../src/coach-autopilot.js");
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", ["dev-beta"]);
  const run = await runAutopilotForDevice(ctx.db, ctx, { device, user });
  assert.equal(run.skipped, "not_entitled");
});

test("a user whose chamber is past the beta cap gets 402 until subscribed", async () => {
  const ctx = env({ BETA_LINK_CAP: "1" });
  const first = await register(ctx, "first@example.com");
  const late = await register(ctx, "late@example.com");
  await addDevice(ctx, first.user.id, "dev-first");
  await addDevice(ctx, late.user.id, "dev-late");
  assert.equal((await coachAccess(ctx, ctx.db, first.user)).via, "beta");
  assert.equal((await coachAccess(ctx, ctx.db, late.user)).via, null);
  assert.deepEqual(await gates(ctx, late.token, "dev-late"), PAYWALL);
  const coach = (await call(ctx, "GET", "/api/coach", { token: late.token })).data;
  assert.equal(coach.for_sale, true);
  assert.equal(coach.entitled, false);
  await pay(ctx, late.token);
  assert.deepEqual(await gates(ctx, late.token, "dev-late"), OPEN);
  assert.equal((await call(ctx, "GET", "/api/coach", { token: late.token })).data.access, "paid");
});

test("a user with no chamber is not a beta user and gets 402 until subscribed", async () => {
  const ctx = env();
  const { token } = await register(ctx, "nochamber@example.com");
  const coach = (await call(ctx, "GET", "/api/coach", { token })).data;
  assert.equal(coach.available, true);
  assert.equal(coach.chambers, 0);
  assert.equal(coach.entitled, false);
  assert.equal((await call(ctx, "POST", "/api/coach/suggest", { token, body: SUGGEST })).status, 402);
  await pay(ctx, token);
  assert.equal((await call(ctx, "POST", "/api/coach/suggest", { token, body: SUGGEST })).status, 200);
});

test("a subscribed user keeps access with BETA_ACTIVE on or off, beta chamber or not", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "paid@example.com");
  await addDevice(ctx, user.id, "dev-paid");
  await pay(ctx, token);
  for (const flag of ["1", "0"]) {
    ctx.BETA_ACTIVE = flag;
    assert.deepEqual(await gates(ctx, token, "dev-paid"), OPEN, `BETA_ACTIVE=${flag}`);
    assert.equal((await call(ctx, "GET", "/api/coach", { token })).data.access, "paid");
  }
});

test("signed out callers get 401 from every Coach action and see the public catalog", async () => {
  const ctx = env();
  assert.equal((await call(ctx, "POST", "/api/coach/suggest", { body: SUGGEST })).status, 401);
  assert.equal((await call(ctx, "GET", "/api/coach/decisions")).status, 401);
  assert.equal((await call(ctx, "GET", "/api/coach/overview")).status, 401);
  assert.equal((await call(ctx, "POST", "/api/coach/autopilot/mode", { body: { device_id: "x", mode: "advisor" } })).status, 401);
  assert.equal((await call(ctx, "POST", "/api/coach/chat", { body: { message: "hi" } })).status, 401);
  assert.equal((await call(ctx, "POST", "/api/coach/subscribe", { body: { plan: "monthly" } })).status, 401);
  const coach = (await call(ctx, "GET", "/api/coach")).data;
  assert.equal(coach.available, true);
  assert.equal(coach.signed_in, false);
  assert.equal(coach.entitled, false);
  assert.equal(coach.beta_active, true);
  assert.deepEqual(coach.product.plans.map((p) => p.amount_cents), [499, 4900]);
});

test("the kill switch still hides Coach from beta and paid users", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "killed@example.com");
  await addDevice(ctx, user.id, "dev-killed");
  ctx.COACH_AUTOPILOT_ENABLED = "0";
  const g = await gates(ctx, token, "dev-killed");
  assert.equal(g.suggest, 404);
  assert.equal(g.mode, 404);
  assert.equal(g.chamberCoach, "off");
});

test("admin shows who has Coach through the beta and who pays", async () => {
  const ctx = env({ ADMIN_USER_IDS: "1", BETA_LINK_CAP: "2", COACH_BETA_USER_IDS: "1" });
  const admin = await register(ctx, "boss@example.com");
  const beta = await register(ctx, "b@example.com");
  const paid = await register(ctx, "p@example.com");
  const late = await register(ctx, "l@example.com");
  await addDevice(ctx, beta.user.id, "dev-b1");
  await addDevice(ctx, paid.user.id, "dev-p1");
  await addDevice(ctx, late.user.id, "dev-l1");
  await pay(ctx, paid.token);
  const users = (await call(ctx, "GET", "/api/admin/users", { token: admin.token })).data.users;
  const via = Object.fromEntries(users.map((u) => [u.id, u.coach_access]));
  assert.deepEqual(via, { [admin.user.id]: "comp", [beta.user.id]: "beta", [paid.user.id]: "paid", [late.user.id]: null });
  const o = (await call(ctx, "GET", "/api/admin/overview", { token: admin.token })).data;
  assert.deepEqual(o.coach_access, { beta_active: true, beta: 1, paid: 1, comp: 1 });
  ctx.BETA_ACTIVE = "0";
  const off = (await call(ctx, "GET", "/api/admin/overview", { token: admin.token })).data;
  assert.deepEqual(off.coach_access, { beta_active: false, beta: 0, paid: 1, comp: 1 });
});
