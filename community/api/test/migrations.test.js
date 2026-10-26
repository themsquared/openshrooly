import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const MIGRATION = readFileSync(new URL("../migrations/0001_undash_profiles.sql", import.meta.url), "utf8")
  .replace(/--.*$/gm, "")
  .trim();

// Stored documents use both literal dash characters and JSON \u escapes.
const escapeDashes = (json) => json.replace(/\u2014/g, "\\u2014").replace(/\u2013/g, "\\u2013");
const FIXTURES = [
  { id: "literal", doc: { name: "King Oyster \u2014 thick-stem method", summary: "Fruits at 12\u201318 \u00b0C." } },
  { id: "escaped", doc: { name: "Lion\u2019s mane", summary: "Moderate FAE \u2014 too much air yellows spines.", detail: "85\u201395% RH and 8 \u2013 12 h light." }, escape: true },
  { id: "unspaced", doc: { summary: "Darker fruits\u2014still edible." } },
  { id: "clean", doc: { name: "Blue Oyster", summary: "Fast and forgiving." } },
];
const EXPECTED = {
  literal: { name: "King Oyster: thick-stem method", summary: "Fruits at 12 to 18 \u00b0C." },
  escaped: { name: "Lion\u2019s mane", summary: "Moderate FAE: too much air yellows spines.", detail: "85 to 95% RH and 8 to 12 h light." },
  unspaced: { summary: "Darker fruits: still edible." },
  clean: { name: "Blue Oyster", summary: "Fast and forgiving." },
};

async function withDb(fn) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    await db.prepare("CREATE TABLE profiles (id TEXT PRIMARY KEY, document TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE ratings (profile_id TEXT, comment TEXT)").run();
    for (const f of FIXTURES) {
      const json = JSON.stringify(f.doc);
      await db.prepare("INSERT INTO profiles (id, document) VALUES (?, ?)").bind(f.id, f.escape ? escapeDashes(json) : json).run();
    }
    await db.prepare("INSERT INTO ratings VALUES ('literal', ?)").bind("Great \u2014 would grow 12\u201318 again").run();
    await fn(db);
  } finally {
    await mf.dispose();
  }
}

test("undash migration rewrites literal and escaped dashes with clean spacing, only in profiles", async () => {
  await withDb(async (db) => {
    const escaped = await db.prepare("SELECT document FROM profiles WHERE id = 'escaped'").first("document");
    assert.match(escaped, /\\u2014/, "fixture stores an escaped em dash");

    const first = await db.prepare(MIGRATION).run();
    assert.equal(first.meta.changes, 3, "rewrites the three dashed rows and skips the clean one");

    const { results } = await db.prepare("SELECT id, document FROM profiles").all();
    for (const row of results) {
      assert.doesNotMatch(row.document, /[\u2013\u2014]|\\u201[34]/i, `${row.id} still has a dash`);
      const parsed = JSON.parse(row.document);
      assert.deepEqual(parsed, EXPECTED[row.id], `${row.id} text`);
      for (const value of Object.values(parsed)) {
        assert.doesNotMatch(value, / :|:  |  to |to  /, `${row.id} spacing: ${value}`);
      }
    }

    const rating = await db.prepare("SELECT comment FROM ratings").first("comment");
    assert.equal(rating, "Great \u2014 would grow 12\u201318 again", "other tables are untouched");

    const second = await db.prepare(MIGRATION).run();
    assert.equal(second.meta.changes, 0, "second run is a no-op");
  });
});
