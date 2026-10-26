import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { BACKUP_KEEP, runBackup } from "../src/backup.js";
import { backupToSql } from "../scripts/backup-to-sql.mjs";

function fakeDb(tables) {
  return {
    async all(sql, params = []) {
      if (sql.includes("sqlite_master")) {
        return [
          ...Object.keys(tables).map((name) => ({ type: "table", name, tbl_name: name, sql: `CREATE TABLE ${name} (id INTEGER, note TEXT)` })),
          { type: "index", name: "idx_users_note", tbl_name: "users", sql: "CREATE INDEX idx_users_note ON users(note)" },
        ];
      }
      const name = sql.match(/FROM "([^"]+)"/)[1];
      const [limit, offset] = params;
      return tables[name].slice(offset, offset + limit);
    },
  };
}

function fakeBucket(keys = []) {
  const objects = new Map(keys.map((key) => [key, new Uint8Array()]));
  return {
    objects,
    async head(key) {
      return objects.has(key) ? { key } : null;
    },
    async put(key, body) {
      objects.set(key, body);
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

const at = (iso) => Date.parse(iso);

test("backup waits for its hour, writes once a day, and keeps the newest 30", async () => {
  const users = Array.from({ length: 1203 }, (_, i) => ({ id: i + 1, note: i === 7 ? "it's" : null }));
  const db = fakeDb({ users, devices: [{ id: 1, note: "x" }] });
  const old = Array.from({ length: 35 }, (_, i) => `d1/2026-09-${String(i + 1).padStart(2, "0")}.json.gz`);
  const bucket = fakeBucket(old);

  assert.equal((await runBackup(db, bucket, { now: at("2026-10-26T09:59:00Z") })).skipped, "not_yet");
  const done = await runBackup(db, bucket, { now: at("2026-10-26T10:05:00Z") });
  assert.equal(done.key, "d1/2026-10-26.json.gz");
  assert.equal(done.rows, 1204);
  assert.equal(bucket.objects.size, BACKUP_KEEP);
  assert.ok(bucket.objects.has("d1/2026-10-26.json.gz"));
  assert.ok(!bucket.objects.has("d1/2026-09-01.json.gz"));
  assert.equal((await runBackup(db, bucket, { now: at("2026-10-26T10:10:00Z") })).skipped, "done_today");
  assert.equal((await runBackup(db, null)).skipped, "no_bucket");

  const backup = JSON.parse(gunzipSync(bucket.objects.get("d1/2026-10-26.json.gz")).toString("utf8"));
  assert.equal(backup.tables.users.length, 1203);
  const sql = backupToSql(backup);
  assert.match(sql, /^PRAGMA foreign_keys=OFF;\nCREATE TABLE users/);
  assert.ok(sql.includes(`VALUES (8, 'it''s');`));
  assert.ok(sql.trim().endsWith("CREATE INDEX idx_users_note ON users(note);"));
});
