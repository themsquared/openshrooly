/** Stripe checkout and webhook. Fail-closed when keys are unset; every webhook event is applied at most once. */

import { nowIso, randomToken } from "./crypto.js";
import { COACH_ITEM, COACH_PLANS } from "./coach-learn.js";
import { activateCoachSub } from "./coach.js";
import { comingSoonBody, devStubsEnabled, paymentsConfigured } from "./providers.js";
import { ValidationError } from "./profile.js";
import { createCheckoutSession, createPortalSession, StripeError } from "./stripe.js";

/** Paid renewals can land a little after the period ends. Keep access through that gap. */
export const RENEWAL_GRACE_MS = 2 * 24 * 3600 * 1000;

export const SQL = {
  insertCheckout:
    "INSERT INTO checkouts (id, user_id, item_id, provider, status, amount_cents, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  checkoutById: "SELECT * FROM checkouts WHERE id=?",
  userById: "SELECT * FROM users WHERE id=?",
  setCheckoutStatus: "UPDATE checkouts SET status=? WHERE id=?",
  setCheckoutDetails: "UPDATE checkouts SET details=? WHERE id=?",
  paidCheckoutsFor: "SELECT * FROM checkouts WHERE user_id=? AND item_id=? AND status=? ORDER BY created_at DESC",
  coachSub: "SELECT * FROM coach_subs WHERE user_id=?",
  setCoachSub: "UPDATE coach_subs SET status=?, period_end=? WHERE user_id=?",
  seenEvent: "SELECT * FROM payment_events WHERE event_id=?",
  recordEvent: "INSERT OR IGNORE INTO payment_events (event_id, checkout_id, type, created_at) VALUES (?, ?, ?, ?)",
  checkoutsFor: "SELECT * FROM checkouts WHERE user_id=? AND item_id=? ORDER BY created_at DESC",
  checkoutsByStatus: "SELECT * FROM checkouts WHERE status=? ORDER BY created_at DESC",
  revokeProfile: "DELETE FROM entitlements WHERE user_id=? AND item_id=? AND item_type=?",
};

function parseDetails(row) {
  try {
    return JSON.parse(row?.details || "{}") || {};
  } catch {
    return {};
  }
}

/**
 * Start a checkout. With keys set this creates a real Stripe Checkout Session and stores its id.
 * Local dev stubs keep the old fake session so tests never call Stripe.
 */
export const NOT_AVAILABLE_YET = "This profile is not available yet. Check back soon.";

export async function startCheckout(db, env, request, { user, itemId, amountCents, details, mode = "payment", priceId, requirePrice = false, name, successPath, cancelPath, plan }) {
  const stubs = devStubsEnabled(env, request);
  if (!paymentsConfigured(env) && !stubs) return { ok: false, status: 503, ...comingSoonBody("Payments") };
  if (stubs) {
    const sessionId = `cs_test_${randomToken().slice(0, 16)}`;
    await db.run(SQL.insertCheckout, [sessionId, user.id, itemId, "stripe", "requires_payment", amountCents, JSON.stringify(details || {}), nowIso()]);
    return { ok: true, id: sessionId, provider: "stripe", status: "requires_payment", checkout_url: `/pay/stub/${sessionId}`, amount_cents: amountCents, item_id: itemId };
  }
  if (requirePrice && !priceId) return { ok: false, status: 503, error: NOT_AVAILABLE_YET, coming_soon: true };
  const ref = `chk_${randomToken().slice(0, 20)}`;
  let session;
  try {
    session = await createCheckoutSession(env, { ref, mode, userId: user.id, email: user.email, itemId, priceId, amountCents, name, successPath, cancelPath, plan });
  } catch (err) {
    if (err instanceof StripeError) return { ok: false, status: err.status, error: err.message };
    throw err;
  }
  if (!session?.id || !session?.url) return { ok: false, status: 502, error: "Checkout could not start. Try again in a minute." };
  await db.run(SQL.insertCheckout, [session.id, user.id, itemId, "stripe", "requires_payment", amountCents, JSON.stringify({ ...(details || {}), ref, mode }), nowIso()]);
  return { ok: true, id: session.id, provider: "stripe", status: "requires_payment", checkout_url: session.url, amount_cents: amountCents, item_id: itemId };
}

/** The Stripe customer behind this user's Grow Coach plan, if they ever paid for one. */
export async function coachCustomerFor(db, userId) {
  const rows = await db.all(SQL.paidCheckoutsFor, [userId, COACH_ITEM, "paid"]);
  for (const row of rows) {
    const customer = parseDetails(row).customer;
    if (customer) return String(customer);
  }
  return "";
}

export async function openBillingPortal(db, env, user) {
  if (!paymentsConfigured(env)) return { ok: false, status: 503, ...comingSoonBody("Billing") };
  const customer = await coachCustomerFor(db, user.id);
  if (!customer) return { ok: false, status: 404, error: "No paid plan on this account." };
  try {
    const portal = await createPortalSession(env, { customer, returnPath: "/account#billing" });
    return { ok: true, url: portal.url };
  } catch (err) {
    if (err instanceof StripeError) return { ok: false, status: err.status, error: err.message };
    throw err;
  }
}

export function parseStripeEvent(body) {
  if (!body || typeof body !== "object") return null;
  if (!body.id || !body.type || !body.data || typeof body.data !== "object") return null;
  return { id: String(body.id), type: String(body.type), object: body.data.object || {} };
}

function metadataOf(object) {
  return object && typeof object.metadata === "object" && object.metadata ? object.metadata : {};
}

function checkoutUserItem(object) {
  const metadata = metadataOf(object);
  return {
    sessionId: String(object.id || ""),
    claimedUser: metadata.user_id != null ? Number(metadata.user_id) : Number(object.client_reference_id || 0),
    claimedItem: metadata.item_id ? String(metadata.item_id) : "",
  };
}

const IGNORE = { ok: true, ignored: true };

/**
 * A verified event about a user or checkout this site does not have (a test event, a deleted
 * account). Answer 200 so Stripe stops retrying, and log why.
 */
const skip = (reason) => ({ ok: true, ignored: true, reason });

/**
 * Apply one verified Stripe event. The event id is recorded only after the change lands,
 * so a crash mid-way gets retried by Stripe, and every step below is safe to repeat.
 */
export async function applyStripeEvent(db, event) {
  if (!event?.id || !event.type) throw new ValidationError("Stripe event id and type required");
  const seen = await db.one(SQL.seenEvent, [event.id]);
  if (seen) return { ok: true, replayed: true, event_id: event.id };
  const result = await routeEvent(db, event);
  if (result.reason) console.log(JSON.stringify({ msg: "stripe event skipped", event_id: event.id, type: event.type, reason: result.reason }));
  await db.run(SQL.recordEvent, [event.id, result.checkout_id || null, event.type, nowIso()]);
  return result;
}

async function routeEvent(db, event) {
  const obj = event.object || {};
  switch (event.type) {
    case "checkout.session.completed":
      // Bank debits and similar finish later. Wait for async_payment_succeeded.
      if (obj.payment_status && obj.payment_status !== "paid" && obj.payment_status !== "no_payment_required") return IGNORE;
      return completeCheckout(db, event);
    case "checkout.session.async_payment_succeeded":
      return completeCheckout(db, event);
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return closeCheckout(db, obj, event.type === "checkout.session.expired" ? "expired" : "failed");
    case "invoice.paid":
      return renewCoach(db, obj);
    case "customer.subscription.updated":
      return updateCoach(db, obj);
    case "customer.subscription.deleted":
      return cancelCoach(db, obj);
    case "charge.refunded":
      return refundCharge(db, obj, event.id);
    default:
      // Stripe retries anything that isn't a 2xx for days. Say thanks and move on.
      return IGNORE;
  }
}

async function completeCheckout(db, event) {
  const { sessionId, claimedUser, claimedItem } = checkoutUserItem(event.object);
  if (!sessionId) throw new ValidationError("checkout session id required");
  const checkout = await db.one(SQL.checkoutById, [sessionId]);
  if (!checkout) return skip("unknown checkout");
  if (claimedUser && Number(claimedUser) !== Number(checkout.user_id)) throw new ValidationError("webhook user does not match checkout");
  if (claimedItem && claimedItem !== checkout.item_id) throw new ValidationError("webhook item does not match checkout");
  const base = { checkout_id: checkout.id, item_id: checkout.item_id, user_id: checkout.user_id };
  if (checkout.status === "paid") return { ok: true, replayed: true, ...base };
  if (!(await db.one(SQL.userById, [Number(checkout.user_id)]))) return skip("unknown user");
  const obj = event.object;
  if (obj.customer || obj.subscription || obj.payment_intent) {
    // payment_intent lets a later refund find this checkout.
    const details = { ...parseDetails(checkout), customer: obj.customer || undefined, subscription: obj.subscription || undefined, payment_intent: obj.payment_intent || undefined };
    await db.run(SQL.setCheckoutDetails, [JSON.stringify(details), checkout.id]);
  }
  await db.run(SQL.setCheckoutStatus, ["paid", checkout.id]);
  if (checkout.item_id === COACH_ITEM) {
    // The first paid period follows the plan on the checkout. invoice.paid then sets the exact end from Stripe.
    const plan = COACH_PLANS[parseDetails(checkout).plan] || COACH_PLANS.monthly;
    const periodEnd = await activateCoachSub(db, Number(checkout.user_id), { replaySafe: true, periodDays: plan.period_days });
    return { ok: true, ...base, item_type: "subscription", period_end: periodEnd };
  }
  await db.run("INSERT OR IGNORE INTO entitlements (user_id, item_id, item_type, granted_at) VALUES (?, ?, ?, ?)", [
    Number(checkout.user_id),
    checkout.item_id,
    "profile",
    nowIso(),
  ]);
  return { ok: true, ...base, item_type: "profile" };
}

async function closeCheckout(db, obj, status) {
  const checkout = obj.id ? await db.one(SQL.checkoutById, [String(obj.id)]) : null;
  if (!checkout) return skip("unknown checkout");
  if (checkout.status === "paid") return IGNORE;
  await db.run(SQL.setCheckoutStatus, [status, checkout.id]);
  return { ok: true, checkout_id: checkout.id, status };
}

function coachUserFrom(...sources) {
  for (const meta of sources) {
    if (meta && meta.item_id === COACH_ITEM && Number(meta.user_id) > 0) return Number(meta.user_id);
  }
  return 0;
}

function isoFromUnix(seconds, graceMs = 0) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n * 1000 + graceMs).toISOString();
}

/** A paid invoice moves the plan's end to the end of the period it paid for. */
async function renewCoach(db, invoice) {
  const lines = Array.isArray(invoice.lines?.data) ? invoice.lines.data : [];
  const userId = coachUserFrom(
    invoice.parent?.subscription_details?.metadata,
    invoice.subscription_details?.metadata,
    ...lines.map((line) => line.metadata),
  );
  if (!userId) return IGNORE;
  if (!(await db.one(SQL.userById, [userId]))) return skip("unknown user");
  const end = Math.max(0, ...lines.map((line) => Number(line.period?.end || 0)));
  const periodEnd = isoFromUnix(end, RENEWAL_GRACE_MS);
  if (!periodEnd) return IGNORE;
  const existing = await db.one(SQL.coachSub, [userId]);
  // Never shorten a plan because an older invoice arrived late.
  if (existing && existing.status === "active" && existing.period_end >= periodEnd) return { ok: true, user_id: userId, period_end: existing.period_end };
  await activateCoachSub(db, userId, { periodEnd });
  return { ok: true, item_id: COACH_ITEM, item_type: "subscription", user_id: userId, period_end: periodEnd };
}

const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);

/**
 * Cancel in the portal sets cancel_at_period_end: access runs to the end of what they paid for,
 * then Stripe sends subscription.deleted. Past due keeps the current end and lapses on its own.
 */
async function updateCoach(db, sub) {
  if (ENDED.has(String(sub.status || ""))) return cancelCoach(db, sub);
  return IGNORE;
}

async function cancelCoach(db, sub) {
  const userId = coachUserFrom(metadataOf(sub)) || Number(metadataOf(sub).user_id || 0);
  if (!userId) return IGNORE;
  const existing = await db.one(SQL.coachSub, [userId]);
  if (!existing) return skip((await db.one(SQL.userById, [userId])) ? "no coach plan" : "unknown user");
  await db.run(SQL.setCoachSub, ["canceled", nowIso(), userId]);
  return { ok: true, item_id: COACH_ITEM, item_type: "subscription", user_id: userId, status: "canceled" };
}

/**
 * Find the checkout a charge paid for. Profile charges carry our checkout metadata (copied from the
 * PaymentIntent). Older ones match on the PaymentIntent id we saved at checkout. Coach renewals carry
 * no metadata, so they match the customer on the first Coach checkout.
 */
async function checkoutForCharge(db, charge) {
  const meta = metadataOf(charge);
  const pi = String(charge.payment_intent || "");
  const userId = Number(meta.user_id || 0);
  if (userId > 0 && meta.item_id) {
    const rows = await db.all(SQL.checkoutsFor, [userId, String(meta.item_id)]);
    const hit =
      rows.find((r) => meta.ref && parseDetails(r).ref === meta.ref) ||
      rows.find((r) => pi && parseDetails(r).payment_intent === pi) ||
      rows.find((r) => r.status === "paid");
    if (hit) return hit;
  }
  if (!pi && !charge.customer) return null;
  const all = await db.all(SQL.checkoutsByStatus, ["paid"]);
  if (pi) {
    const hit = all.find((r) => parseDetails(r).payment_intent === pi);
    if (hit) return hit;
  }
  const customer = String(charge.customer || "");
  if (customer) return all.find((r) => r.item_id === COACH_ITEM && parseDetails(r).customer === customer) || null;
  return null;
}

function fullyRefunded(row) {
  const refunds = parseDetails(row).refunds;
  return Boolean(refunds && typeof refunds === "object" && Object.values(refunds).some((r) => r && r.full));
}

/**
 * A refund in the Stripe dashboard. Stripe sends charge.refunded on every refund with the running
 * total, so this is safe to repeat. A full refund of a profile purchase takes the unlock away.
 * A partial one keeps it. Either way the refund is saved on the checkout for the admin page.
 * Coach access is not touched here: it ends when the subscription is canceled
 * (customer.subscription.deleted), which is what "cancel and refund" in Stripe sends.
 */
async function refundCharge(db, charge, eventId) {
  const chargeId = String(charge.id || "");
  if (!chargeId) throw new ValidationError("charge id required");
  const checkout = await checkoutForCharge(db, charge);
  if (!checkout) return skip("unknown charge");
  const amount = Number(charge.amount) || 0;
  const refunded = Number(charge.amount_refunded) || 0;
  const full = Boolean(charge.refunded) || (amount > 0 && refunded >= amount);
  const isCoach = checkout.item_id === COACH_ITEM;
  const details = parseDetails(checkout);
  const refunds = details.refunds && typeof details.refunds === "object" ? details.refunds : {};
  const prior = refunds[chargeId] || {};
  // Revoke once. If they bought the profile again later, that newer purchase keeps the unlock.
  let revoke = full && !isCoach && !prior.revoked;
  if (revoke) {
    const rows = await db.all(SQL.checkoutsFor, [Number(checkout.user_id), checkout.item_id]);
    if (rows.some((r) => r.id !== checkout.id && r.status === "paid" && !fullyRefunded(r))) revoke = false;
  }
  // Events can arrive out of order. Keep the biggest running total.
  const total = Math.max(refunded, Number(prior.refunded_cents) || 0);
  refunds[chargeId] = {
    charge: chargeId,
    amount_cents: amount,
    refunded_cents: total,
    full: full || Boolean(prior.full),
    livemode: Boolean(charge.livemode),
    revoked: Boolean(prior.revoked) || revoke,
    first_at: prior.first_at || nowIso(),
    at: nowIso(),
    event_id: eventId || prior.event_id || null,
  };
  await db.run(SQL.setCheckoutDetails, [JSON.stringify({ ...details, refunds }), checkout.id]);
  if (revoke) await db.run(SQL.revokeProfile, [Number(checkout.user_id), checkout.item_id, "profile"]);
  const kind = revoke ? "unlock revoked" : full && !isCoach ? "full refund logged, unlock already revoked or rebought" : isCoach ? "coach refund logged (access ends on subscription cancel)" : "partial refund logged, unlock kept";
  console.log(JSON.stringify({ msg: "stripe refund", event_id: eventId, checkout_id: checkout.id, item_id: checkout.item_id, refunded_cents: total, amount_cents: amount, full, result: kind }));
  return {
    ok: true,
    checkout_id: checkout.id,
    item_id: checkout.item_id,
    user_id: checkout.user_id,
    refunded_cents: total,
    full,
    revoked: revoke,
  };
}
