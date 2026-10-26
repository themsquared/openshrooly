import { test } from "node:test";
import assert from "node:assert/strict";
import { nowIso } from "../src/crypto.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

// Grow Coach stays hidden from everyone except beta users (COACH_BETA_USER_IDS)
// and entitled users, and only while COACH_AUTOPILOT_ENABLED is on. The API is
// the single source of truth: /api/me and /api/coach carry `available`, and no
// Coach name, price, or state reaches anyone else.
//
// The one exception is COACH_PUBLIC=1 with working checkout (Stripe or local stubs):
// then anyone can see the catalog and a Subscribe button, but every Coach action
// still needs beta or a paid sub. The test env sets COACH_PUBLIC=1, so the
// "hidden" cases below pass COACH_PUBLIC: "" to match prod as it ships today.

const PRICE = /3\.99|4\.99|\b399\b|\b499\b|4900|amount_cents/;

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

test("COACH_PUBLIC unset: a signed in user without beta or entitlement sees no Coach anywhere", async () => {
  const ctx = env({ COACH_BETA_USER_IDS: "999999", COACH_PUBLIC: "" });
  const { token, user } = await register(ctx, "plain@example.com");
  await addDevice(ctx, user.id, "dev-plain");
  assertHidden(await surfaces(ctx, token));
  const sub = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(sub.status, 404);
  assert.doesNotMatch(JSON.stringify(sub.data), /Grow Coach|3\.99/);
});

test("COACH_PUBLIC unset: anonymous visitors get no Coach catalog or price", async () => {
  const ctx = env({ COACH_PUBLIC: "" });
  const coach = await call(ctx, "GET", "/api/coach");
  assert.deepEqual(coach.data, { available: false });
});

test("COACH_PUBLIC unset: beta user 82 still sees Coach", async () => {
  const ctx = env({ COACH_PUBLIC: "" });
  const { token, user } = await register(ctx, "beta-only@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);
  await addDevice(ctx, user.id, "dev-beta-only");
  assertShown(await surfaces(ctx, token));
});

test("COACH_PUBLIC on but no Stripe: Coach stays hidden for non-beta users", async () => {
  const ctx = env({ COACH_BETA_USER_IDS: "999999" });
  const { token, user } = await register(ctx, "nostripe@example.com");
  await addDevice(ctx, user.id, "dev-nostripe");
  // Turn off local stubs after sign-up so checkout has nothing to run on.
  ctx.DEV_STUBS = "";
  const coach = await call(ctx, "GET", "/api/coach", { token });
  assert.deepEqual(coach.data, { available: false });
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.deepEqual(me.data.grow_coach, { available: false });
  // Stripe key alone is not enough; the Coach price must exist too.
  ctx.STRIPE_SECRET_KEY = "sk_test_placeholder";
  assert.deepEqual((await call(ctx, "GET", "/api/coach", { token })).data, { available: false });
  ctx.STRIPE_PRICE_COACH = "price_placeholder";
  const sellable = await call(ctx, "GET", "/api/coach", { token });
  assert.equal(sellable.data.available, true);
  assert.equal(sellable.data.entitled, false);
});

test("COACH_PUBLIC on: a signed in non-beta user sees the Subscribe state, but every action stays paywalled", async () => {
  const ctx = env({ COACH_BETA_USER_IDS: "999999" });
  const { token, user } = await register(ctx, "shopper@example.com");
  await addDevice(ctx, user.id, "dev-shopper");
  const { me, coach, chat, fleet } = await surfaces(ctx, token);
  assert.equal(coach.data.available, true);
  assert.equal(coach.data.entitled, false);
  assert.equal(coach.data.beta, false);
  assert.equal(coach.data.autopilot, false);
  assert.equal(coach.data.for_sale, true);
  assert.equal(coach.data.waitlist, false);
  assert.equal(coach.data.signed_in, true);
  assert.equal(coach.data.product.amount_cents, 499);
  assert.deepEqual(
    coach.data.product.plans.map((plan) => [plan.id, plan.amount_cents, plan.period, plan.savings_percent]),
    [["monthly", 499, "month", 0], ["yearly", 4900, "year", 18]]
  );
  assert.equal(me.data.grow_coach.available, true);
  assert.equal(me.data.grow_coach.entitled, false);
  assert.equal(me.data.grow_coach.beta, false);
  // Paywalled server side: no chat, no device Coach state, no Autopilot, no suggest.
  assert.equal(chat.status, 404);
  for (const device of fleet.data.devices || []) assert.equal(device.coach, null);
  const photo = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: btoa("x") } });
  assert.equal(photo.status, 404);
  const suggest = await call(ctx, "POST", "/api/coach/suggest", {
    token,
    body: { stage: { humidity_percent: 90, temperature_c: 20 } },
  });
  assert.equal(suggest.status, 404);
  const mode = await call(ctx, "POST", "/api/coach/autopilot/mode", {
    token,
    body: { device_id: "dev-shopper", mode: "autopilot", profile_id: "pearl-oyster" },
  });
  assert.equal(mode.status, 404);
  // The Subscribe button works, and paying unlocks Coach.
  await entitle(ctx, token);
  assertShown(await surfaces(ctx, token));
});

test("COACH_PUBLIC on: anonymous visitors see the catalog with no account details", async () => {
  const ctx = env();
  const coach = await call(ctx, "GET", "/api/coach");
  assert.equal(coach.data.available, true);
  assert.equal(coach.data.entitled, false);
  assert.equal(coach.data.signed_in, false);
  assert.equal(coach.data.autopilot, false);
  const sub = await call(ctx, "POST", "/api/coach/subscribe", { body: {} });
  assert.ok(sub.status === 401 || sub.status === 403, `signed out checkout refused, got ${sub.status}`);
});

test("COACH_PUBLIC on: off-menu never gets Coach, for shoppers or subscribers", async () => {
  const ctx = env({ COACH_BETA_USER_IDS: "999999" });
  const { token } = await register(ctx, "offmenu@example.com");
  const blocked = await call(ctx, "POST", "/api/coach/subscribe", { token, body: { pack: "psilocybin" } });
  assert.equal(blocked.status, 400);
  const unpaidChat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "pins?", pack: "psilocybin" } });
  assert.ok(unpaidChat.status === 400 || unpaidChat.status === 404);
  await entitle(ctx, token);
  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "pins?", pack: "psilocybin" } });
  assert.equal(chat.status, 400);
  const suggest = await call(ctx, "POST", "/api/coach/suggest", {
    token,
    body: { profile: { pack: "psilocybin" }, apply: true, approve: true },
  });
  assert.equal(suggest.status, 400);
  const coach = await call(ctx, "GET", "/api/coach", { token });
  assert.doesNotMatch(JSON.stringify(coach.data), /psilocybin/i);
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
  // Even with COACH_PUBLIC=1 (test default), the kill switch hides Coach from everyone.
  const beta = await register(ctx, "beta-off@example.com");
  const paid = await register(ctx, "paid-off@example.com");
  ctx.COACH_BETA_USER_IDS = String(beta.user.id);
  await addDevice(ctx, beta.user.id, "dev-beta-off");
  await addDevice(ctx, paid.user.id, "dev-paid-off");
  await entitle(ctx, paid.token);
  assertHidden(await surfaces(ctx, beta.token));
  assertHidden(await surfaces(ctx, paid.token));
});
