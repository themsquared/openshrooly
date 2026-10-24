import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const root = new URL("../", import.meta.url);
const SCHEMA = readFileSync(new URL("schema.sql", root), "utf8");
const MIG_0004 = readFileSync(new URL("migrations/0004_grow_report_photo_status.sql", root), "utf8");
const MIG_0005 = readFileSync(new URL("migrations/0005_uploaded_media.sql", root), "utf8");
const MIG_0006 = readFileSync(new URL("migrations/0006_profile_review.sql", root), "utf8");

function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function apply(d1, sql) {
  for (const s of statements(sql)) await d1.prepare(s).run();
}

function pre42Schema() {
  return `
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
);
CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE grow_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    outcome TEXT NOT NULL,
    notes TEXT DEFAULT '',
    days REAL,
    flushes INTEGER,
    device_name TEXT,
    photo_key TEXT,
    created_at TEXT NOT NULL
);
`;
}

function culinaryDoc(species) {
  return JSON.stringify({
    schema_version: 1,
    id: "x",
    name: species,
    species,
    pack: "culinary",
    restricted: false,
    tags: ["culinary"],
    pricing: { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 },
    stages: [{ id: "fruiting", name: "Fruiting", duration_days: 7, humidity_percent: 90, temperature_c: 18 }],
  });
}

async function withDb(fn) {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  try {
    await fn(await mf.getD1Database("DB"));
  } finally {
    await mf.dispose();
  }
}

test("0006 applies on a DB that already has #42 0004 and 0005", async () => {
  await withDb(async (d1) => {
    await apply(d1, pre42Schema());
    await apply(d1, MIG_0004);
    await apply(d1, MIG_0005);
    await d1.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'grower', 'x', '2024-01-01')").run();
    for (const [id, species] of [
      ["lg-psp", "Psilocybe sp."],
      ["lg-agcub", "Agaricus cubensis"],
      ["lg-amuscaria", "Amanita muscaria"],
      ["lg-oyster", "Pleurotus ostreatus"],
    ]) {
      await d1
        .prepare("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, 1, 1, '2024-01-01', '2024-01-01')")
        .bind(id, culinaryDoc(species))
        .run();
    }
    await d1.prepare("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES ('bad-json', '{nope', 1, 1, '2024-01-01', '2024-01-01')").run();
    await apply(d1, MIG_0006);
    const cols = await d1.prepare("PRAGMA table_info(grow_reports)").all();
    assert.ok(cols.results.some((c) => c.name === "photo_status"));
    const media = await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='uploaded_media'").first();
    assert.ok(media);
    const reviewCols = await d1.prepare("PRAGMA table_info(profile_review)").all();
    assert.ok(reviewCols.results.some((c) => c.name === "confirmed_culinary_at"));
    assert.ok(reviewCols.results.some((c) => c.name === "confirmed_by"));
    for (const id of ["lg-psp", "lg-agcub", "lg-amuscaria"]) {
      const row = await d1.prepare("SELECT document FROM profiles WHERE id=?").bind(id).first();
      const doc = JSON.parse(row.document);
      assert.equal(doc.pack, "psilocybin", id);
      const review = await d1.prepare("SELECT * FROM profile_review WHERE profile_id=?").bind(id).first();
      assert.equal(review.confirmed_culinary_at, null, id);
      const live = JSON.parse(review.live_document);
      assert.equal(live.pack, "psilocybin", `${id} live`);
    }
    const oyster = JSON.parse((await d1.prepare("SELECT document FROM profiles WHERE id='lg-oyster'").first()).document);
    assert.equal(oyster.pack, "culinary");
    const bad = await d1.prepare("SELECT document FROM profiles WHERE id='bad-json'").first();
    assert.equal(bad.document, "{nope");
    const ignored = await d1.prepare("SELECT profile_id FROM profile_review WHERE profile_id='bad-json'").first();
    assert.equal(ignored, null);
  });
});

test("0006 rerun does not copy a pending draft into live_document", async () => {
  await withDb(async (d1) => {
    await apply(d1, SCHEMA);
    await d1.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'grower', 'x', '2024-01-01')").run();
    const live = culinaryDoc("Pleurotus ostreatus");
    const liveObj = JSON.parse(live);
    liveObj.id = "pending-oyster";
    await d1
      .prepare("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, 1, 1, '2024-01-01', '2024-01-01')")
      .bind("pending-oyster", JSON.stringify(liveObj))
      .run();
    await apply(d1, MIG_0006);
    const draft = { ...liveObj, name: "Draft sneak", species: "Psilocybe cubensis", pack: "psilocybin", restricted: true };
    await d1
      .prepare(
        "INSERT INTO profile_review (profile_id, status, reason, title, description, live_document, blocklist_hit, offmenu_flag, published_live, created_at, updated_at) VALUES ('pending-oyster', 'pending', '', 'Draft', 'edit', ?, 0, 0, 1, '2024-01-01', '2024-01-01') ON CONFLICT(profile_id) DO UPDATE SET status='pending', live_document=excluded.live_document, published_live=1"
      )
      .bind(JSON.stringify(liveObj))
      .run();
    await d1.prepare("UPDATE profiles SET document=? WHERE id='pending-oyster'").bind(JSON.stringify(draft)).run();
    await apply(d1, MIG_0006);
    const review = await d1.prepare("SELECT * FROM profile_review WHERE profile_id='pending-oyster'").first();
    assert.equal(review.status, "pending");
    const storedLive = JSON.parse(review.live_document);
    assert.equal(storedLive.species, "Pleurotus ostreatus");
    assert.equal(storedLive.pack, "culinary");
    assert.notEqual(storedLive.name, "Draft sneak");
  });
});

test("0006 and schema.sql apply on a fresh DB", async () => {
  await withDb(async (d1) => {
    await apply(d1, SCHEMA);
    const tables = await d1.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = new Set(tables.results.map((r) => r.name));
    for (const name of ["profile_review", "profile_photos", "uploaded_media", "maintenance_state", "grow_reports"]) {
      assert.ok(names.has(name), name);
    }
    const reviewCols = await d1.prepare("PRAGMA table_info(profile_review)").all();
    assert.ok(reviewCols.results.some((c) => c.name === "confirmed_culinary_at"));
  });
});
