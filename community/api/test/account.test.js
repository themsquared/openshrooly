import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryDb } from "../src/db.js";
import { handleRequest } from "../src/handlers.js";
import { createMemoryStorage } from "../src/storage.js";
import { generateP256, jwkOf } from "../src/devices.js";

function env() {
  return {
    db: createMemoryDb(),
    storage: createMemoryStorage(),
    CORS_ORIGIN: "http://127.0.0.1:8888",
    SITE_NAME: "test",
    AUTH_DEBUG: "1",
    DEV_STUBS: "1",
    HIBP_DISABLED: "1",
    SITE_ORIGIN: "http://127.0.0.1:8888",
    TURNSTILE_STUB: "1",
    DEVICE_ISSUER: "worker",
  };
}

async function call(ctx, method, path, { cookie, token, body } = {}) {
  const headers = { "content-type": "application/json", origin: "http://127.0.0.1:8888" };
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await handleRequest(new Request(`http://test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), ctx);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, data, headers: res.headers };
}

async function signIn(ctx, email) {
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email, turnstile: "ok" } });
  const done = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const cookie = (done.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.includes("sl_session="), "session cookie set");
  return { cookie, token: done.data.access_token, user: done.data.user };
}

async function linkChamber(ctx, cookie, hardware) {
  const keys = await generateP256();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: hardware, public_jwk: await jwkOf(keys.publicKey), name: "Kitchen" },
  });
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
  const claimed = await call(ctx, "POST", "/api/devices/claim", { cookie, body: { code: enrolled.data.claim_code } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
  return enrolled.data.device_id;
}

test("export gives the signed in user their data without secrets", async () => {
  const ctx = env();
  const { cookie, user } = await signIn(ctx, "export@example.com");
  const deviceId = await linkChamber(ctx, cookie, "aabbccdd00000001");
  await call(ctx, "POST", "/api/me/tokens", { cookie, body: { name: "home-hub" } });
  const res = await call(ctx, "GET", "/api/me/export", { cookie });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(res.headers.get("content-disposition"), /attachment; filename="shroomlabs-.+\.json"/);
  assert.equal(res.data.account.id, user.id);
  assert.equal(res.data.account.email, "export@example.com");
  assert.deepEqual(res.data.chambers.map((c) => c.id), [deviceId]);
  assert.equal(res.data.chambers[0].hardware_id, "aabbccdd00000001");
  assert.ok(res.data.sign_in.hub_connections.some((t) => t.name === "home-hub"));
  const text = JSON.stringify(res.data);
  for (const secret of ["password_hash", "token_hash", "session_hash", "totp_secret", "public_jwk", "claim_code_hash"]) {
    assert.ok(!text.includes(secret), `export leaks ${secret}`);
  }
});

test("export and delete refuse a hub connection token and signed out callers", async () => {
  const ctx = env();
  const { cookie, user } = await signIn(ctx, "hub@example.com");
  const minted = await call(ctx, "POST", "/api/me/tokens", { cookie, body: { name: "mobile-access" } });
  assert.equal(minted.data.name, "hub");
  assert.equal((await call(ctx, "GET", "/api/me/export")).status, 401);
  assert.equal((await call(ctx, "GET", "/api/me/export", { token: minted.data.token })).status, 403);
  const del = await call(ctx, "POST", "/api/me/delete", { token: minted.data.token, body: { confirm: user.username } });
  assert.equal(del.status, 403);
  assert.ok(await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]));
});

test("the website sign-in token can export, the same as the cookie", async () => {
  const ctx = env();
  const { token } = await signIn(ctx, "web@example.com");
  const res = await call(ctx, "GET", "/api/me/export", { token });
  assert.equal(res.status, 200, JSON.stringify(res.data));
});

test("delete needs the exact username typed", async () => {
  const ctx = env();
  const { cookie, user } = await signIn(ctx, "typo@example.com");
  for (const confirm of ["", "DELETE", `${user.username}x`]) {
    const res = await call(ctx, "POST", "/api/me/delete", { cookie, body: { confirm } });
    assert.equal(res.status, 400, confirm);
  }
  assert.ok(await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]));
});

test("delete removes the account, signs out, and unlinks chambers so they can be linked again", async () => {
  const ctx = env();
  const { cookie, user } = await signIn(ctx, "gone@example.com");
  const deviceId = await linkChamber(ctx, cookie, "aabbccdd00000002");
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [deviceId, "{}", new Date().toISOString()]);
  const other = await signIn(ctx, "stays@example.com");

  const res = await call(ctx, "POST", "/api/me/delete", { cookie, body: { confirm: ` ${user.username.toUpperCase()} ` } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);

  assert.equal(await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]), null);
  assert.equal((await call(ctx, "GET", "/api/me", { cookie })).status, 401);
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  assert.equal(device.status, "revoked");
  assert.equal(device.owner_id, null);
  assert.equal(device.name, "Chamber");
  assert.deepEqual(await ctx.db.all("SELECT * FROM device_telemetry WHERE device_id=?", [deviceId]), []);
  assert.deepEqual(await ctx.db.all("SELECT * FROM sessions WHERE user_id=?", [user.id]), []);
  assert.deepEqual(await ctx.db.all("SELECT * FROM auth_identities WHERE user_id=?", [user.id]), []);
  // Someone else's account is untouched.
  assert.equal((await call(ctx, "GET", "/api/me", { cookie: other.cookie })).status, 200);
  // The same email can sign up again as a fresh account.
  const again = await signIn(ctx, "gone@example.com");
  assert.notEqual(again.user.id, user.id);
});

test("delete waits for a paid Grow Coach plan to be cancelled", async () => {
  const ctx = env();
  const { cookie, user } = await signIn(ctx, "coach@example.com");
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 20 * 86400000).toISOString();
  await ctx.db.run("INSERT INTO coach_subs (user_id, status, period_end, auto_tune, created_at) VALUES (?, ?, ?, ?, ?)", [user.id, "active", later, 0, now]);
  await ctx.db.run(
    "INSERT INTO checkouts (id, user_id, item_id, provider, status, amount_cents, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["cs_1", user.id, "grow-coach", "stripe", "paid", 499, "{}", now]
  );
  const res = await call(ctx, "POST", "/api/me/delete", { cookie, body: { confirm: user.username } });
  assert.equal(res.status, 409, JSON.stringify(res.data));
  assert.ok(await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]));
});

test("a failed person check says what to do, in plain words", async () => {
  const ctx = env();
  const res = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "bot@example.com", turnstile: "nope" } });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "We couldn't confirm you're a person. Tap the box and try again.");
  assert.equal(res.data.code, "turnstile_failed");
  assert.doesNotMatch(res.data.error, /Turnstile/);
});
