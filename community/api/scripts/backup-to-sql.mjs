#!/usr/bin/env node
/**
 * Turns a nightly backup (d1/YYYY-MM-DD.json.gz from shroomlabs-backups) into a .sql file.
 * It only writes a file. Loading it into D1 is a restore, which is destructive and needs Mike's OK.
 * Usage: node scripts/backup-to-sql.mjs 2026-10-26.json.gz > restore.sql
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;

export function backupToSql(backup) {
  if (backup?.format !== "shroomlabs-d1-backup/1") throw new Error("not a Shroom Labs D1 backup");
  const lines = ["PRAGMA foreign_keys=OFF;"];
  for (const entry of backup.schema.filter((row) => row.type === "table")) lines.push(`${entry.sql};`);
  for (const [table, rows] of Object.entries(backup.tables)) {
    for (const row of rows) {
      const cols = Object.keys(row);
      lines.push(`INSERT INTO ${quote(table)} (${cols.map(quote).join(", ")}) VALUES (${cols.map((c) => sqlValue(row[c])).join(", ")});`);
    }
  }
  for (const entry of backup.schema.filter((row) => row.type !== "table")) lines.push(`${entry.sql};`);
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/backup-to-sql.mjs <backup.json.gz>");
    process.exit(1);
  }
  const raw = readFileSync(file);
  const text = file.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  process.stdout.write(backupToSql(JSON.parse(text)));
}
