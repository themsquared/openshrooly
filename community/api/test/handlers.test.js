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
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

test("health and culinary catalog", async () => {
  const ctx = env();
  const health = await call(ctx, "GET", "/health");
  assert.equal(health.status, 200);
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.ok(list.data.some((p) => p.id === "pearl-oyster"));
  assert.ok(!list.data.some((p) => p.id === "golden-teacher"));
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
  assert.equal(me.data.user.username, "mike");
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
});

test("affiliate click is blocked for psilocybin ids", async () => {
  const ctx = env();
  const res = await call(ctx, "GET", "/api/go/golden-teacher/example-spawn");
  assert.equal(res.status, 404);
});

async function register(ctx) {
  const res = await call(ctx, "POST", "/api/auth/register", {
    body: { username: "mike", password: "hunter2" },
  });
  assert.equal(res.status, 200);
  return res.data;
}
