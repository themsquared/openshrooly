// Apple sign-in against real SQLite / miniflare D1 with the production NOT NULL users.password_hash.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { resetAppleSecretCache, resetJwksCache } from "../src/oidc.js";
import { call, testEnv } from "./helpers.js";
import { RELAY_EMAIL, SITE, appleEnv, fakeApple, realFetch } from "./fake-apple.js";

let apple;

function schema() {
  if (process.env.PROD_SCHEMA_FILE) {
    return readFileSync(process.env.PROD_SCHEMA_FILE, "utf8").split(";\n").map((s) => s.trim()).filter(Boolean);
  }
  const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
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
      SITE_ORIGIN: SITE,
      ...appleEnv(apple.p8),
    });
    await fn(d1, ctx);
  } finally {
    await mf.dispose();
  }
}

async function signIn(d1, ctx, { user, extraForm } = {}) {
  const start = await call(ctx, "GET", "/api/auth/oidc/apple/start");
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  apple.pendingNonce = (await d1.prepare("SELECT nonce FROM oauth_states WHERE state=?").bind(state).first()).nonce;
  const form = { state, code: "c", ...extraForm };
  if (user !== undefined) form.user = user;
  const cb = await call(ctx, "POST", "/api/auth/oidc/apple/callback", {
    form,
    headers: { cookie, origin: "https://appleid.apple.com" },
  });
  const loc = cb.headers.get("location");
  const handoff = loc ? new URLSearchParams(loc.split("#")[1] || "").get("oidc") : null;
  const done = handoff ? await call(ctx, "POST", "/api/auth/oidc/complete", { body: { token: handoff } }) : null;
  return { state, cookie, cb, loc, handoff, done };
}

beforeEach(async () => {
  resetJwksCache();
  resetAppleSecretCache();
  apple = await fakeApple();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("D1: Apple sign-up creates a verified Hide My Email account, stores the first-sign-in name, repeat login reuses it", async () => {
  await withD1(async (d1, ctx) => {
    const first = await signIn(d1, ctx, {
      user: JSON.stringify({ name: { firstName: "Jane", lastName: "Appleseed" }, email: RELAY_EMAIL }),
    });
    assert.ok(first.loc.startsWith(`${SITE}/auth/callback.html#oidc=`), first.loc);
    assert.equal(first.done.status, 200, JSON.stringify(first.done.data));
    assert.equal(first.done.data.user.email, RELAY_EMAIL);
    assert.equal(first.done.data.user.email_verified, true);
    const row = await d1.prepare("SELECT password_hash, display_name FROM users WHERE email=?").bind(RELAY_EMAIL).first();
    assert.equal(row.password_hash, "!no-password");
    assert.equal(row.display_name, "Jane Appleseed");
    const login = await call(ctx, "POST", "/api/auth/login", { body: { email: RELAY_EMAIL, password: "!no-password" } });
    assert.equal(login.status, 401);
    const again = await signIn(d1, ctx);
    assert.equal(again.done.status, 200);
    assert.equal(again.done.data.user.id, first.done.data.user.id);
    assert.equal((await d1.prepare("SELECT COUNT(*) n FROM auth_identities").first()).n, 1);
    assert.equal((await d1.prepare("SELECT COUNT(*) n FROM users").first()).n, 1);
  });
});

test("D1: missing state, replayed callback/nonce, and a foreign Origin are refused", async () => {
  await withD1(async (d1, ctx) => {
    const r = await signIn(d1, ctx);
    assert.equal(r.done.status, 200);
    const replay = await call(ctx, "POST", "/api/auth/oidc/apple/callback", {
      form: { state: r.state, code: "c" },
      headers: { cookie: r.cookie, origin: "https://appleid.apple.com" },
    });
    assert.equal(replay.headers.get("location"), `${SITE}/login.html?error=oidc`);
    const missing = await call(ctx, "POST", "/api/auth/oidc/apple/callback", {
      form: { code: "c" },
      headers: { cookie: r.cookie, origin: "https://appleid.apple.com" },
    });
    assert.equal(missing.headers.get("location"), `${SITE}/login.html?error=oidc`);
    const start = await call(ctx, "GET", "/api/auth/oidc/apple/start");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const foreign = await call(ctx, "POST", "/api/auth/oidc/apple/callback", {
      form: { state, code: "c" },
      headers: { cookie, origin: "https://evil.example" },
    });
    assert.equal(foreign.status, 403);
    assert.equal(apple.tokenCalls.length, 1);
  });
});

const D1_BAD = {
  "bad signature": (a) => (a.signer = a.rogue.privateKey),
  "wrong aud": (a) => (a.claims = { aud: "com.evil.web" }),
  expired: (a) => (a.claims = { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }),
  "replayed nonce": (a) => (a.claims = { nonce: "old-nonce" }),
};

for (const [name, mutate] of Object.entries(D1_BAD)) {
  test(`D1: id_token rejected (${name})`, async () => {
    await withD1(async (d1, ctx) => {
      mutate(apple);
      const r = await signIn(d1, ctx);
      assert.equal(r.cb.headers.get("location"), `${SITE}/login.html?error=oidc`);
      assert.equal((await d1.prepare("SELECT COUNT(*) n FROM users").first()).n, 0);
    });
  });
}

test("D1: unverified account with the same email is not taken over", async () => {
  await withD1(async (d1, ctx) => {
    const now = new Date().toISOString();
    await d1
      .prepare(
        "INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES ('squat', '!no-password', ?, 0, 's', 'user', ?)"
      )
      .bind(RELAY_EMAIL, now)
      .run();
    const refused = await signIn(d1, ctx);
    assert.equal(refused.cb.headers.get("location"), `${SITE}/login.html?error=oidc`);
    assert.equal((await d1.prepare("SELECT COUNT(*) n FROM auth_identities").first()).n, 0);
    assert.equal((await d1.prepare("SELECT email_verified n FROM users WHERE email=?").bind(RELAY_EMAIL).first()).n, 0);
  });
});
