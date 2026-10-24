import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilities, createPushProvider, devStubsEnabled, isProdHost, requestHost } from "../src/providers.js";
import { call, register, testEnv } from "./helpers.js";

function prodLike() {
  return testEnv({
    DEV_STUBS: "",
    AUTH_DEBUG: "1",
    OIDC_STUB: "1",
    TURNSTILE_STUB: "1",
    GROW_COACH_STUB: "1",
    RESEND_API_KEY: "",
    GOOGLE_CLIENT_ID: "",
    APPLE_CLIENT_ID: "",
    PAYMENTS_WEBHOOK_SECRET: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_SECRET_KEY: "",
    TURNSTILE_SECRET_KEY: "",
  });
}

test("DEV_STUBS is refused on shroomlabs.io and api.shroomlabs.io", () => {
  const env = { DEV_STUBS: "1" };
  const prod = new Request("https://api.shroomlabs.io/health", { headers: { host: "api.shroomlabs.io" } });
  const site = new Request("https://shroomlabs.io/", { headers: { host: "shroomlabs.io" } });
  const local = new Request("http://127.0.0.1:8787/health", { headers: { host: "127.0.0.1:8787" } });
  assert.equal(isProdHost(prod), true);
  assert.equal(isProdHost(site), true);
  assert.equal(devStubsEnabled(env, prod), false);
  assert.equal(devStubsEnabled(env, site), false);
  assert.equal(devStubsEnabled(env, local), true);
  assert.equal(devStubsEnabled({ DEV_STUBS: "" }, local), false);
  assert.equal(capabilities(env, prod).stubs, false);
  assert.equal(capabilities(env, local).stubs, true);
});

test("stubs are inert in a prod-like config even when leftover stub flags are set", async () => {
  const ctx = prodLike();
  const host = "api.shroomlabs.io";
  const caps = await call(ctx, "GET", "/api/capabilities", { host });
  assert.equal(caps.status, 200);
  assert.equal(caps.data.stubs, false);
  assert.equal(caps.data.email, false);
  assert.equal(caps.data.google, false);
  assert.equal(caps.data.payments, false);
  assert.equal(caps.data.coach, false);

  const magic = await call(ctx, "POST", "/api/auth/magic/start", {
    host,
    body: { email: "prod@example.com", turnstile: "ok" },
  });
  assert.ok(magic.status === 400 || magic.status === 503);
  assert.equal(magic.data.debug_token, undefined);
  assert.doesNotMatch(JSON.stringify(magic.data), /@example\.com/);

  const oidc = await call(ctx, "GET", "/api/auth/oidc/google/start", { host });
  assert.equal(oidc.status, 503);
  assert.equal(oidc.data.coming_soon, true);
  assert.equal(oidc.data.debug_code, undefined);

  const oidcCb = await call(ctx, "GET", "/api/auth/oidc/google/callback?state=x&code=stub", { host });
  assert.equal(oidcCb.status, 401);
  assert.equal(oidcCb.data.access_token, undefined);

  const coach = await call(ctx, "GET", "/api/coach", { host });
  assert.equal(coach.status, 200);
  assert.equal(coach.data.waitlist, true);
  assert.match(coach.data.marketing, /preview/i);

  const authed = testEnv();
  const { token } = await register(authed, "buyer@example.com");
  authed.DEV_STUBS = "";
  authed.PAYMENTS_WEBHOOK_SECRET = "";
  authed.STRIPE_WEBHOOK_SECRET = "";
  const paid = await call(authed, "POST", "/api/profiles/king-oyster-thick-stem/checkout", {
    host,
    token,
    body: {},
  });
  assert.equal(paid.status, 503);
  assert.equal(paid.data.coming_soon, true);

  const sub = await call(authed, "POST", "/api/coach/subscribe", { host, token, body: {} });
  assert.equal(sub.status, 503);
  assert.equal(sub.data.coming_soon, true);
});

test("DEV_STUBS still completes local magic and OIDC flows", async () => {
  const ctx = testEnv();
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "stub@example.com", turnstile: "ok" } });
  assert.equal(start.status, 200);
  assert.ok(start.data.debug_token);
  const oidc = await call(ctx, "GET", "/api/auth/oidc/google/start");
  assert.equal(oidc.status, 200);
  assert.ok(oidc.data.debug_code);
});

test("X-Forwarded-Host cannot enable DEV_STUBS on a prod URL or D1", async () => {
  const env = { DEV_STUBS: "1" };
  const spoof = new Request("https://api.shroomlabs.io/health", {
    headers: { "x-forwarded-host": "localhost", host: "localhost" },
  });
  assert.equal(requestHost(spoof), "api.shroomlabs.io");
  assert.equal(isProdHost(spoof), true);
  assert.equal(devStubsEnabled(env, spoof), false);
  assert.equal(capabilities(env, spoof).stubs, false);

  const ctx = testEnv({ DEV_STUBS: "1" });
  const magic = await call(ctx, "POST", "/api/auth/magic/start", {
    host: "api.shroomlabs.io",
    headers: { "x-forwarded-host": "localhost" },
    body: { email: "spoof@example.com", turnstile: "ok" },
  });
  assert.ok(magic.status === 400 || magic.status === 503);
  assert.equal(magic.data.debug_token, undefined);

  const d1 = testEnv({ DEV_STUBS: "1" });
  d1.db.driver = "d1";
  const local = await call(d1, "POST", "/api/auth/magic/start", {
    body: { email: "d1@example.com", turnstile: "ok" },
  });
  assert.ok(local.status === 400 || local.status === 503);
  assert.equal(local.data.debug_token, undefined);
  assert.equal(devStubsEnabled(d1, new Request("http://127.0.0.1:8787/health")), false);
});

test("payments stay Coming soon without STRIPE_SECRET_KEY", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "pay@example.com");
  ctx.DEV_STUBS = "";
  ctx.STRIPE_SECRET_KEY = "";
  const caps = await call(ctx, "GET", "/api/capabilities");
  assert.equal(caps.data.payments, false);
  const paid = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(paid.status, 503);
  assert.equal(paid.data.coming_soon, true);
});

test("push provider stubs only when DEV_STUBS is on a non-prod host", async () => {
  const local = new Request("http://127.0.0.1/health");
  const prod = new Request("https://api.shroomlabs.io/health", { headers: { host: "api.shroomlabs.io" } });
  const stub = createPushProvider({ DEV_STUBS: "1" }, local);
  assert.equal(stub.name, "stub");
  assert.equal((await stub.send({ title: "hi" })).ok, true);
  const dead = createPushProvider({ DEV_STUBS: "1" }, prod);
  assert.equal(dead.name, "disabled");
  assert.equal((await dead.send({ title: "hi" })).ok, false);
});
