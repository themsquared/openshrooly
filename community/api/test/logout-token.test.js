import { test } from "node:test";
import assert from "node:assert/strict";
import { call, register, testEnv } from "./helpers.js";
import { sha256Hex } from "../src/crypto.js";

test("signing out ends the sign-in access token, so paid content locks again", async () => {
  const ctx = testEnv();
  const session = await register(ctx, "signout@example.com");
  const me = await call(ctx, "GET", "/api/me", { token: session.token });
  assert.equal(me.status, 200);
  await ctx.db.run("INSERT INTO entitlements (user_id, item_id, item_type, granted_at) VALUES (?, ?, ?, ?)", [
    session.user.id,
    "king-oyster-thick-stem",
    "profile",
    "2026-10-26T00:00:00Z",
  ]);
  assert.equal((await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token: session.token })).data.unlocked, true);
  const out = await call(ctx, "POST", "/api/auth/logout", { token: session.token, body: {} });
  assert.equal(out.status, 200);
  assert.equal((await call(ctx, "GET", "/api/me", { token: session.token })).status, 401);
  const after = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token: session.token });
  assert.equal(after.data.unlocked, false);
  assert.equal(after.data.profile.locked, true);
  // Signing back in brings the purchase back.
  const back = await register(ctx, "signout@example.com");
  assert.equal(back.user.id, session.user.id);
  assert.equal((await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token: back.token })).data.unlocked, true);
});

test("signing out with a sign-in token leaves personal API tokens alone", async () => {
  const ctx = testEnv();
  const session = await register(ctx, "pat@example.com");
  await ctx.db.run("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)", [
    session.user.id,
    "my script",
    "hash_of_personal_token",
    "2026-10-26T00:00:00Z",
  ]);
  await call(ctx, "POST", "/api/auth/logout", { token: session.token, body: {} });
  const left = await ctx.db.all("SELECT id, name, created_at FROM api_tokens WHERE user_id=?", [session.user.id]);
  assert.deepEqual(left.map((t) => t.name), ["my script"]);
});

async function addToken(ctx, userId, name, raw, createdAt) {
  await ctx.db.run("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)", [
    userId,
    name,
    await sha256Hex(raw),
    createdAt,
  ]);
}

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");

test("a sign-in token older than the 30 day refresh lifetime no longer signs anyone in", async () => {
  const ctx = testEnv();
  const session = await register(ctx, "old@example.com");
  await ctx.db.run("INSERT INTO entitlements (user_id, item_id, item_type, granted_at) VALUES (?, ?, ?, ?)", [
    session.user.id,
    "king-oyster-thick-stem",
    "profile",
    "2026-09-01T00:00:00Z",
  ]);
  await addToken(ctx, session.user.id, "mobile-access", "old-sign-in-token", daysAgo(31));
  await addToken(ctx, session.user.id, "mobile-access", "recent-sign-in-token", daysAgo(29));
  assert.equal((await call(ctx, "GET", "/api/me", { token: "old-sign-in-token" })).status, 401);
  const locked = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token: "old-sign-in-token" });
  assert.equal(locked.data.unlocked, false);
  assert.equal(locked.data.profile.locked, true);
  assert.equal((await call(ctx, "GET", "/api/me", { token: "recent-sign-in-token" })).status, 200);
  assert.equal((await call(ctx, "GET", "/api/me", { token: session.token })).status, 200);
});

test("personal script tokens never age out, however old", async () => {
  const ctx = testEnv();
  const session = await register(ctx, "script@example.com");
  await addToken(ctx, session.user.id, "my script", "old-script-token", daysAgo(400));
  const me = await call(ctx, "GET", "/api/me", { token: "old-script-token" });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, session.user.id);
});
