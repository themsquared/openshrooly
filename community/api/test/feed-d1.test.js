import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { FEED_SQL } from "../src/feed-sql.js";
import { sha256Hex } from "../src/crypto.js";
import { call, testEnv } from "./helpers.js";
import { buildJpeg, toBase64 } from "./image-fixtures.js";

const statements = (sql) => sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
const MIGRATION = readFileSync(new URL("../migrations/0012_grow_posts.sql", import.meta.url), "utf8");
// Production before 0012: schema.sql without the feed tables.
const BEFORE = statements(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")).filter((s) => !s.includes("grow_post"));
const pearl = { ...JSON.parse(readFileSync(new URL("../../../data/profiles/culinary/pearl-oyster.json", import.meta.url), "utf8")), id: "feed-oyster" };

async function withD1(fn) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
  try {
    const d1 = await mf.getD1Database("DB");
    for (const s of BEFORE) await d1.prepare(s).run();
    await fn(d1);
  } finally {
    await mf.dispose();
  }
}

async function signIn(d1, ctx, email) {
  const token = `tok-${email}`;
  await d1
    .prepare("INSERT INTO magic_links (email, token_hash, purpose, expires_at, created_at) VALUES (?, ?, 'login', ?, ?)")
    .bind(email, await sha256Hex(token), new Date(Date.now() + 15 * 60000).toISOString().replace(/\.\d+Z$/, "Z"), "2026-01-01T00:00:00Z")
    .run();
  const done = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  return { token: done.data.access_token, user: done.data.user };
}

test("0012 is additive, runs twice, and leaves existing rows alone", async () => {
  const body = statements(MIGRATION);
  assert.ok(body.every((s) => /^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/.test(s)), "only CREATE ... IF NOT EXISTS");
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, "").replace(/ON DELETE (CASCADE|SET NULL)/g, ""), /\b(DROP|DELETE|UPDATE|INSERT|REPLACE|ALTER)\b/i);
  await withD1(async (d1) => {
    await d1.prepare("INSERT INTO users (id, username, password_hash, email, created_at) VALUES (7, 'grower_a', 'x', 'a@example.com', '2026-01-01')").run();
    for (const s of body) await d1.prepare(s).run();
    for (const s of body) await d1.prepare(s).run();
    const user = await d1.prepare("SELECT username FROM users WHERE id=7").first();
    assert.equal(user.username, "grower_a");
    const tables = await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'grow_post%' ORDER BY name").all();
    assert.deepEqual(tables.results.map((r) => r.name), ["grow_post_reports", "grow_posts"]);
  });
});

test("the feed runs end to end on real D1 after 0012", async () => {
  await withD1(async (d1) => {
    for (const s of statements(MIGRATION)) await d1.prepare(s).run();
    const db = createD1Db(d1);
    const seen = new Set();
    const wrap = (fn) => async (sql, params) => {
      seen.add(sql);
      return fn(sql, params);
    };
    const ctx = testEnv({ db: { ...db, all: wrap(db.all), one: wrap(db.one), run: wrap(db.run) } });
    const owner = await signIn(d1, ctx, "owner@example.com");
    await d1
      .prepare("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind(pearl.id, JSON.stringify(pearl), owner.user.id, "2026-01-01", "2026-01-01")
      .run();
    const made = await call(ctx, "POST", "/api/feed", {
      token: owner.token,
      body: { profile_id: pearl.id, photo_base64: toBase64(buildJpeg({ width: 40, height: 30 })), note: "first flush", grow_day: 12 },
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const id = made.data.post.id;
    assert.equal((await call(ctx, "GET", "/api/feed")).data.posts.length, 1);
    assert.equal((await call(ctx, "GET", `/api/feed?profile_id=${pearl.id}`)).data.posts.length, 1);
    const reporter = await signIn(d1, ctx, "reporter@example.com");
    assert.equal((await call(ctx, "POST", `/api/feed/${id}/report`, { token: reporter.token, body: { reason: "spam" } })).status, 200);
    assert.equal((await call(ctx, "POST", `/api/feed/${id}/report`, { token: reporter.token, body: { reason: "spam" } })).status, 200);
    const counted = await d1.prepare("SELECT report_count FROM grow_posts WHERE id=?").bind(id).first();
    assert.equal(counted.report_count, 1);
    const mod = await signIn(d1, ctx, "mod@example.com");
    await d1.prepare("UPDATE users SET role='moderator' WHERE id=?").bind(mod.user.id).run();
    assert.equal((await call(ctx, "GET", "/api/feed/moderation", { token: mod.token })).data.posts.length, 1);
    assert.equal((await call(ctx, "POST", `/api/feed/${id}/moderate`, { token: mod.token, body: { action: "hide" } })).data.status, "hidden");
    assert.equal((await call(ctx, "POST", `/api/feed/${id}/moderate`, { token: mod.token, body: { action: "restore" } })).data.status, "visible");

    // A profile that becomes off-menu after posting drops out of every list.
    await d1.prepare("UPDATE profiles SET document=? WHERE id=?").bind(JSON.stringify({ ...pearl, pack: "psilocybin", tags: ["psilocybin"] }), pearl.id).run();
    assert.equal((await call(ctx, "GET", "/api/feed")).data.posts.length, 0);
    assert.equal((await call(ctx, "GET", `/api/feed?profile_id=${pearl.id}`)).data.posts.length, 0);
    await d1.prepare("UPDATE profiles SET document=? WHERE id=?").bind(JSON.stringify(pearl), pearl.id).run();

    assert.equal((await call(ctx, "POST", `/api/feed/${id}/moderate`, { token: mod.token, body: { action: "remove" } })).data.status, "removed");
    const log = await d1.prepare("SELECT action FROM moderation_log WHERE profile_id=? ORDER BY id").bind(pearl.id).all();
    assert.deepEqual(log.results.map((r) => r.action), ["post_report", "post_hide", "post_restore", "post_remove"]);
    for (const [name, sql] of Object.entries(FEED_SQL)) assert.ok(seen.has(sql), `${name} ran on D1`);
  });
});
