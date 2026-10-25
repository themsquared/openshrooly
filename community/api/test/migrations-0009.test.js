import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const MIGRATION = readFileSync(new URL("../migrations/0009_device_type.sql", import.meta.url), "utf8");

function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

test("0009 adds device_type without rewriting existing rows", async () => {
  assert.equal(statements(MIGRATION).length, 1);
  assert.match(MIGRATION, /ALTER TABLE cloud_devices ADD COLUMN device_type/);
  assert.match(MIGRATION, /shrooly_chamber/);
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ""), /\b(DROP|DELETE|UPDATE|INSERT|REPLACE)\b/i);

  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  try {
    const db = await mf.getD1Database("DB");
    await db
      .prepare(
        `CREATE TABLE cloud_devices (
          id TEXT PRIMARY KEY,
          hardware_id TEXT NOT NULL UNIQUE,
          public_jwk TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          owner_id INTEGER,
          enroll_hash TEXT,
          claim_code_hash TEXT,
          claim_expires_at TEXT,
          cloud_enabled INTEGER NOT NULL DEFAULT 0,
          last_seen_at TEXT,
          created_at TEXT NOT NULL
        )`
      )
      .run();
    await db
      .prepare(
        "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind("dev-1", "hw-1", "{}", "Kitchen", "active", 1, null, null, null, 1, "2026-10-25T00:00:00Z", "2026-10-01T00:00:00Z")
      .run();
    for (const s of statements(MIGRATION)) await db.prepare(s).run();
    const row = await db.prepare("SELECT device_type, name FROM cloud_devices WHERE id=?").bind("dev-1").first();
    assert.equal(row.device_type, "shrooly_chamber");
    assert.equal(row.name, "Kitchen");
  } finally {
    await mf.dispose();
  }
});
