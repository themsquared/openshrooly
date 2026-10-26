import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, SAMPLE_CULINARY_PROFILE, testEnv } from "./helpers.js";
import {
  appleClientSecret,
  appleRelayEmail,
  resetAppleSecretCache,
  resetJwksCache,
  sha256B64url,
  verifyIdToken,
} from "../src/oidc.js";
import { capabilities } from "../src/providers.js";
import {
  KEY_ID,
  RELAY_EMAIL,
  SERVICES_ID,
  SITE,
  TEAM_ID,
  appleEnv,
  fakeApple,
  realFetch,
  signJwt,
  verifyEs256Jwt,
} from "./fake-apple.js";

let apple;

function liveEnv(extra = {}) {
  return testEnv({
    DEV_STUBS: "",
    OIDC_STUB: "",
    SITE_ORIGIN: SITE,
    ...appleEnv(apple.p8),
    ...extra,
  });
}

async function start(ctx, query = "") {
  const res = await call(ctx, "GET", `/api/auth/oidc/apple/start${query}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const location = res.headers.get("location") || "";
  const auth = location ? new URL(location) : null;
  return { res, setCookie, cookie: setCookie.split(";")[0], auth, state: auth?.searchParams.get("state") };
}

async function callback(ctx, { state, code = "c", cookie, user, origin = "https://appleid.apple.com", extra = {} } = {}) {
  const form = { ...extra };
  if (state !== undefined) form.state = state;
  if (code !== undefined) form.code = code;
  if (user !== undefined) form.user = user;
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origin !== undefined) headers.origin = origin;
  return call(ctx, "POST", "/api/auth/oidc/apple/callback", { form, headers });
}

const FIRST_USER = JSON.stringify({ name: { firstName: "Jane", lastName: "Appleseed" }, email: RELAY_EMAIL });

async function signIn(ctx, { query = "", user = FIRST_USER } = {}) {
  const s = await start(ctx, query);
  const row = await ctx.db.one("SELECT * FROM oauth_states WHERE state=?", [s.state]);
  apple.pendingNonce = row.nonce;
  const cb = await callback(ctx, { state: s.state, cookie: s.cookie, user });
  const loc = cb.headers.get("location") || "";
  const frag = new URLSearchParams(loc.split("#")[1] || "");
  const handoff = frag.get("oidc");
  const done = handoff ? await call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: handoff } }) : null;
  return { s, cb, loc, frag, handoff, done };
}

function refused(res) {
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `${SITE}/login?error=oidc`);
  assert.doesNotMatch(res.headers.get("set-cookie") || "", /sl_session=/);
}

beforeEach(async () => {
  resetJwksCache();
  resetAppleSecretCache();
  apple = await fakeApple();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("authorize redirect carries Services ID, form_post, PKCE S256, state, nonce, and a None state cookie", async () => {
  const ctx = liveEnv();
  const s = await start(ctx);
  assert.equal(s.res.status, 302);
  assert.equal(s.auth.origin + s.auth.pathname, "https://appleid.apple.com/auth/authorize");
  const p = s.auth.searchParams;
  assert.equal(p.get("client_id"), SERVICES_ID);
  assert.equal(p.get("redirect_uri"), "https://api.shroomlabs.io/api/auth/oidc/apple/callback");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("response_mode"), "form_post");
  assert.equal(p.get("scope"), "email");
  assert.doesNotMatch(s.auth.toString(), /[?&]scope=[^&]*name/);
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.ok(p.get("nonce").length >= 32);
  const row = await ctx.db.one("SELECT * FROM oauth_states WHERE state=?", [p.get("state")]);
  assert.equal(p.get("code_challenge"), await sha256B64url(row.code_verifier));
  assert.equal(row.nonce, p.get("nonce"));
  assert.match(s.setCookie, /^__Host-sl_oidc=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; Secure; SameSite=None; Max-Age=600$/);
  assert.equal(p.get("state"), await sha256B64url(s.cookie.split("=")[1]));
  assert.doesNotMatch(s.auth.toString(), /BEGIN PRIVATE KEY/);
  assert.doesNotMatch(s.auth.toString(), /A1B2C3D4E5/);
});

test("happy path: first Apple sign-in treats Hide My Email as verified, mints an ES256 client secret, and sets a Lax session cookie", async () => {
  const ctx = liveEnv();
  const r = await signIn(ctx);
  assert.equal(r.cb.status, 302);
  assert.ok(r.loc.startsWith(`${SITE}/auth/callback#oidc=`), r.loc);
  assert.equal(r.frag.get("next"), "/account");
  assert.match(r.cb.headers.get("set-cookie"), /__Host-sl_oidc=; .*SameSite=None; .*Max-Age=0/);
  assert.equal(apple.tokenCalls.length, 1);
  const sent = apple.tokenCalls[0];
  assert.equal(sent.grant_type, "authorization_code");
  assert.equal(sent.client_id, SERVICES_ID);
  assert.equal(sent.redirect_uri, "https://api.shroomlabs.io/api/auth/oidc/apple/callback");
  assert.ok(sent.code_verifier.length >= 43);
  assert.doesNotMatch(sent.client_secret, /BEGIN PRIVATE KEY/);
  const minted = await verifyEs256Jwt(apple.p8.publicKey, sent.client_secret);
  assert.equal(minted.ok, true);
  assert.equal(minted.header.alg, "ES256");
  assert.equal(minted.header.kid, KEY_ID);
  assert.equal(minted.claims.iss, TEAM_ID);
  assert.equal(minted.claims.sub, SERVICES_ID);
  assert.equal(minted.claims.aud, "https://appleid.apple.com");
  assert.equal(r.done.status, 200, JSON.stringify(r.done.data));
  assert.equal(r.done.data.user.email, RELAY_EMAIL);
  assert.equal(r.done.data.user.email_verified, true);
  const row = await ctx.db.one("SELECT * FROM users WHERE email=?", [RELAY_EMAIL]);
  assert.notEqual(row.display_name, "Jane Appleseed");
  assert.equal(row.display_name, row.username);
  assert.match(row.username, /^grower_[0-9a-f]{10}$/);
  assert.doesNotMatch(row.username, /jane|appleseed|grower@/i);
  assert.notEqual(row.username, "grower");
  assert.equal(r.done.data.user.username, row.username);
  assert.equal(Object.hasOwn(r.done.data.user, "display_name"), false);
  assert.doesNotMatch(JSON.stringify(r.done.data.user), /\bJane\b|\bAppleseed\b/i);
  const session = r.done.headers.get("set-cookie");
  assert.match(session, /^__Host-sl_session=/);
  assert.match(session, /; HttpOnly/);
  assert.match(session, /; Secure/);
  assert.match(session, /; SameSite=Lax/);
  const again = await call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: r.handoff } });
  assert.equal(again.status, 401);
});

test("Hide My Email does not put the real name or email local part in the public username", async () => {
  const ctx = liveEnv();
  apple.claims = { email: "hidden-xyz@privaterelay.appleid.com" };
  const r = await signIn(ctx, {
    user: JSON.stringify({ name: { firstName: "Mike", lastName: "Moore" }, email: "hidden-xyz@privaterelay.appleid.com" }),
  });
  assert.equal(r.done.status, 200);
  const row = await ctx.db.one("SELECT * FROM users WHERE email=?", ["hidden-xyz@privaterelay.appleid.com"]);
  assert.match(row.username, /^grower_[0-9a-f]{10}$/);
  assert.doesNotMatch(row.username, /mike|moore|hidden-xyz/i);
  assert.notEqual(row.username, "hidden-xyz");
  assert.equal(r.done.data.user.username, row.username);
  assert.notEqual(row.display_name, "Mike Moore");
  assert.equal(row.display_name, row.username);
  assert.equal(Object.hasOwn(r.done.data.user, "display_name"), false);
  assert.doesNotMatch(JSON.stringify(r.done.data.user), /\bMike\b|\bMoore\b/i);
});

test("Apple real name is never stored as display_name and never appears on public or owner API surfaces", async () => {
  const ctx = liveEnv();
  apple.claims = { email: "hidden-xyz@privaterelay.appleid.com" };
  const r = await signIn(ctx, {
    user: JSON.stringify({ name: { firstName: "Jane", lastName: "Appleseed" }, email: "hidden-xyz@privaterelay.appleid.com" }),
  });
  assert.equal(r.done.status, 200);
  const row = await ctx.db.one("SELECT * FROM users WHERE email=?", ["hidden-xyz@privaterelay.appleid.com"]);
  assert.match(row.username, /^grower_[0-9a-f]{10}$/);
  assert.equal(row.display_name, row.username);
  assert.doesNotMatch(row.display_name, /jane|appleseed/i);

  const leak = (value, label) => {
    if (value == null) return;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    assert.doesNotMatch(text, /\bJane\b|\bAppleseed\b/i, label);
    assert.ok(!text.includes("display_name"), `${label} must not include display_name`);
  };

  leak(r.done.data.user, "oidc complete");
  assert.equal(r.done.data.user.username, row.username);

  const token = r.done.data.access_token;
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.equal(me.status, 200);
  leak(me.data, "/api/me");
  assert.equal(me.data.user.username, row.username);
  assert.equal(Object.hasOwn(me.data.user, "display_name"), false);

  const profile = {
    ...SAMPLE_CULINARY_PROFILE,
    id: "relay-oyster",
    name: "Relay Oyster",
  };
  const created = await call(ctx, "POST", "/api/profiles", { token, body: profile });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.author, row.username);
  leak(created.data, "publish");

  const shown = await call(ctx, "GET", `/api/profiles/${profile.id}`);
  assert.equal(shown.status, 404);
  const ownerShown = await call(ctx, "GET", `/api/profiles/${profile.id}`, { token });
  assert.equal(ownerShown.status, 200);
  assert.equal(ownerShown.data.profile.author, row.username);
  leak(ownerShown.data, "profile GET");

  const rated = await call(ctx, "POST", `/api/profiles/${profile.id}/rate`, {
    token,
    body: { stars: 5, comment: "worked" },
  });
  assert.equal(rated.status, 200);
  const afterRate = await call(ctx, "GET", `/api/profiles/${profile.id}`, { token });
  leak(afterRate.data, "ratings");
  assert.ok(afterRate.data.ratings.some((item) => item.username === row.username));
  assert.ok(!afterRate.data.ratings.some((item) => item.display_name));

  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  const card = list.data.find((item) => item.id === profile.id);
  assert.equal(card, undefined);
  leak((await call(ctx, "GET", "/api/search?pack=culinary&q=Relay")).data, "search");
  const exported = await call(ctx, "GET", `/api/profiles/${profile.id}.json`);
  assert.equal(exported.status, 404);

  const hub = await call(ctx, "GET", "/api/hub/pull", { token });
  assert.equal(hub.status, 200);
  assert.equal(hub.data.hub_user, row.username);
  const hubProfile = hub.data.profiles.find((item) => item.id === profile.id);
  assert.equal(hubProfile.author, row.username);
  leak(hubProfile, "hub profile");
  leak({ hub_user: hub.data.hub_user }, "hub user");

  const passkey = await call(ctx, "POST", "/api/auth/webauthn/register/begin", { token, body: {} });
  assert.equal(passkey.status, 200);
  leak(passkey.data, "webauthn begin");
  assert.equal(passkey.data.user.displayName, row.username);
});

test("a later Apple sign-in works without the name field and reuses the account", async () => {
  const ctx = liveEnv();
  const first = await signIn(ctx);
  assert.equal(first.done.status, 200);
  const second = await signIn(ctx, { user: undefined });
  assert.equal(second.done.status, 200);
  assert.equal(second.done.data.user.id, first.done.data.user.id);
  assert.equal(apple.tokenCalls.length, 2);
  assert.equal(apple.tokenCalls[0].client_secret, apple.tokenCalls[1].client_secret);
});

test("missing state, missing cookie, a foreign Origin, and a cookie from another browser are refused", async () => {
  const ctx = liveEnv();
  const a = await start(ctx);
  const b = await start(ctx);
  refused(await callback(ctx, { cookie: a.cookie }));
  refused(await callback(ctx, { state: a.state }));
  const tampered = a.state.slice(0, -2) + (a.state.endsWith("AA") ? "BB" : "AA");
  refused(await callback(ctx, { state: tampered, cookie: a.cookie }));
  refused(await callback(ctx, { state: a.state, cookie: b.cookie }));
  const cross = await callback(ctx, { state: a.state, cookie: a.cookie, origin: "https://evil.example" });
  assert.equal(cross.status, 403);
  assert.equal(cross.data.error, "origin not allowed");
  assert.equal(apple.tokenCalls.length, 0);
});

test("Apple form_post Origin is allowed only on the Apple callback; other POSTs still need our site Origin", async () => {
  const ctx = liveEnv();
  const magic = await call(ctx, "POST", "/api/auth/magic/start", {
    body: { email: "x@example.com", turnstile: "ok" },
    headers: { origin: "https://appleid.apple.com" },
  });
  assert.equal(magic.status, 403);
  assert.equal(magic.data.error, "origin not allowed");
  const s = await start(ctx);
  const row = await ctx.db.one("SELECT * FROM oauth_states WHERE state=?", [s.state]);
  apple.pendingNonce = row.nonce;
  const cb = await callback(ctx, { state: s.state, cookie: s.cookie, origin: "https://appleid.apple.com" });
  assert.equal(cb.status, 302);
  assert.ok(cb.headers.get("location").startsWith(`${SITE}/auth/callback#oidc=`));
});

test("a replayed callback is refused and the nonce cannot be reused", async () => {
  const ctx = liveEnv();
  const r = await signIn(ctx);
  assert.equal(r.done.status, 200);
  refused(await callback(ctx, { state: r.s.state, cookie: r.s.cookie }));
  assert.equal(apple.tokenCalls.length, 1);
});

const BAD_TOKENS = {
  "signature from a different key": (a) => (a.signer = a.rogue.privateKey),
  "wrong audience": (a) => (a.claims = { aud: "com.evil.web" }),
  expired: (a) => (a.claims = { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }),
  "replayed nonce": (a) => (a.claims = { nonce: "attacker-nonce" }),
  "unknown kid": (a) => (a.header = { kid: "kid-other" }),
};

for (const [name, mutate] of Object.entries(BAD_TOKENS)) {
  test(`id_token rejected: ${name}`, async () => {
    const ctx = liveEnv();
    mutate(apple);
    const r = await signIn(ctx);
    refused(r.cb);
    assert.equal(await ctx.db.one("SELECT * FROM users WHERE email=?", [RELAY_EMAIL]), null);
  });
}

test("linking: an unverified account with the same email is never taken over", async () => {
  const ctx = liveEnv();
  await ctx.db.run(
    "INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["squatter", "x", RELAY_EMAIL, 0, "squatter", "user", new Date().toISOString()]
  );
  const r = await signIn(ctx);
  refused(r.cb);
});

test("linking: a verified account with the same email is linked", async () => {
  const ctx = liveEnv();
  await ctx.db.run(
    "INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["magic", "x", RELAY_EMAIL, 1, "magic", "user", new Date().toISOString()]
  );
  const existing = await ctx.db.one("SELECT * FROM users WHERE email=?", [RELAY_EMAIL]);
  const r = await signIn(ctx);
  assert.equal(r.done.status, 200);
  assert.equal(r.done.data.user.id, existing.id);
});

test("redirect after login stays on our site", async () => {
  const ctx = liveEnv();
  for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example"]) {
    const s = await start(ctx, `?next=${encodeURIComponent(bad)}`);
    assert.equal(s.res.status, 400, bad);
  }
  const ok = await signIn(ctx, { query: `?next=${encodeURIComponent("/device?id=7")}` });
  assert.equal(ok.frag.get("next"), "/device?id=7");
});

test("Apple shows as configured only when team, key, services, and private key are all set", () => {
  assert.equal(capabilities(appleEnv(apple.p8)).apple, true);
  assert.equal(capabilities({ APPLE_TEAM_ID: TEAM_ID, APPLE_KEY_ID: KEY_ID, APPLE_SERVICES_ID: SERVICES_ID }).apple, false);
  assert.equal(capabilities({ APPLE_SERVICES_ID: SERVICES_ID }).apple, false);
  assert.equal(capabilities({}).apple, false);
});

test("appleClientSecret is a short-lived ES256 JWT and is cached; a bad key returns empty", async () => {
  const first = await appleClientSecret(appleEnv(apple.p8));
  const second = await appleClientSecret(appleEnv(apple.p8));
  assert.equal(first, second);
  const minted = await verifyEs256Jwt(apple.p8.publicKey, first);
  assert.equal(minted.ok, true);
  assert.ok(minted.claims.exp - minted.claims.iat <= 15 * 60);
  resetAppleSecretCache();
  assert.equal(await appleClientSecret({ ...appleEnv(apple.p8), APPLE_PRIVATE_KEY: "not-a-key" }), "");
});

test("verifyIdToken accepts a Hide My Email address without email_verified", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(apple.good.privateKey, { alg: "RS256", kid: apple.kid }, {
    iss: "https://appleid.apple.com",
    aud: SERVICES_ID,
    sub: "1",
    email: RELAY_EMAIL,
    iat: now,
    exp: now + 60,
    nonce: "n1",
  });
  const out = await verifyIdToken(token, { provider: "apple", clientId: SERVICES_ID, nonce: "n1" });
  assert.equal(out.ok, true, out.reason);
  assert.equal(appleRelayEmail(RELAY_EMAIL), true);
  assert.equal(appleRelayEmail("grower@icloud.com"), false);
});

test("a non-relay Apple email still needs email_verified", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(apple.good.privateKey, { alg: "RS256", kid: apple.kid }, {
    iss: "https://appleid.apple.com",
    aud: SERVICES_ID,
    sub: "1",
    email: "grower@icloud.com",
    iat: now,
    exp: now + 60,
    nonce: "n1",
  });
  const out = await verifyIdToken(token, { provider: "apple", clientId: SERVICES_ID, nonce: "n1" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "email not verified");
});

test("rate limits: start and callback", async () => {
  const ctx = liveEnv();
  for (let i = 0; i < 10; i += 1) assert.equal((await start(ctx)).res.status, 302);
  assert.equal((await start(ctx)).res.status, 429);
  const ctx2 = liveEnv();
  const s = await start(ctx2);
  for (let i = 0; i < 20; i += 1) refused(await callback(ctx2, { state: "x", cookie: "__Host-sl_oidc=y" }));
  const row = await ctx2.db.one("SELECT * FROM oauth_states WHERE state=?", [s.state]);
  apple.pendingNonce = row.nonce;
  refused(await callback(ctx2, { state: s.state, cookie: s.cookie }));
  assert.equal(apple.tokenCalls.length, 0);
});

test("malformed first-sign-in user JSON is ignored", async () => {
  const ctx = liveEnv();
  const r = await signIn(ctx, { user: "not-json" });
  assert.equal(r.done.status, 200);
  const row = await ctx.db.one("SELECT * FROM users WHERE email=?", [RELAY_EMAIL]);
  assert.ok(row.display_name);
  assert.notEqual(row.display_name, "Jane Appleseed");
});
