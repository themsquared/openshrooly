import { test } from "node:test";
import assert from "node:assert/strict";
import { nowIso } from "../src/crypto.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

// Grow Coach stays hidden from everyone except beta users (COACH_BETA_USER_IDS)
// and entitled users, and only while COACH_AUTOPILOT_ENABLED is on. The API is
// the single source of truth: /api/me and /api/coach carry `available`, and no
// Coach name, price, or state reaches anyone else.

const PRICE = /3\.99|399|amount_cents/;

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", FLEET_UI_ENABLED: "1", COACH_AUTOPILOT_ENABLED: "1", ...extra });
}

async function addDevice(ctx, userId, id) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", "Kitchen", "active", userId, null, null, null, 1, nowIso(), nowIso()]
  );
}

async function entitle(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(
    ctx,
    stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id })
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
}

async function surfaces(ctx, token) {
  const me = await call(ctx, "GET", "/api/me", { token });
  const coach = await call(ctx, "GET", "/api/coach", { token });
  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "hi" } });
  const fleet = await call(ctx, "GET", "/api/fleet/devices", { token });
  return { me, coach, chat, fleet };
}

function assertHidden({ me, coach, chat, fleet }) {
  assert.equal(me.status, 200);
  assert.deepEqual(me.data.grow_coach, { available: false });
  assert.equal(coach.status, 200);
  assert.deepEqual(coach.data, { available: false });
  assert.equal(chat.status, 404);
  assert.doesNotMatch(JSON.stringify(chat.data), /Grow Coach|3\.99/);
  assert.doesNotMatch(JSON.stringify(me.data.grow_coach), PRICE);
  for (const device of fleet.data.devices || []) assert.equal(device.coach, null);
}

function assertShown({ me, coach, fleet }) {
  assert.equal(me.data.grow_coach.available, true);
  assert.equal(coach.data.available, true);
  assert.equal(coach.data.autopilot, true);
  assert.ok(fleet.data.devices.length > 0);
  for (const device of fleet.data.devices) assert.ok(device.coach, "Coach state rides on the device for allowed users");
}

test("no access: a signed in user without beta or entitlement sees no Coach anywhere", async () => {
  const ctx = env({ COACH_BETA_USER_IDS: "999999" });
  const { token, user } = await register(ctx, "plain@example.com");
  await addDevice(ctx, user.id, "dev-plain");
  assertHidden(await surfaces(ctx, token));
  const sub = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  // Checkout is open in the test env (COACH_PUBLIC=1 with stubs), so the buy path still works.
  assert.equal(sub.status, 200);
});

test("anonymous visitors get no Coach catalog or price", async () => {
  const ctx = env();
  const coach = await call(ctx, "GET", "/api/coach");
  assert.deepEqual(coach.data, { available: false });
});

test("beta: an allowlisted user sees Coach on /api/me, /api/coach, and devices", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "beta-vis@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);
  await addDevice(ctx, user.id, "dev-beta-vis");
  const out = await surfaces(ctx, token);
  assertShown(out);
  // Stub provider means no AI, so chat stays off without naming a price.
  assert.equal(out.chat.status, 402);
  assert.doesNotMatch(JSON.stringify(out.chat.data), /3\.99/);
});

test("entitled: a paid user sees Coach and can chat", async () => {
  const ctx = env({ COACH_BETA_USER_IDS: "999999" });
  const { token, user } = await register(ctx, "paid-vis@example.com");
  await addDevice(ctx, user.id, "dev-paid-vis");
  await entitle(ctx, token);
  const out = await surfaces(ctx, token);
  assertShown(out);
  assert.equal(out.me.data.grow_coach.entitled, true);
  assert.equal(out.chat.status, 200, JSON.stringify(out.chat.data));
});

test("flag off: beta and entitled users both see no Coach", async () => {
  const ctx = env({ COACH_AUTOPILOT_ENABLED: "0" });
  const beta = await register(ctx, "beta-off@example.com");
  const paid = await register(ctx, "paid-off@example.com");
  ctx.COACH_BETA_USER_IDS = String(beta.user.id);
  await addDevice(ctx, beta.user.id, "dev-beta-off");
  await addDevice(ctx, paid.user.id, "dev-paid-off");
  await entitle(ctx, paid.token);
  assertHidden(await surfaces(ctx, beta.token));
  assertHidden(await surfaces(ctx, paid.token));
});
