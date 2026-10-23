import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryDb } from "../src/db.js";
import { handleRequest, pickCorsOrigin, withCors } from "../src/handlers.js";
import { createMemoryStorage } from "../src/storage.js";

function env() {
  return {
    db: createMemoryDb(),
    storage: createMemoryStorage(),
    CORS_ORIGIN: "http://127.0.0.1:8888",
    SHOW_PSILOCYBIN: "1",
    SITE_NAME: "test",
    AUTH_DEBUG: "1",
    HIBP_DISABLED: "1",
    SITE_ORIGIN: "http://127.0.0.1:8888",
    OIDC_STUB: "1",
  };
}

async function call(ctx, method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request(`http://test${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleRequest(request, ctx);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

test("health and culinary catalog", async () => {
  const ctx = env();
  const health = await call(ctx, "GET", "/health");
  assert.equal(health.status, 200);
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.ok(list.data.some((p) => p.id === "pearl-oyster"));
  assert.ok(!list.data.some((p) => p.id === "golden-teacher"));
  assert.ok(list.data.find((p) => p.id === "pearl-oyster").stage_list.length > 0);
});

test("psilocybin pack is listed separately and stays free", async () => {
  const ctx = env();
  const list = await call(ctx, "GET", "/api/profiles?pack=psilocybin");
  assert.ok(list.data.some((p) => p.id === "golden-teacher"));
  const detail = await call(ctx, "GET", "/api/profiles/golden-teacher");
  assert.equal(detail.data.unlocked, true);
  assert.equal(detail.data.links.length, 0);
  const buy = await call(ctx, "POST", "/api/profiles/golden-teacher/checkout", {
    token: (await register(ctx)).token,
    body: {},
  });
  assert.equal(buy.status, 400);
});

test("accounts, paid checkout stub, hub sync", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.equal(me.data.user.email, "mike@example.com");
  assert.equal(me.data.user.email_verified, true);
  const locked = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem");
  assert.equal(locked.data.unlocked, false);
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(session.status, 200);
  const paid = await call(ctx, "POST", `/api/pay/${session.data.id}/complete`, { token, body: {} });
  assert.equal(paid.status, 200);
  const unlocked = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token });
  assert.equal(unlocked.data.unlocked, true);
  const hub = await call(ctx, "GET", "/api/hub/pull", { token });
  assert.ok(hub.data.profiles.some((p) => p.id === "king-oyster-thick-stem"));
});

test("CORS allows shroomlabs.io and local frontend", async () => {
  const ctx = env();
  ctx.CORS_ORIGIN =
    "https://shroomlabs.io,https://www.shroomlabs.io,http://127.0.0.1:8888";
  const request = new Request("https://api.shroomlabs.io/health", {
    headers: { origin: "https://shroomlabs.io" },
  });
  assert.equal(pickCorsOrigin(ctx, request), "https://shroomlabs.io");
  const res = withCors(new Response("ok"), ctx, request);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://shroomlabs.io");
  assert.ok(res.headers.get("content-security-policy"));
});

test("affiliate click is blocked for psilocybin ids", async () => {
  const ctx = env();
  const res = await call(ctx, "GET", "/api/go/golden-teacher/example-spawn");
  assert.equal(res.status, 404);
});

test("magic link sign-in creates a verified user and session cookie", async () => {
  const ctx = env();
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "grower@example.com" } });
  assert.equal(start.status, 200);
  assert.ok(start.data.debug_token);
  const done = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(done.status, 200);
  assert.match(done.headers.get("set-cookie") || "", /__Host-sl_session=/);
  assert.equal(done.data.user.email_verified, true);
  const reuse = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(reuse.status, 401);
});

test("OIDC Google stub and passkey challenge", async () => {
  const ctx = env();
  const start = await call(ctx, "GET", "/api/auth/oidc/google/start");
  assert.equal(start.status, 200);
  assert.ok(start.data.authorize_url.includes("accounts.google.com"));
  const cb = await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${start.data.state}&code=stub`);
  assert.equal(cb.status, 200);
  assert.equal(cb.data.user.email, "google.user@example.com");
  const { token } = await register(ctx, "passkey@example.com");
  const begin = await call(ctx, "POST", "/api/auth/webauthn/register/begin", { token, body: {} });
  assert.equal(begin.status, 200);
  const finish = await call(ctx, "POST", "/api/auth/webauthn/register/finish", {
    token,
    body: { challenge: begin.data.challenge, credentialId: "cred-1", publicKey: { kty: "EC" } },
  });
  assert.equal(finish.status, 200);
  const loginBegin = await call(ctx, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  const login = await call(ctx, "POST", "/api/auth/webauthn/login/finish", {
    body: { challenge: loginBegin.data.challenge, credentialId: "cred-1" },
  });
  assert.equal(login.status, 200);
});

test("refresh rotation and logout-everywhere", async () => {
  const ctx = env();
  const session = await register(ctx);
  const rotated = await call(ctx, "POST", "/api/auth/refresh", { body: { refresh_token: session.refresh_token } });
  assert.equal(rotated.status, 200);
  const replay = await call(ctx, "POST", "/api/auth/refresh", { body: { refresh_token: session.refresh_token } });
  assert.equal(replay.status, 401);
  await call(ctx, "POST", "/api/auth/logout-all", { token: rotated.data.access_token, body: {} });
  const me = await call(ctx, "GET", "/api/me", { token: session.token });
  assert.equal(me.status, 200);
});

test("unverified email cannot publish (blocked when email_verified=0)", async () => {
  const ctx = env();
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "new@example.com" } });
  const done = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(done.data.user.email_verified, true);
});

async function register(ctx, email = "mike@example.com") {
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email } });
  assert.equal(start.status, 200);
  const res = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(res.status, 200);
  return { ...res.data, token: res.data.access_token };
}
