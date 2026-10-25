import assert from "node:assert/strict";
import { createMemoryDb } from "../src/db.js";
import { handleRequest } from "../src/handlers.js";
import { createMemoryStorage } from "../src/storage.js";
import { hmacSha256Hex } from "../src/crypto.js";

export const TEST_WEBHOOK_SECRET = "whsec_test_security";
export const TEST_TOTP_KEY = "11".repeat(32);

export function testEnv(extra = {}) {
  return {
    db: createMemoryDb(),
    storage: createMemoryStorage(),
    CORS_ORIGIN: "http://127.0.0.1:8888",
    SHOW_PSILOCYBIN: "1",
    SITE_NAME: "test",
    AUTH_DEBUG: "1",
    DEV_STUBS: "1",
    PHOTOS_ENABLED: "1",
    HIBP_DISABLED: "1",
    SITE_ORIGIN: "http://127.0.0.1:8888",
    API_ORIGIN: "https://api.shroomlabs.io",
    OIDC_STUB: "1",
    TURNSTILE_STUB: "1",
    GROW_COACH_STUB: "1",
    PAYMENTS_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    TOTP_ENC_KEY: TEST_TOTP_KEY,
    ...extra,
  };
}

export async function call(ctx, method, path, { token, body, form, headers: extra = {}, rawBody, host } = {}) {
  const headers = { "content-type": form ? "application/x-www-form-urlencoded" : "application/json", ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  if (host) headers.host = host;
  let payload;
  if (rawBody !== undefined) payload = rawBody;
  else if (form) payload = new URLSearchParams(form).toString();
  else if (body) payload = JSON.stringify(body);
  const request = new Request(`${host ? `https://${host}` : "http://test"}${path}`, {
    method,
    headers,
    body: payload,
  });
  const res = await handleRequest(request, ctx);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

export async function callRaw(ctx, method, path, { token, headers: extra = {}, host } = {}) {
  const headers = { ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  if (host) headers.host = host;
  const request = new Request(`${host ? `https://${host}` : "http://test"}${path}`, { method, headers });
  const res = await handleRequest(request, ctx);
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
}

export const RANDOM_HANDLE = /^grower_[0-9a-f]{10}$/;

export function assertPublicHandle(row, responseUser) {
  assert.match(row.username, RANDOM_HANDLE);
  assert.equal(row.display_name, row.username);
  assert.notEqual(row.username, "grower");
  if (responseUser) {
    assert.equal(responseUser.username, row.username);
    assert.equal(Object.hasOwn(responseUser, "display_name"), false);
  }
}

/** True when `text` contains the email local part as its own token, not inside grower_<hex>. */
export function hasEmailLocalPart(text, email) {
  const body = typeof text === "string" ? text : JSON.stringify(text);
  const local = String(email).split("@")[0];
  const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, "i").test(body);
}

export function assertNoPublicPii(value, email, extra = [], label = "public output") {
  if (value == null) return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(hasEmailLocalPart(text, email), false, `${label} leaked the email local part`);
  assert.doesNotMatch(text, new RegExp(String(email).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${label} leaked the email`);
  for (const bit of extra) {
    assert.doesNotMatch(text, new RegExp(bit, "i"), `${label} leaked ${bit}`);
  }
}

export const SAMPLE_CULINARY_PROFILE = {
  id: "privacy-oyster",
  name: "Privacy Oyster",
  species: "Pleurotus ostreatus",
  pack: "culinary",
  schema_version: 1,
  stages: [
    {
      id: "fruiting",
      name: "Fruiting",
      duration_days: 7,
      humidity_percent: 90,
      temperature_c: 18,
      fan: { speed_percent: 30, period_min: 15, run_duration_s: 30 },
    },
  ],
};

export async function register(ctx, email = "grower@example.com") {
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email, turnstile: "ok" } });
  const res = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  return { ...res.data, token: res.data.access_token, user: res.data.user };
}

export function stripeCheckoutEvent({ sessionId, userId, itemId, eventId = `evt_${sessionId}`, type = "checkout.session.completed" }) {
  return {
    id: eventId,
    object: "event",
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        client_reference_id: userId != null ? String(userId) : undefined,
        metadata: {
          user_id: userId != null ? String(userId) : undefined,
          item_id: itemId,
        },
        mode: itemId === "grow-coach" ? "subscription" : "payment",
      },
    },
  };
}

export async function signedWebhook(ctx, payload, { secret = TEST_WEBHOOK_SECRET, signature } = {}) {
  const raw = JSON.stringify(payload);
  const t = String(Math.floor(Date.now() / 1000));
  const v1 = signature || (await hmacSha256Hex(secret, `${t}.${raw}`));
  return call(ctx, "POST", "/api/payments/webhook", {
    rawBody: raw,
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` },
  });
}
