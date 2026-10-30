import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryDb } from "../src/db.js";
import { handleRequest } from "../src/handlers.js";
import { createMemoryStorage } from "../src/storage.js";
import { createOptionalStorage } from "../src/storage.js";
import { GUIDE_SEED, seedMissing, seedSql, sqlQuote } from "../src/seed.js";
import seeds from "../src/seeds.json" with { type: "json" };

test("seed SQL is insert-if-missing for every profile and the guide stub", () => {
  const sql = seedSql(seeds, "2026-10-24T00:00:00Z");
  assert.match(sql, /INSERT OR IGNORE INTO profiles/);
  assert.match(sql, /INSERT OR IGNORE INTO guides/);
  assert.match(sql, /block-prep-101/);
  assert.equal(seeds.length, 44);
  for (const profile of seeds) {
    assert.match(sql, new RegExp(sqlQuote(profile.id)));
  }
});

test("seedMissing uses one batch and does not SELECT each profile afterward", async () => {
  const calls = [];
  const db = {
    async batch(statements) {
      calls.push(["batch", statements.length]);
    },
    async one() {
      calls.push(["one"]);
      return null;
    },
    async run() {
      calls.push(["run"]);
    },
  };
  await seedMissing(db, [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(calls, [["batch", 3]]);
});

test("concurrent first requests share one catalog seed", async () => {
  const ctx = {
    db: createMemoryDb(),
    storage: createMemoryStorage(),
    CORS_ORIGIN: "http://127.0.0.1:8888",
    SHOW_PSILOCYBIN: "1",
    SITE_NAME: "test",
    AUTH_DEBUG: "1",
    HIBP_DISABLED: "1",
    SITE_ORIGIN: "http://127.0.0.1:8888",
    OIDC_STUB: "1",
  };
  const [a, b] = await Promise.all([
    handleRequest(new Request("http://test/api/profiles?pack=culinary"), ctx),
    handleRequest(new Request("http://test/api/profiles?pack=culinary"), ctx),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(ctx._seeded, true);
});

test("seedMissing fills a partial catalog and does not overwrite existing rows", async () => {
  const db = createMemoryDb();
  const first = seeds[0];
  await db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    [first.id, JSON.stringify({ id: first.id, name: "keep-me" }), null, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]
  );
  for (const profile of seeds.slice(1, 10)) {
    await db.run(
      "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      [profile.id, JSON.stringify(profile), null, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]
    );
  }
  const before = await db.all("SELECT * FROM profiles WHERE published=1");
  assert.equal(before.length, 10);

  await seedMissing(db, seeds);
  const after = await db.all("SELECT document FROM profiles WHERE published=1");
  assert.equal(after.length, 44);
  const kept = after.find((row) => JSON.parse(row.document).id === first.id);
  assert.equal(JSON.parse(kept.document).name, "keep-me");
  const guide = await db.one("SELECT * FROM guides WHERE id=?", [GUIDE_SEED.id]);
  assert.equal(guide?.title, GUIDE_SEED.title);

  await seedMissing(db, seeds);
  const again = await db.all("SELECT document FROM profiles WHERE published=1");
  assert.equal(again.length, 44);
});

test("first request still exposes the full culinary catalog from memory", async () => {
  const ctx = {
    db: createMemoryDb(),
    storage: createMemoryStorage(),
    CORS_ORIGIN: "http://127.0.0.1:8888",
    SHOW_PSILOCYBIN: "1",
    SITE_NAME: "test",
    AUTH_DEBUG: "1",
    HIBP_DISABLED: "1",
    SITE_ORIGIN: "http://127.0.0.1:8888",
    OIDC_STUB: "1",
  };
  const request = new Request("http://test/api/profiles?pack=culinary");
  const res = await handleRequest(request, ctx);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.length >= 20, `expected full culinary seed, got ${data.length}`);
  assert.ok(data.some((p) => p.id === "pearl-oyster"));
  const guide = await ctx.db.one("SELECT * FROM guides WHERE id=?", ["block-prep-101"]);
  assert.ok(guide);
});

test("seed profile text has no en or em dashes", () => {
  const dash = /[\u2013\u2014]/;
  const hits = [];
  for (const profile of seeds) {
    if (dash.test(JSON.stringify(profile))) hits.push(profile.id);
  }
  assert.deepEqual(hits, []);
});

test("optional storage survives a missing or throwing R2 binding", async () => {
  const none = createOptionalStorage(null);
  assert.equal(none.driver, "disabled");
  assert.equal(await none.put("x", new Uint8Array([1]), "image/jpeg"), null);
  assert.equal(await none.get("x"), null);

  const memory = createOptionalStorage(null, { allowMemory: true });
  assert.equal(memory.driver, "memory");
  await memory.put("x", new Uint8Array([1]), "image/jpeg");
  assert.ok(await memory.get("x"));

  const broken = createOptionalStorage({
    async put() {
      throw new Error("R2 not enabled");
    },
    async get() {
      throw new Error("R2 not enabled");
    },
  });
  assert.equal(await broken.put("y", new Uint8Array([2]), "image/jpeg"), null);
  assert.equal(await broken.get("y"), null);
});
