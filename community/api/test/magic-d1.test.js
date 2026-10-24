import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import {
  SAMPLE_CULINARY_PROFILE,
  assertNoPublicPii,
  assertPublicHandle,
  call,
  testEnv,
} from "./helpers.js";
import { renderLlms, renderProfilePage, renderSitemap } from "../../web/scripts/generate-seo.js";
import { sha256Hex } from "../src/crypto.js";

// schema.sql must match production, where users.password_hash is NOT NULL.
function prodSchema() {
  const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  assert.match(sql, /password_hash TEXT NOT NULL/, "schema.sql drifted from production users.password_hash");
  return sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
}

async function withProdD1(fn) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
  try {
    const d1 = await mf.getD1Database("DB");
    for (const s of prodSchema()) await d1.prepare(s).run();
    await fn(d1, testEnv({ db: createD1Db(d1) }));
  } finally {
    await mf.dispose();
  }
}

// Dev stubs (Turnstile, debug tokens) are off on D1 by design, so seed the link the way magic/start stores it.
async function start(d1, email, expiresAt = new Date(Date.now() + 15 * 60000).toISOString().replace(/\.\d+Z$/, "Z")) {
  const token = `tok-${email}`;
  await d1.prepare("INSERT INTO magic_links (email, token_hash, purpose, expires_at, created_at) VALUES (?, ?, 'login', ?, ?)")
    .bind(email, await sha256Hex(token), expiresAt, "2026-01-01T00:00:00Z").run();
  return token;
}
const complete = (ctx, token) => call(ctx, "POST", "/api/auth/magic/complete", { body: { token } });

test("magic link creates a new account on the production schema, once", async () => {
  await withProdD1(async (d1, ctx) => {
    const tok = await start(d1, "new@example.com");
    const done = await complete(ctx, tok);
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal(done.data.user.email, "new@example.com");
    const created = await d1.prepare("SELECT username, display_name FROM users WHERE email=?").bind("new@example.com").first();
    assertPublicHandle(created, done.data.user);
    assert.equal((await complete(ctx, tok)).status, 401);
    const login = await call(ctx, "POST", "/api/auth/login", { body: { email: "new@example.com", password: "!no-password" } });
    assert.equal(login.status, 401, "the no-password marker must never work as a password");
  });
});

test("concurrent use of one magic link signs in exactly once", async () => {
  await withProdD1(async (d1, ctx) => {
    const tok = await start(d1, "race@example.com");
    const results = await Promise.all([1, 2, 3].map(() => complete(ctx, tok)));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401, 401]);
  });
});

test("magic link sign-up with grower@gmail.com gets a random public handle", async () => {
  await withProdD1(async (d1, ctx) => {
    const tok = await start(d1, "grower@gmail.com");
    const done = await complete(ctx, tok);
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const row = await d1.prepare("SELECT username, display_name FROM users WHERE email=?").bind("grower@gmail.com").first();
    assertPublicHandle(row, done.data.user);
    assert.doesNotMatch(row.username, /grower@/i);

    const created = await call(ctx, "POST", "/api/profiles", {
      token: done.data.access_token,
      body: { ...SAMPLE_CULINARY_PROFILE, id: "magic-privacy-oyster" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.author, row.username);
    const leak = (value, label) => assertNoPublicPii(value, "grower@gmail.com", [], label);
    leak(created.data, "publish");
    leak((await call(ctx, "GET", "/api/profiles/magic-privacy-oyster")).data, "profile GET");
    const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
    leak(list.data.find((item) => item.id === "magic-privacy-oyster"), "profile list card");
    leak((await call(ctx, "GET", "/api/search?pack=culinary&q=Privacy")).data, "search");
    leak(renderSitemap([created.data]), "sitemap");
    leak(renderLlms([created.data]), "llms.txt");
    leak(renderProfilePage(created.data), "profile page");
  });
});

test("an expired magic link is refused and not consumed", async () => {
  await withProdD1(async (d1, ctx) => {
    const tok = await start(d1, "late@example.com", "2000-01-01T00:00:00Z");
    assert.equal((await complete(ctx, tok)).status, 401);
    assert.equal((await d1.prepare("SELECT used_at FROM magic_links").first()).used_at, null);
    assert.equal((await d1.prepare("SELECT COUNT(*) n FROM users").first()).n, 0);
  });
});
