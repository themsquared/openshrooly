/** Stripe webhook adapter. Fail-closed when the secret is unset. */

import { nowIso } from "./crypto.js";
import { COACH_ITEM } from "./coach-learn.js";
import { activateCoachSub } from "./coach.js";
import { ValidationError } from "./profile.js";

export function parseStripeEvent(body) {
  if (!body || typeof body !== "object") return null;
  if (!body.id || !body.type || !body.data || typeof body.data !== "object") return null;
  return {
    id: String(body.id),
    type: String(body.type),
    object: body.data.object || {},
  };
}

function checkoutUserItem(object) {
  const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata : {};
  return {
    sessionId: String(object.id || ""),
    claimedUser: metadata.user_id != null ? Number(metadata.user_id) : Number(object.client_reference_id || 0),
    claimedItem: metadata.item_id ? String(metadata.item_id) : "",
  };
}

export async function applyStripeEvent(db, event) {
  if (!event?.id || !event.type) throw new ValidationError("Stripe event id and type required");
  const seen = await db.one("SELECT * FROM payment_events WHERE event_id=?", [event.id]);
  if (seen) return { ok: true, replayed: true, event_id: event.id };

  if (event.type === "checkout.session.completed") {
    return completeCheckout(db, event);
  }
  if (event.type === "customer.subscription.deleted") {
    return cancelCoach(db, event);
  }
  if (event.type === "customer.subscription.updated") {
    const status = String(event.object.status || "");
    if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
      return cancelCoach(db, event);
    }
    return recordEvent(db, event, { ok: true, ignored: true });
  }
  throw new ValidationError(`unsupported Stripe event ${event.type}`);
}

async function completeCheckout(db, event) {
  const { sessionId, claimedUser, claimedItem } = checkoutUserItem(event.object);
  if (!sessionId) throw new ValidationError("checkout session id required");
  const checkout = await db.one("SELECT * FROM checkouts WHERE id=?", [sessionId]);
  if (!checkout) throw new ValidationError("unknown checkout");
  if (claimedUser && Number(claimedUser) !== Number(checkout.user_id)) {
    throw new ValidationError("webhook user does not match checkout");
  }
  if (claimedItem && claimedItem !== checkout.item_id) {
    throw new ValidationError("webhook item does not match checkout");
  }
  await recordEvent(db, event, { checkout_id: checkout.id });
  if (checkout.status === "paid") {
    return { ok: true, replayed: true, item_id: checkout.item_id, user_id: checkout.user_id };
  }
  await db.run("UPDATE checkouts SET status=? WHERE id=?", ["paid", checkout.id]);
  if (checkout.item_id === COACH_ITEM) {
    const periodEnd = await activateCoachSub(db, Number(checkout.user_id), { replaySafe: true });
    return { ok: true, item_id: checkout.item_id, item_type: "subscription", period_end: periodEnd, user_id: checkout.user_id };
  }
  await db.run("INSERT OR IGNORE INTO entitlements (user_id, item_id, item_type, granted_at) VALUES (?, ?, ?, ?)", [
    Number(checkout.user_id),
    checkout.item_id,
    "profile",
    nowIso(),
  ]);
  return { ok: true, item_id: checkout.item_id, item_type: "profile", user_id: checkout.user_id };
}

async function cancelCoach(db, event) {
  const metadata = event.object.metadata && typeof event.object.metadata === "object" ? event.object.metadata : {};
  const userId = Number(metadata.user_id || event.object.client_reference_id || 0);
  await recordEvent(db, event, {});
  if (!userId) return { ok: true, ignored: true };
  const existing = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [userId]);
  if (existing) await db.run("UPDATE coach_subs SET status=?, period_end=? WHERE user_id=?", ["canceled", nowIso(), userId]);
  return { ok: true, item_id: COACH_ITEM, item_type: "subscription", user_id: userId, status: "canceled" };
}

async function recordEvent(db, event, extra) {
  await db.run("INSERT OR IGNORE INTO payment_events (event_id, checkout_id, type, created_at) VALUES (?, ?, ?, ?)", [
    event.id,
    extra.checkout_id || null,
    event.type,
    nowIso(),
  ]);
  return extra;
}
