/**
 * Thin module wrapper around window.slTrack (defined in js/ga.js). Every call is a no-op on pages
 * without analytics, so callers never check first. No emails, user ids, MAC addresses or names:
 * item ids are profile slugs, and ga.js drops any param outside its allowlist.
 */

export const GA_ID = "G-RKQ4CBEZWY";
export const COACH_ITEM = Object.freeze({ item_id: "grow-coach", item_name: "Grow Coach", item_category: "coach" });
export { profileItem } from "./profile-cards.js";
const PENDING_KEY = "sl_checkout_pending";

/** Send an event now. opts: { done, once } (see ga.js). */
export function track(name, params = {}, opts = {}) {
  if (typeof window.slTrack === "function") return window.slTrack(name, params, opts);
  if (typeof opts.done === "function") opts.done();
  return false;
}

/** Same as track, as a promise that settles once the hit is out (or after 2 s). For use right before navigating. */
export function trackAndWait(name, params = {}, opts = {}) {
  return new Promise((resolve) => track(name, params, { ...opts, done: resolve }));
}

/** Queue an event for the next page that has analytics, for pages that never load GA (sign-in callback). */
export function trackNext(name, params = {}, once = "") {
  try {
    const list = JSON.parse(sessionStorage.getItem("sl_ga_next") || "[]");
    list.push([name, params, once]);
    sessionStorage.setItem("sl_ga_next", JSON.stringify(list.slice(-10)));
  } catch {
    /* storage off: skip */
  }
}

/**
 * /profile ships without GA because it can show an Off-menu Profile. Call this only after the profile on
 * screen is known to be a public culinary one: it loads gtag.js and ga.js, and queues events until they run.
 */
export function enableProfileAnalytics(doc = document) {
  if (window.slProfileAnalytics === true) return;
  window.slProfileAnalytics = true;
  if (typeof window.slTrack !== "function") {
    const q = [];
    const stub = (...args) => {
      q.push(args);
      return true;
    };
    stub.q = q;
    window.slTrack = stub;
  }
  for (const src of [`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`, "/js/ga.js"]) {
    const s = doc.createElement("script");
    s.src = src;
    s.async = true;
    doc.head.appendChild(s);
  }
}

/** Remember the checkout we are handing to Stripe, so the return page can report it. */
export function savePendingCheckout(entry) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...entry, at: Date.now() }));
  } catch {
    /* storage off */
  }
}

/** The checkout handed to Stripe in the last day, if any. */
export function pendingCheckout() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    return p && Date.now() - Number(p.at || 0) < 86400000 ? p : null;
  } catch {
    return null;
  }
}

export function clearPendingCheckout() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage off */
  }
}

/** Why a checkout click never reached Stripe. */
export function blockedReason(err) {
  if (err?.status === 401) return "signed_out";
  if (err?.status === 409) return "already_owned";
  return "error";
}

/**
 * Report a confirmed sale. Call only after the server says it is done (recipe unlocked, Coach on).
 * transaction_id is the Stripe Checkout Session id from the return URL, or the one saved at click time.
 * Resolves once the hits are out, so the caller can reload the page after.
 */
export async function reportPurchase(sessionId, fallback = {}) {
  const pending = pendingCheckout();
  const id = sessionId || pending?.id || "";
  if (!id) return false;
  const src = pending && pending.id === id ? pending : { ...pending, ...fallback, id };
  const value = Number(src.value || 0);
  const base = { transaction_id: id, currency: "USD", value, items: src.items || [] };
  const sent = [trackAndWait("purchase", base)];
  if (src.plan) sent.push(trackAndWait("subscribe", { ...base, plan: src.plan }));
  await Promise.all(sent);
  clearPendingCheckout();
  return true;
}

/** Stripe sent the buyer back from its cancel link. Counted once per checkout. */
export function reportCancel(fallback = {}) {
  const pending = pendingCheckout() || fallback;
  if (!pending?.id && !fallback.items) return false;
  track(
    "checkout_cancel",
    { currency: "USD", value: Number(pending.value || 0), items: pending.items || [], plan: pending.plan },
    { once: `checkout_cancel:${pending.id || location.pathname + location.search}` }
  );
  clearPendingCheckout();
  return true;
}
