import { test } from "node:test";
import assert from "node:assert/strict";
import { hmacSha256Hex } from "../src/crypto.js";
import { stripeForm } from "../src/stripe.js";
import { call, register as registerWithStubs, signedWebhook, testEnv, TEST_WEBHOOK_SECRET } from "./helpers.js";

// Sign-in in tests uses the dev stub magic link. Turn stubs off right after, so checkout takes the real path.
async function register(ctx, email) {
  const stubs = ctx.DEV_STUBS;
  ctx.DEV_STUBS = "1";
  try {
    return await registerWithStubs(ctx, email);
  } finally {
    ctx.DEV_STUBS = stubs;
  }
}

/** Fake Stripe API: records every request and answers like Stripe does. */
function fakeStripe({ fail = false } = {}) {
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => {
    const form = new URLSearchParams(init.body);
    calls.push({ url, headers: init.headers, form });
    if (fail) return new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing" } }), { status: 400 });
    n += 1;
    if (url.endsWith("/billing_portal/sessions")) return Response.json({ id: `bps_${n}`, url: `https://billing.stripe.com/p/session/test_${n}` });
    return Response.json({ id: `cs_live_fake_${n}`, url: `https://checkout.stripe.com/c/pay/cs_live_fake_${n}` });
  };
  return { calls, fetch };
}

function liveEnv(extra = {}) {
  const stripe = fakeStripe(extra.stripe || {});
  const ctx = testEnv({
    DEV_STUBS: "",
    STRIPE_SECRET_KEY: "sk_test_fake_not_real",
    STRIPE_PRICE_COACH: "price_coach_test",
    COACH_AUTOPILOT_ENABLED: "1",
    fetch: stripe.fetch,
    ...extra.env,
  });
  return { ctx, stripe };
}

const unix = (ms) => Math.floor(ms / 1000);

function event(id, type, object) {
  return { id, object: "event", type, data: { object } };
}

async function hasCoach(ctx, token) {
  const me = await call(ctx, "GET", "/api/me", { token });
  return Boolean(me.data.grow_coach?.entitled);
}

test("stripeForm flattens nested params the way Stripe expects", () => {
  const form = stripeForm({ mode: "payment", metadata: { user_id: "7" }, line_items: [{ price: "price_1", quantity: 1 }], skip: undefined });
  assert.equal(form.get("mode"), "payment");
  assert.equal(form.get("metadata[user_id]"), "7");
  assert.equal(form.get("line_items[0][price]"), "price_1");
  assert.equal(form.get("line_items[0][quantity]"), "1");
  assert.equal(form.has("skip"), false);
});

test("without keys, checkout says coming soon and never calls Stripe", async () => {
  const stripe = fakeStripe();
  const ctx = testEnv({ DEV_STUBS: "", fetch: stripe.fetch });
  const { token } = await register(ctx, "nokeys@example.com");
  const res = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(res.status, 503);
  assert.equal(res.data.coming_soon, true);
  const caps = await call(ctx, "GET", "/api/capabilities");
  assert.equal(caps.data.payments, false);
  assert.equal(stripe.calls.length, 0);
});

test("profile checkout opens a real Stripe session with an idempotency key and stores it", async () => {
  const { ctx, stripe } = liveEnv();
  const { token, user } = await register(ctx, "buyer@example.com");
  const res = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(res.data.checkout_url, /^https:\/\/checkout\.stripe\.com\//);
  const [req] = stripe.calls;
  assert.equal(req.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.match(req.headers["idempotency-key"], /^checkout-chk_/);
  assert.equal(req.form.get("mode"), "payment");
  assert.equal(req.form.get("metadata[user_id]"), String(user.id));
  assert.equal(req.form.get("metadata[item_id]"), "king-oyster-thick-stem");
  assert.equal(req.form.get("line_items[0][price_data][currency]"), "usd");
  assert.ok(Number(req.form.get("line_items[0][price_data][unit_amount]")) > 0);
  assert.match(req.form.get("success_url"), /checkout=success/);
  const row = await ctx.db.one("SELECT * FROM checkouts WHERE id=?", [res.data.id]);
  assert.equal(row.status, "requires_payment");
});

test("a Stripe error returns a friendly 502 and stores nothing", async () => {
  const { ctx } = liveEnv({ stripe: { fail: true } });
  const { token } = await register(ctx, "err@example.com");
  const res = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(res.status, 502);
  assert.doesNotMatch(JSON.stringify(res.data), /sk_test|resource_missing/);
  const me = await call(ctx, "GET", "/api/me", { token });
  const rows = await ctx.db.all("SELECT * FROM checkouts WHERE user_id=? AND item_id=? AND status=? ORDER BY created_at DESC", [
    me.data.user.id,
    "king-oyster-thick-stem",
    "requires_payment",
  ]);
  assert.equal(rows.length, 0);
});

test("yearly is 18% under twelve monthly payments", async () => {
  const { COACH_PLANS, COACH_YEARLY_SAVINGS_PERCENT, coachPlanId } = await import("../src/coach-learn.js");
  assert.equal(COACH_PLANS.monthly.amount_cents, 499);
  assert.equal(COACH_PLANS.yearly.amount_cents, 4900);
  assert.equal(12 * 499, 5988);
  assert.ok(Math.abs((1 - 4900 / 5988) * 100 - 18.2) < 0.05);
  assert.equal(COACH_YEARLY_SAVINGS_PERCENT, 18);
  assert.equal(coachPlanId(undefined), "monthly");
  assert.equal(coachPlanId("Yearly"), "yearly");
  assert.equal(coachPlanId("weekly"), "");
});

test("price ids: STRIPE_PRICE_MONTHLY wins, STRIPE_PRICE_COACH still works for monthly, yearly has its own", async () => {
  const { coachPriceId } = await import("../src/stripe.js");
  assert.equal(coachPriceId({ STRIPE_PRICE_COACH: "price_old" }, "monthly"), "price_old");
  assert.equal(coachPriceId({ STRIPE_PRICE_COACH: "price_old", STRIPE_PRICE_MONTHLY: "price_m" }, "monthly"), "price_m");
  assert.equal(coachPriceId({ STRIPE_PRICE_COACH: "price_old" }, "yearly"), "");
  assert.equal(coachPriceId({ STRIPE_PRICE_YEARLY: "price_y" }, "yearly"), "price_y");
  assert.equal(coachPriceId({ STRIPE_PRICE_YEARLY: "price_y" }), "");
  assert.equal(coachPriceId({ STRIPE_PRICE_MONTHLY: "price_m" }, "weekly"), "");
});

test("a missing yearly price id says not available yet and never calls Stripe; monthly still works", async () => {
  const { ctx, stripe } = liveEnv({ env: { STRIPE_PRICE_COACH: "", STRIPE_PRICE_MONTHLY: "price_m" } });
  const { token } = await register(ctx, "yearlymissing@example.com");
  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.deepEqual(catalog.data.product.plans.map((p) => [p.id, p.available]), [["monthly", true], ["yearly", false]]);
  const yearly = await call(ctx, "POST", "/api/coach/subscribe", { token, body: { plan: "yearly" } });
  assert.equal(yearly.status, 503);
  assert.equal(yearly.data.coming_soon, true);
  assert.match(yearly.data.error, /not available yet/);
  assert.equal(stripe.calls.length, 0);
  const bad = await call(ctx, "POST", "/api/coach/subscribe", { token, body: { plan: "weekly" } });
  assert.equal(bad.status, 400);
  const monthly = await call(ctx, "POST", "/api/coach/subscribe", { token, body: { plan: "monthly" } });
  assert.equal(monthly.status, 200, JSON.stringify(monthly.data));
  assert.equal(stripe.calls[0].form.get("line_items[0][price]"), "price_m");
});

test("yearly checkout uses the yearly price, and its webhooks give a year of access", async () => {
  const { ctx, stripe } = liveEnv({ env: { STRIPE_PRICE_MONTHLY: "price_m", STRIPE_PRICE_YEARLY: "price_y" } });
  const { token, user } = await register(ctx, "yearly@example.com");
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: { plan: "yearly" } });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  assert.equal(session.data.amount_cents, 4900);
  const req = stripe.calls[0];
  assert.equal(req.form.get("mode"), "subscription");
  assert.equal(req.form.get("line_items[0][price]"), "price_y");
  assert.equal(req.form.get("subscription_data[metadata][plan]"), "yearly");
  const row = await ctx.db.one("SELECT * FROM checkouts WHERE id=?", [session.data.id]);
  assert.equal(row.amount_cents, 4900);
  assert.equal(JSON.parse(row.details).plan, "yearly");

  const metadata = { user_id: String(user.id), item_id: "grow-coach", plan: "yearly" };
  const done = await signedWebhook(
    ctx,
    event("evt_y_done", "checkout.session.completed", {
      id: session.data.id,
      mode: "subscription",
      payment_status: "paid",
      customer: "cus_y",
      subscription: "sub_y",
      metadata,
    })
  );
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const day = 24 * 3600 * 1000;
  let sub = await ctx.db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  assert.ok(new Date(sub.period_end).getTime() > Date.now() + 360 * day, "yearly checkout opens a year, not a month");

  const end = Date.now() + 366 * day;
  const paid = await signedWebhook(
    ctx,
    event("evt_y_inv", "invoice.paid", {
      id: "in_y",
      parent: { subscription_details: { metadata, subscription: "sub_y" } },
      lines: { data: [{ period: { start: unix(Date.now()), end: unix(end) }, metadata }] },
    })
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  sub = await ctx.db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  assert.ok(new Date(sub.period_end).getTime() > end, "yearly renewal sets the end from Stripe plus grace");
  assert.equal(await hasCoach(ctx, token), true);

  const gone = await signedWebhook(ctx, event("evt_y_del", "customer.subscription.deleted", { id: "sub_y", status: "canceled", metadata }));
  assert.equal(gone.status, 200);
  assert.equal(await hasCoach(ctx, token), false);
});

test("Coach needs a price id before checkout opens", async () => {
  const { ctx, stripe } = liveEnv({ env: { STRIPE_PRICE_COACH: "" } });
  const { token } = await register(ctx, "noprice@example.com");
  const res = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(res.status, 503);
  assert.equal(res.data.coming_soon, true);
  assert.equal(stripe.calls.length, 0);
});

test("Coach subscribe stays hidden without COACH_PUBLIC even with keys", async () => {
  const { ctx, stripe } = liveEnv({ env: { COACH_PUBLIC: "" } });
  const { token } = await register(ctx, "hidden@example.com");
  const res = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(res.status, 404);
  assert.equal(stripe.calls.length, 0);
});

test("with COACH_PUBLIC off, only a beta user can open a real Coach checkout once Stripe is set", async () => {
  const { ctx, stripe } = liveEnv({ env: { COACH_PUBLIC: "", STRIPE_PRICE_COACH: "", STRIPE_PRICE_MONTHLY: "price_m", STRIPE_PRICE_YEARLY: "price_y" } });
  const stranger = await register(ctx, "stranger@example.com");
  const beta = await register(ctx, "beta-buyer@example.com");
  ctx.COACH_BETA_USER_IDS = String(beta.user.id);
  const hidden = await call(ctx, "POST", "/api/coach/subscribe", { token: stranger.token, body: { plan: "monthly" } });
  assert.equal(hidden.status, 404);
  assert.equal(stripe.calls.length, 0);
  const publicView = await call(ctx, "GET", "/api/coach");
  assert.equal(publicView.data.available, false);
  for (const [plan, price] of [["monthly", "price_m"], ["yearly", "price_y"]]) {
    const res = await call(ctx, "POST", "/api/coach/subscribe", { token: beta.token, body: { plan } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(stripe.calls.at(-1).form.get("line_items[0][price]"), price);
    assert.equal(stripe.calls.at(-1).form.get("metadata[plan]"), plan);
  }
});

test("Coach lifecycle: pay, renew, cancel at period end keeps access, deletion removes it", async () => {
  const { ctx, stripe } = liveEnv();
  const { token, user } = await register(ctx, "coachlife@example.com");
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const req = stripe.calls[0];
  assert.equal(req.form.get("mode"), "subscription");
  assert.equal(req.form.get("line_items[0][price]"), "price_coach_test");
  assert.equal(req.form.get("subscription_data[metadata][user_id]"), String(user.id));
  assert.equal(req.form.get("subscription_data[metadata][item_id]"), "grow-coach");
  assert.equal(await hasCoach(ctx, token), false);

  const metadata = { user_id: String(user.id), item_id: "grow-coach" };
  const done = await signedWebhook(
    ctx,
    event("evt_cs_done", "checkout.session.completed", {
      id: session.data.id,
      object: "checkout.session",
      mode: "subscription",
      payment_status: "paid",
      client_reference_id: String(user.id),
      customer: "cus_test_1",
      subscription: "sub_test_1",
      metadata,
    })
  );
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(await hasCoach(ctx, token), true);
  // Coach never writes an entitlements row, so a cancel can take it away.
  assert.equal((await ctx.db.all("SELECT * FROM entitlements WHERE user_id=?", [user.id])).length, 0);

  const again = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(again.status, 409);

  const end = Date.now() + 31 * 24 * 3600 * 1000;
  const paid = await signedWebhook(
    ctx,
    event("evt_inv_1", "invoice.paid", {
      id: "in_1",
      object: "invoice",
      parent: { subscription_details: { metadata, subscription: "sub_test_1" } },
      lines: { data: [{ period: { start: unix(Date.now()), end: unix(end) }, metadata }] },
    })
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  const sub = await ctx.db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  assert.ok(new Date(sub.period_end).getTime() > end, "period end includes the grace window");

  const portal = await call(ctx, "POST", "/api/billing/portal", { token, body: {} });
  assert.equal(portal.status, 200, JSON.stringify(portal.data));
  assert.match(portal.data.url, /^https:\/\/billing\.stripe\.com\//);
  assert.equal(stripe.calls.at(-1).form.get("customer"), "cus_test_1");
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.equal(me.data.billing_portal, true);

  const scheduled = await signedWebhook(
    ctx,
    event("evt_sub_upd", "customer.subscription.updated", { id: "sub_test_1", object: "subscription", status: "active", cancel_at_period_end: true, metadata })
  );
  assert.equal(scheduled.status, 200);
  assert.equal(await hasCoach(ctx, token), true, "cancel at period end keeps what they paid for");

  const gone = await signedWebhook(
    ctx,
    event("evt_sub_del", "customer.subscription.deleted", { id: "sub_test_1", object: "subscription", status: "canceled", metadata })
  );
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.equal(await hasCoach(ctx, token), false);

  // A late replay of the old checkout event does not bring access back.
  const replay = await signedWebhook(
    ctx,
    event("evt_cs_done", "checkout.session.completed", { id: session.data.id, payment_status: "paid", metadata })
  );
  assert.equal(replay.data.replayed, true);
  assert.equal(await hasCoach(ctx, token), false);
});

test("unpaid sessions wait for async success; unknown events are acknowledged", async () => {
  const { ctx } = liveEnv();
  const { token, user } = await register(ctx, "async@example.com");
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  const object = { id: session.data.id, payment_status: "unpaid", metadata: { user_id: String(user.id), item_id: "king-oyster-thick-stem" } };
  const pending = await signedWebhook(ctx, event("evt_unpaid", "checkout.session.completed", object));
  assert.equal(pending.status, 200);
  assert.equal(pending.data.ignored, true);
  assert.equal((await ctx.db.all("SELECT * FROM entitlements WHERE user_id=?", [user.id])).length, 0);

  const ok = await signedWebhook(ctx, event("evt_async_ok", "checkout.session.async_payment_succeeded", { ...object, payment_status: "paid" }));
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await ctx.db.all("SELECT * FROM entitlements WHERE user_id=?", [user.id])).length, 1);

  const other = await signedWebhook(ctx, event("evt_other", "charge.refunded", { id: "ch_1" }));
  assert.equal(other.status, 200);
  assert.equal(other.data.ignored, true);

  const stranger = await signedWebhook(ctx, event("evt_stranger", "checkout.session.completed", { id: "cs_unknown", payment_status: "paid" }));
  assert.equal(stranger.status, 200);
  assert.equal(stranger.data.ignored, true);
});

test("webhook accepts any matching v1 signature while a secret rolls, and rejects all-wrong ones", async () => {
  const { ctx } = liveEnv();
  const raw = JSON.stringify(event("evt_roll", "charge.refunded", { id: "ch_2" }));
  const t = String(unix(Date.now()));
  const good = await hmacSha256Hex(TEST_WEBHOOK_SECRET, `${t}.${raw}`);
  const bad = await hmacSha256Hex("whsec_old_secret", `${t}.${raw}`);
  const send = (header) => call(ctx, "POST", "/api/payments/webhook", { rawBody: raw, headers: { "content-type": "application/json", "stripe-signature": header } });
  assert.equal((await send(`t=${t},v1=${bad},v1=${good}`)).status, 200);
  assert.equal((await send(`t=${t},v1=${bad},v1=${bad}`)).status, 401);
  assert.equal((await send(`t=${unix(Date.now()) - 3600},v1=${good}`)).status, 401);
});

test("billing portal is only for people with a paid plan", async () => {
  const { ctx, stripe } = liveEnv();
  const { token } = await register(ctx, "noplan@example.com");
  const res = await call(ctx, "POST", "/api/billing/portal", { token, body: {} });
  assert.equal(res.status, 404);
  assert.equal(stripe.calls.length, 0);
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.equal(me.data.billing_portal, false);
  const anon = await call(ctx, "POST", "/api/billing/portal", { body: {} });
  assert.equal(anon.status, 401);
});

test("webhook events for an unknown user or checkout are skipped with a 200, so Stripe stops retrying", async () => {
  const { ctx } = liveEnv();
  const logs = [];
  const orig = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    const meta = { user_id: "999999", item_id: "grow-coach" };
    const end = unix(Date.now()) + 30 * 86400;
    const events = [
      event("evt_ghost_inv", "invoice.paid", { id: "in_ghost", object: "invoice", parent: { subscription_details: { metadata: meta } }, lines: { data: [{ metadata: meta, period: { end } }] } }),
      event("evt_ghost_upd", "customer.subscription.updated", { id: "sub_ghost", object: "subscription", status: "canceled", metadata: meta }),
      event("evt_ghost_del", "customer.subscription.deleted", { id: "sub_ghost", object: "subscription", status: "canceled", metadata: meta }),
      event("evt_ghost_cs", "checkout.session.completed", { id: "cs_test_ghost", object: "checkout.session", payment_status: "paid", metadata: meta }),
      event("evt_ghost_exp", "checkout.session.expired", { id: "cs_test_ghost", object: "checkout.session", metadata: meta }),
    ];
    for (const evt of events) {
      const res = await signedWebhook(ctx, evt);
      assert.equal(res.status, 200, `${evt.type}: ${JSON.stringify(res.data)}`);
      assert.equal(res.data.ignored, true, evt.type);
      assert.match(res.data.reason, /^unknown (user|checkout)$/, evt.type);
      const again = await signedWebhook(ctx, evt);
      assert.equal(again.data.replayed, true, `${evt.type} is recorded, so a resend is a no-op`);
    }
    assert.equal(await ctx.db.one("SELECT * FROM coach_subs WHERE user_id=?", [999999]), null);
    const skipped = logs.filter((l) => l.includes("stripe event skipped"));
    assert.equal(skipped.length, events.length);
  } finally {
    console.log = orig;
  }
});
