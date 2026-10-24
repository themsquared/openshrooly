// Google sign-in against real SQLite with the production NOT NULL users.password_hash (see magic-d1.test.js).
// Set PROD_SCHEMA_FILE to a dump of the live D1 schema to run the same checks against it.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { resetJwksCache } from "../src/oidc.js";
import { call, testEnv } from "./helpers.js";
import { CLIENT_ID, SITE, fakeGoogle, realFetch } from "./fake-google.js";

let google;

function schema() {
  if (process.env.PROD_SCHEMA_FILE) {
    return readFileSync(process.env.PROD_SCHEMA_FILE, "utf8").split(";\n").map((s) => s.trim()).filter(Boolean);
  }
  const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  // Production has users.password_hash NOT NULL; schema.sql must keep matching it or this test proves nothing.
  assert.match(sql, /password_hash TEXT NOT NULL/, "schema.sql users.password_hash must be NOT NULL like production");
  return sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
}

async function withD1(fn) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
  try {
    const d1 = await mf.getD1Database("DB");
    for (const s of schema()) await d1.prepare(s).run();
    const ctx = testEnv({
      db: createD1Db(d1),
      DEV_STUBS: "",
      OIDC_STUB: "",
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: "test-secret-value",
      SITE_ORIGIN: SITE,
    });
    await fn(d1, ctx);
  } finally {
    await mf.dispose();
  }
}

async function signIn(d1, ctx) {
  const start = await call(ctx, "GET", "/api/auth/oidc/google/start");
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  google.pendingNonce = (await d1.prepare("SELECT nonce FROM oauth_states WHERE state=?").bind(state).first()).nonce;
  const cb = await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${state}&code=c`, { headers: { cookie } });
  const loc = cb.headers.get("location");
  const handoff = new URLSearchParams(loc.split("#")[1] || "").get("oidc");
  const done = handoff ? await call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: handoff } }) : null;
  return { state, cookie, cb, loc, handoff, done };
}

beforeEach(async () => {
  resetJwksCache();
  google = await fakeGoogle();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("D1: Google sign-up creates a verified account, repeat login reuses it", async () => {
  await withD1(async (d1, ctx) => {
    const first = await signIn(d1, ctx);
    assert.ok(first.loc.startsWith(`${SITE}/auth/callback.html#oidc=`), first.loc);
    assert.equal(first.done.status, 200, JSON.stringify(first.done.data));
    assert.equal(first.done.data.user.email, "grower@gmail.com");
    assert.equal(first.done.data.user.email_verified, true);
    const row = await d1.prepare("SELECT password_hash FROM users WHERE email=?").bind("grower@gmail.com").first();
    assert.equal(row.password_hash, "!no-password");
    const login = await call(ctx, "POST", "/api/auth/login", { body: { email: "grower@gmail.com", password: "!no-password" } });
    assert.equal(login.status, 401);
    const again = await signIn(d1, ctx);
    assert.equal(again.done.status, 200);
    assert.equal(again.done.data.user.id, first.done.data.user.id);
    assert.equal((await d1.prepare("SELECT COUNT(*) n FROM auth_identities").first()).n, 1);
    assert.equal((await d1.prepare("SELECT COUNT(*) n FROM users").first()).n, 1);
  });
});

test("D1: state and handoff are single use; a handoff is not a magic link", async () => {
  await withD1(async (d1, ctx) => {
    const r = await signIn(d1, ctx);
    assert.equal(r.done.status, 200);
    const replay = await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${r.state}&code=c`, { headers: { cookie: r.cookie } });
    assert.equal(replay.headers.get("location"), `${SITE}/login.html?error=oidc`);
    assert.equal((await call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: r.handoff } })).status, 401);
    assert.equal((await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: r.handoff } })).status, 401);
    assert.equal(google.tokenCalls.length, 1);
  });
});

test("D1: concurrent handoff use signs in exactly once", async () => {
  await withD1(async (d1, ctx) => {
    const start = await call(ctx, "GET", "/api/auth/oidc/google/start");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const cookie = start.headers.get("set-cookie").split(";")[0];
    google.pendingNonce = (await d1.prepare("SELECT nonce FROM oauth_states WHERE state=?").bind(state).first()).nonce;
    const cb = await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${state}&code=c`, { headers: { cookie } });
    const handoff = new URLSearchParams(cb.headers.get("location").split("#")[1]).get("oidc");
    const results = await Promise.all([1, 2, 3].map(() => call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: handoff } })));
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 401, 401]);
  });
});

test("D1: verified account is linked, unverified account is not taken over", async () => {
  await withD1(async (d1, ctx) => {
    const now = new Date().toISOString();
    await d1.prepare("INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES ('v', '!no-password', 'grower@gmail.com', 1, 'v', 'user', ?)").bind(now).run();
    const linked = await signIn(d1, ctx);
    assert.equal(linked.done.status, 200);
    assert.equal(linked.done.data.user.username, "v");
    google.claims = { sub: "999", email: "victim@gmail.com" };
    await d1.prepare("INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES ('squat', '!no-password', 'victim@gmail.com', 0, 's', 'user', ?)").bind(now).run();
    const refused = await signIn(d1, ctx);
    assert.equal(refused.cb.headers.get("location"), `${SITE}/login.html?error=oidc`);
    assert.equal((await d1.prepare("SELECT COUNT(*) n FROM auth_identities WHERE subject='999'").first()).n, 0);
  });
});
