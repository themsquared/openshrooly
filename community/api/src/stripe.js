/** Minimal Stripe REST client. No SDK: form-encoded fetch with an idempotency key. Secrets never leave this file. */

const STRIPE_API = "https://api.stripe.com/v1";

export function stripeSecret(env = {}) {
  return String(env.STRIPE_SECRET_KEY || "").trim();
}

export function coachPriceId(env = {}) {
  return String(env.STRIPE_PRICE_COACH || "").trim();
}

export function siteOrigin(env = {}) {
  return String(env.SITE_ORIGIN || "https://shroomlabs.io").replace(/\/$/, "");
}

/** Flatten { a: { b: 1 }, c: [x] } into Stripe's a[b]=1&c[0]=x form encoding. */
export function stripeForm(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, i) => (typeof item === "object" ? stripeForm(item, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(item))));
    else if (typeof value === "object") stripeForm(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export class StripeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function stripePost(env, path, params, idempotencyKey) {
  const secret = stripeSecret(env);
  if (!secret) throw new StripeError("Payments are not configured yet.", 503);
  const fetchImpl = env.fetch || globalThis.fetch;
  const headers = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/x-www-form-urlencoded",
    "stripe-version": "2024-06-20",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetchImpl(`${STRIPE_API}${path}`, { method: "POST", headers, body: stripeForm(params).toString() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Log the Stripe error type only. Never the request, which carries the key in a header.
    console.error(JSON.stringify({ at: "stripe", path, status: res.status, type: body?.error?.type || "", code: body?.error?.code || "" }));
    throw new StripeError("Checkout could not start. Try again in a minute.", 502);
  }
  return body;
}

/**
 * Create a Checkout Session. `ref` is our own id for this attempt and doubles as the idempotency key,
 * so a double click or a retried request never makes two sessions.
 */
export function createCheckoutSession(env, { ref, mode, userId, email, itemId, priceId, amountCents, name, successPath, cancelPath }) {
  const site = siteOrigin(env);
  const metadata = { user_id: String(userId), item_id: itemId, ref };
  const params = {
    mode,
    client_reference_id: String(userId),
    customer_email: email || undefined,
    success_url: `${site}${successPath}`,
    cancel_url: `${site}${cancelPath}`,
    metadata,
    line_items: [
      priceId
        ? { price: priceId, quantity: 1 }
        : { quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name } } },
    ],
  };
  if (mode === "subscription") params.subscription_data = { metadata };
  else params.payment_intent_data = { metadata };
  return stripePost(env, "/checkout/sessions", params, `checkout-${ref}`);
}

/** Stripe's hosted billing page: cancel, change card, invoices. */
export function createPortalSession(env, { customer, returnPath }) {
  return stripePost(env, "/billing_portal/sessions", { customer, return_url: `${siteOrigin(env)}${returnPath}` });
}
