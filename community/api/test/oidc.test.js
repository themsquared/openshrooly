import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_CULINARY_PROFILE,
  assertNoPublicPii,
  assertPublicHandle,
  call,
  testEnv,
} from "./helpers.js";
import { renderLlms, renderProfilePage, renderSitemap } from "../../web/scripts/generate-seo.js";
import { resetJwksCache, safeNextPath, sha256B64url, verifyIdToken } from "../src/oidc.js";
import { capabilities } from "../src/providers.js";

import { CLIENT_ID, SITE, b64url, fakeGoogle, realFetch, signJwt } from "./fake-google.js";

let google;
function liveEnv(extra = {}) {
  return testEnv({
    DEV_STUBS: "",
    OIDC_STUB: "",
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "test-secret-value",
    SITE_ORIGIN: SITE,
    ...extra,
  });
}

async function start(ctx, query = "") {
  const res = await call(ctx, "GET", `/api/auth/oidc/google/start${query}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const location = res.headers.get("location") || "";
  const auth = location ? new URL(location) : null;
  return { res, setCookie, cookie: setCookie.split(";")[0], auth, state: auth?.searchParams.get("state") };
}

async function callback(ctx, { state, code = "4/auth-code", cookie } = {}) {
  const qs = new URLSearchParams();
  if (state !== undefined) qs.set("state", state);
  if (code !== undefined) qs.set("code", code);
  return call(ctx, "GET", `/api/auth/oidc/google/callback?${qs}`, { headers: cookie ? { cookie } : {} });
}

/** Full happy flow; returns the final complete() response. */
async function signIn(ctx, query = "") {
  const s = await start(ctx, query);
  const row = await ctx.db.one("SELECT * FROM oauth_states WHERE state=?", [s.state]);
  google.pendingNonce = row.nonce;
  const cb = await callback(ctx, { state: s.state, cookie: s.cookie });
  const loc = cb.headers.get("location") || "";
  const frag = new URLSearchParams(loc.split("#")[1] || "");
  const handoff = frag.get("oidc");
  const done = handoff ? await call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: handoff } }) : null;
  return { s, cb, loc, frag, handoff, done };
}

function refused(res) {
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `${SITE}/login.html?error=oidc`);
  assert.doesNotMatch(res.headers.get("set-cookie") || "", /sl_session=/);
}

beforeEach(async () => {
  resetJwksCache();
  google = await fakeGoogle();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("authorize redirect carries client_id, redirect_uri, PKCE S256, state, nonce, scope", async () => {
  const ctx = liveEnv();
  const s = await start(ctx);
  assert.equal(s.res.status, 302);
  assert.equal(s.auth.origin + s.auth.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const p = s.auth.searchParams;
  assert.equal(p.get("client_id"), CLIENT_ID);
  assert.equal(p.get("redirect_uri"), "https://api.shroomlabs.io/api/auth/oidc/google/callback");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("scope"), "openid email profile");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.ok(p.get("nonce").length >= 32);
  const row = await ctx.db.one("SELECT * FROM oauth_states WHERE state=?", [p.get("state")]);
  assert.equal(p.get("code_challenge"), await sha256B64url(row.code_verifier));
  assert.equal(row.nonce, p.get("nonce"));
  // State is bound to an HttpOnly, Secure, Lax cookie: state = SHA-256(cookie value).
  assert.match(s.setCookie, /^__Host-sl_oidc=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  assert.equal(p.get("state"), await sha256B64url(s.cookie.split("=")[1]));
  assert.doesNotMatch(s.auth.toString(), /test-secret-value/);
});

test("happy path: verified Google login creates a verified account and a Lax session cookie", async () => {
  const ctx = liveEnv();
  const r = await signIn(ctx);
  assert.equal(r.cb.status, 302);
  assert.ok(r.loc.startsWith(`${SITE}/auth/callback.html#oidc=`), r.loc);
  assert.equal(r.frag.get("next"), "/account.html");
  assert.match(r.cb.headers.get("set-cookie"), /__Host-sl_oidc=; .*Max-Age=0/);
  assert.equal(google.tokenCalls.length, 1);
  const sent = google.tokenCalls[0];
  assert.equal(sent.grant_type, "authorization_code");
  assert.equal(sent.client_id, CLIENT_ID);
  assert.equal(sent.client_secret, "test-secret-value");
  assert.equal(sent.redirect_uri, "https://api.shroomlabs.io/api/auth/oidc/google/callback");
  assert.ok(sent.code_verifier.length >= 43);
  assert.equal(r.done.status, 200, JSON.stringify(r.done.data));
  assert.equal(r.done.data.user.email, "grower@gmail.com");
  assert.equal(r.done.data.user.email_verified, true);
  const created = await ctx.db.one("SELECT * FROM users WHERE email=?", ["grower@gmail.com"]);
  assertPublicHandle(created, r.done.data.user);
  assert.ok(r.done.data.access_token);
  const session = r.done.headers.get("set-cookie");
  assert.match(session, /^__Host-sl_session=/);
  assert.match(session, /; HttpOnly/);
  assert.match(session, /; Secure/);
  assert.match(session, /; SameSite=Lax/);
  // The handoff token is single use.
  const again = await call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: r.handoff } });
  assert.equal(again.status, 401);
  // A handoff token is not a magic link.
  const asMagic = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: r.handoff } });
  assert.equal(asMagic.status, 401);
});

test("missing state, missing cookie, tampered state and a cookie from another browser are refused", async () => {
  const ctx = liveEnv();
  const a = await start(ctx);
  const b = await start(ctx);
  refused(await callback(ctx, { cookie: a.cookie }));
  refused(await callback(ctx, { state: a.state }));
  const tampered = a.state.slice(0, -2) + (a.state.endsWith("AA") ? "BB" : "AA");
  refused(await callback(ctx, { state: tampered, cookie: a.cookie }));
  refused(await callback(ctx, { state: a.state, cookie: b.cookie }));
  assert.equal(google.tokenCalls.length, 0);
});

test("a replayed callback (same state, cookie and code) is refused and the code is exchanged once", async () => {
  const ctx = liveEnv();
  const r = await signIn(ctx);
  assert.equal(r.done.status, 200);
  refused(await callback(ctx, { state: r.s.state, cookie: r.s.cookie }));
  assert.equal(google.tokenCalls.length, 1);
});

test("expired state is refused", async () => {
  const ctx = liveEnv();
  const s = await start(ctx);
  const row = await ctx.db.one("SELECT * FROM oauth_states WHERE state=?", [s.state]);
  row.expires_at = "2000-01-01T00:00:00.000Z";
  refused(await callback(ctx, { state: s.state, cookie: s.cookie }));
});

test("provider error and token endpoint failure are refused generically", async () => {
  const ctx = liveEnv();
  const s = await start(ctx);
  refused(await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${s.state}&error=access_denied`, { headers: { cookie: s.cookie } }));
  google.tokenStatus = 400;
  const r = await signIn(ctx);
  refused(r.cb);
});

const BAD_TOKENS = {
  "signature from a different key": (g) => (g.signer = g.rogue.privateKey),
  "wrong audience": (g) => (g.claims = { aud: "someone-else.apps.googleusercontent.com", azp: "someone-else" }),
  "wrong azp": (g) => (g.claims = { azp: "someone-else" }),
  "wrong issuer": (g) => (g.claims = { iss: "https://evil.example" }),
  expired: (g) => (g.claims = { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }),
  "iat in the future": (g) => (g.claims = { iat: Math.floor(Date.now() / 1000) + 3600 }),
  "nonce mismatch": (g) => (g.claims = { nonce: "attacker-nonce" }),
  "email_verified false": (g) => (g.claims = { email_verified: false }),
  "email_verified missing": (g) => (g.claims = { email_verified: undefined }),
  "unknown kid": (g) => (g.header = { kid: "kid-other" }),
  "alg none": (g) => {
    const h = b64url(JSON.stringify({ alg: "none", kid: g.kid }));
    const c = b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1", email: "x@gmail.com", email_verified: true }));
    g.rawIdToken = `${h}.${c}.`;
  },
  "HS256 confusion": (g) => (g.header = { alg: "HS256" }),
};

for (const [name, mutate] of Object.entries(BAD_TOKENS)) {
  test(`id_token rejected: ${name}`, async () => {
    const ctx = liveEnv();
    mutate(google);
    const r = await signIn(ctx);
    refused(r.cb);
    assert.equal(await ctx.db.one("SELECT * FROM users WHERE email=?", ["grower@gmail.com"]), null);
  });
}

test("JWKS is fetched once and cached across logins", async () => {
  const ctx = liveEnv();
  assert.equal((await signIn(ctx)).done.status, 200);
  assert.equal((await signIn(ctx)).done.status, 200);
  assert.equal(google.jwksFetches, 1);
});

test("Google sign-up with grower@gmail.com and a name hint gets a random public handle", async () => {
  const ctx = liveEnv();
  google.claims = { name: "Ada Lovelace", given_name: "Ada", family_name: "Lovelace" };
  const r = await signIn(ctx);
  assert.equal(r.done.status, 200, JSON.stringify(r.done.data));
  const row = await ctx.db.one("SELECT * FROM users WHERE email=?", ["grower@gmail.com"]);
  assertPublicHandle(row, r.done.data.user);
  assert.doesNotMatch(row.username, /ada|lovelace|grower@/i);
  assert.doesNotMatch(JSON.stringify(r.done.data), /Ada|Lovelace/i);
});

test("Google sign-up does not put the email local part or name on public API, pages, sitemap, or llms.txt", async () => {
  const ctx = liveEnv();
  google.claims = { name: "Ada Lovelace", given_name: "Ada", family_name: "Lovelace" };
  const r = await signIn(ctx);
  assert.equal(r.done.status, 200);
  const row = await ctx.db.one("SELECT * FROM users WHERE email=?", ["grower@gmail.com"]);
  assertPublicHandle(row, r.done.data.user);
  const extra = ["Ada", "Lovelace"];
  const leak = (value, label) => assertNoPublicPii(value, "grower@gmail.com", extra, label);

  const token = r.done.data.access_token;
  const created = await call(ctx, "POST", "/api/profiles", {
    token,
    body: { ...SAMPLE_CULINARY_PROFILE, id: "google-privacy-oyster" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.author, row.username);
  leak(created.data, "publish");

  const shown = await call(ctx, "GET", "/api/profiles/google-privacy-oyster");
  assert.equal(shown.status, 200);
  assert.equal(shown.data.profile.author, row.username);
  leak(shown.data, "profile GET");

  const rated = await call(ctx, "POST", "/api/profiles/google-privacy-oyster/rate", {
    token,
    body: { stars: 5, comment: "worked" },
  });
  assert.equal(rated.status, 200);
  const afterRate = await call(ctx, "GET", "/api/profiles/google-privacy-oyster");
  leak(afterRate.data, "ratings");
  assert.ok(afterRate.data.ratings.some((item) => item.username === row.username));
  assert.ok(!afterRate.data.ratings.some((item) => item.display_name));

  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  const card = list.data.find((item) => item.id === "google-privacy-oyster");
  assert.ok(card);
  leak(card, "profile list card");
  leak((await call(ctx, "GET", "/api/search?pack=culinary&q=Privacy")).data, "search");
  leak((await call(ctx, "GET", "/api/profiles/google-privacy-oyster.json")).data, "profile.json export");

  const hub = await call(ctx, "GET", "/api/hub/pull", { token });
  assert.equal(hub.status, 200);
  assert.equal(hub.data.hub_user, row.username);
  const hubProfile = hub.data.profiles.find((item) => item.id === "google-privacy-oyster");
  assert.equal(hubProfile.author, row.username);
  leak(hubProfile, "hub profile");
  leak({ hub_user: hub.data.hub_user }, "hub user");

  const passkey = await call(ctx, "POST", "/api/auth/webauthn/register/begin", { token, body: {} });
  assert.equal(passkey.status, 200);
  assert.equal(passkey.data.user.displayName, row.username);
  assert.doesNotMatch(JSON.stringify(passkey.data), /Ada|Lovelace/i);

  const published = { ...created.data, author: row.username };
  leak(renderSitemap([published]), "sitemap");
  leak(renderLlms([published]), "llms.txt");
  leak(renderProfilePage(published), "profile page");
});

test("linking: a repeat Google login reuses the account; an existing verified email account is linked", async () => {
  const ctx = liveEnv();
  google.claims = { email: "magic@example.com" };
  await ctx.db.run(
    "INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["magic", null, "magic@example.com", 1, "magic", "user", new Date().toISOString()]
  );
  const existing = { user: await ctx.db.one("SELECT * FROM users WHERE email=?", ["magic@example.com"]) };
  const first = await signIn(ctx);
  assert.equal(first.done.status, 200);
  assert.equal(first.done.data.user.id, existing.user.id);
  const second = await signIn(ctx);
  assert.equal(second.done.status, 200);
  assert.equal(second.done.data.user.id, existing.user.id);
  const links = await ctx.db.all("SELECT * FROM auth_identities WHERE user_id=? AND provider=?", [existing.user.id, "google"]);
  assert.equal(links.length, 1);
});

test("linking: an unverified account with the same email is never taken over", async () => {
  const ctx = liveEnv();
  await ctx.db.run(
    "INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["squatter", "x", "victim@gmail.com", 0, "squatter", "user", new Date().toISOString()]
  );
  google.claims = { email: "victim@gmail.com" };
  const r = await signIn(ctx);
  refused(r.cb);
});

test("linking: an account already linked to another Google subject is not re-linked by email", async () => {
  const ctx = liveEnv();
  assert.equal((await signIn(ctx)).done.status, 200);
  google.claims = { sub: "2200000000002" };
  refused((await signIn(ctx)).cb);
});

test("redirect after login stays on our site: next must be a same-site path", async () => {
  const ctx = liveEnv();
  for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil"]) {
    const s = await start(ctx, `?next=${encodeURIComponent(bad)}`);
    assert.equal(s.res.status, 400, bad);
    assert.equal(s.res.headers.get("set-cookie"), null);
  }
  const ok = await signIn(ctx, `?next=${encodeURIComponent("/device.html?id=7")}`);
  assert.ok(ok.loc.startsWith(`${SITE}/auth/callback.html#`));
  assert.equal(ok.frag.get("next"), "/device.html?id=7");
  assert.equal(safeNextPath("/a"), "/a");
  assert.equal(safeNextPath("//a"), null);
});

test("rate limits: start and callback", async () => {
  const ctx = liveEnv();
  for (let i = 0; i < 10; i += 1) assert.equal((await start(ctx)).res.status, 302);
  assert.equal((await start(ctx)).res.status, 429);
  const ctx2 = liveEnv();
  const s = await start(ctx2);
  for (let i = 0; i < 20; i += 1) refused(await callback(ctx2, { state: "x", cookie: "__Host-sl_oidc=y" }));
  const row = await ctx2.db.one("SELECT * FROM oauth_states WHERE state=?", [s.state]);
  google.pendingNonce = row.nonce;
  refused(await callback(ctx2, { state: s.state, cookie: s.cookie }));
  assert.equal(google.tokenCalls.length, 0);
});

test("Google shows as configured only with both client ID and secret", () => {
  assert.equal(capabilities({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "s" }).google, true);
  assert.equal(capabilities({ GOOGLE_CLIENT_ID: CLIENT_ID }).google, false);
  assert.equal(capabilities({}).google, false);
});

test("verifyIdToken accepts the bare accounts.google.com issuer and a string email_verified", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(google.good.privateKey, { alg: "RS256", kid: google.kid }, {
    iss: "accounts.google.com",
    aud: CLIENT_ID,
    sub: "1",
    email: "a@gmail.com",
    email_verified: "true",
    iat: now,
    exp: now + 60,
    nonce: "n1",
  });
  const out = await verifyIdToken(token, { provider: "google", clientId: CLIENT_ID, nonce: "n1" });
  assert.equal(out.ok, true, out.reason);
});
