import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins, pickCorsOrigin, withCors } from "../src/handlers.js";
import { assertPublicHandle, call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

function env() {
  return testEnv();
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
  const { token } = await register(ctx, "grower@example.com");
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.equal(me.data.user.email, "grower@example.com");
  assert.equal(me.data.user.email_verified, true);
  const locked = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem");
  assert.equal(locked.data.unlocked, false);
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(session.status, 200);
  const paid = await signedWebhook(
    ctx,
    stripeCheckoutEvent({
      sessionId: session.data.id,
      itemId: "king-oyster-thick-stem",
      userId: me.data.user.id,
    })
  );
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

test("prod CORS never reflects localhost even when CORS_ORIGIN lists it", () => {
  const ctx = {
    CORS_ORIGIN: "https://shroomlabs.io,https://www.shroomlabs.io,http://127.0.0.1:8888,http://localhost:8888",
    DEV_STUBS: "1",
  };
  const request = new Request("https://api.shroomlabs.io/health", {
    headers: { origin: "http://127.0.0.1:8888" },
  });
  assert.deepEqual(allowedOrigins(ctx, request), ["https://shroomlabs.io", "https://www.shroomlabs.io"]);
  assert.equal(pickCorsOrigin(ctx, request), "https://shroomlabs.io");
  const res = withCors(new Response("ok"), ctx, request);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://shroomlabs.io");
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
});

test("Netlify deploy-preview CORS is only allowed when DEV_STUBS is on", () => {
  const preview = "https://deploy-preview-18--shroomlabs.netlify.app";
  const local = new Request("http://127.0.0.1:8787/health", { headers: { origin: preview } });
  assert.ok(allowedOrigins({ DEV_STUBS: "1" }, local).includes(preview));
  assert.equal(allowedOrigins({ DEV_STUBS: "" }, local).includes(preview), false);
  const prod = new Request("https://api.shroomlabs.io/health", { headers: { origin: preview } });
  assert.equal(allowedOrigins({ DEV_STUBS: "1" }, prod).includes(preview), false);
});

test("affiliate click is blocked for psilocybin ids", async () => {
  const ctx = env();
  const res = await call(ctx, "GET", "/api/go/golden-teacher/example-spawn");
  assert.equal(res.status, 404);
});

test("magic link sign-in creates a verified user and session cookie", async () => {
  const ctx = env();
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "grower@example.com", turnstile: "ok" } });
  assert.equal(start.status, 200);
  assert.ok(start.data.debug_token);
  const done = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(done.status, 200);
  assert.match(done.headers.get("set-cookie") || "", /__Host-sl_session=/);
  assert.equal(done.data.user.email_verified, true);
  const row = await ctx.db.one("SELECT * FROM users WHERE email=?", ["grower@example.com"]);
  assertPublicHandle(row, done.data.user);
  const reuse = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(reuse.status, 401);
});

test("OIDC Google stub and passkey challenge", async () => {
  const ctx = env();
  const start = await call(ctx, "GET", "/api/auth/oidc/google/start");
  assert.equal(start.status, 200);
  assert.ok(start.data.authorize_url.includes("accounts.google.com"));
  const binding = String(start.headers.get("set-cookie")).split(";")[0];
  assert.match(binding, /^__Host-sl_oidc=/);
  const cb = await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${start.data.state}&code=stub`, {
    headers: { cookie: binding },
  });
  assert.equal(cb.status, 200);
  assert.equal(cb.data.user.email, "google.user@example.com");
  const stub = await ctx.db.one("SELECT * FROM users WHERE email=?", ["google.user@example.com"]);
  assertPublicHandle(stub, cb.data.user);
  assert.notEqual(stub.username, "google.user");
  const appleStart = await call(ctx, "GET", "/api/auth/oidc/apple/start");
  assert.equal(appleStart.status, 200);
  assert.ok(appleStart.data.authorize_url.includes("appleid.apple.com"));
  assert.match(appleStart.data.authorize_url, /response_mode=form_post/);
  const appleCookie = String(appleStart.headers.get("set-cookie")).split(";")[0];
  const appleCb = await call(ctx, "POST", "/api/auth/oidc/apple/callback", {
    form: { state: appleStart.data.state, code: "stub" },
    headers: { cookie: appleCookie, origin: "https://appleid.apple.com" },
  });
  assert.equal(appleCb.status, 200);
  assert.equal(appleCb.data.user.email, "apple.user@example.com");
  const { token } = await register(ctx, "passkey@example.com");
  const begin = await call(ctx, "POST", "/api/auth/webauthn/register/begin", { token, body: {} });
  assert.equal(begin.status, 200);
  assert.ok(begin.data.challenge);
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
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "new@example.com", turnstile: "ok" } });
  const done = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(done.data.user.email_verified, true);
});


test("internal errors return a generic message and request id, and the log is scrubbed", async () => {
  const ctx = env();
  await call(ctx, "GET", "/health");
  const secret = ["unit", "test", "credential", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4"].join("_");
  const leak = `D1_ERROR: no such column: users.secret_col; token=${secret}`;
  const realAll = ctx.db.all.bind(ctx.db);
  ctx.db.all = async () => {
    throw new Error(leak);
  };
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  let res;
  try {
    res = await call(ctx, "GET", "/api/profiles?pack=culinary", { headers: { authorization: `Bearer ${secret}` } });
  } finally {
    console.error = realError;
    ctx.db.all = realAll;
  }
  assert.equal(res.status, 500);
  assert.deepEqual(Object.keys(res.data).sort(), ["error", "request_id"]);
  assert.equal(res.data.error, "Something went wrong on our side. Please try again.");
  assert.match(res.data.request_id, /^[0-9a-f]{24}$/);
  assert.equal(res.headers.get("x-request-id"), res.data.request_id);
  const body = JSON.stringify(res.data);
  for (const fragment of ["D1_ERROR", "no such column", "secret_col", secret]) assert.ok(!body.includes(fragment), fragment);
  assert.equal(logged.length, 1);
  const entry = JSON.parse(logged[0]);
  assert.equal(entry.request_id, res.data.request_id);
  assert.match(entry.message, /no such column/);
  assert.ok(!logged[0].includes(secret), "secret must not reach the log");
  assert.ok(!logged[0].toLowerCase().includes("bearer"), "headers are never logged");
});

test("non-Error throws also get the generic 500", async () => {
  const ctx = env();
  await call(ctx, "GET", "/health");
  ctx.db.all = async () => {
    throw "raw string detail";
  };
  const realError = console.error;
  console.error = () => {};
  let res;
  try {
    res = await call(ctx, "GET", "/api/profiles");
  } finally {
    console.error = realError;
  }
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(res.data).includes("raw string detail"));
});
