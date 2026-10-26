/**
 * Nightly D1 backup to the private BACKUPS R2 bucket (shroomlabs-backups).
 * Runs from the 5 minute cron, writes d1/YYYY-MM-DD.json.gz once a day after 10:00 UTC,
 * and keeps the newest 30. Restore is manual and needs Mike's OK (docs/BACKUPS.md).
 */

export const BACKUP_KEEP = 30;
export const BACKUP_HOUR_UTC = 10;
const PAGE = 500;
export const BACKUP_FORMAT = "shroomlabs-d1-backup/1";

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

export async function dumpDatabase(db) {
  const schema = await db.all(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY type DESC, name"
  );
  const tables = {};
  for (const entry of schema.filter((row) => row.type === "table")) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await db.all(`SELECT * FROM ${quoteIdent(entry.name)} LIMIT ? OFFSET ?`, [PAGE, offset]);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    tables[entry.name] = rows;
  }
  return { format: BACKUP_FORMAT, schema, tables };
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function runBackup(db, bucket, { now = Date.now() } = {}) {
  if (!bucket) return { skipped: "no_bucket" };
  const at = new Date(now);
  if (at.getUTCHours() < BACKUP_HOUR_UTC) return { skipped: "not_yet" };
  const day = at.toISOString().slice(0, 10);
  const key = `d1/${day}.json.gz`;
  if (await bucket.head(key)) return { skipped: "done_today", key };
  const dump = await dumpDatabase(db);
  const body = await gzip(JSON.stringify({ ...dump, created_at: at.toISOString() }));
  await bucket.put(key, body, { httpMetadata: { contentType: "application/gzip" } });
  const listed = await bucket.list({ prefix: "d1/" });
  const old = listed.objects
    .map((obj) => obj.key)
    .sort()
    .reverse()
    .slice(BACKUP_KEEP);
  for (const stale of old) await bucket.delete(stale);
  const rows = Object.values(dump.tables).reduce((sum, list) => sum + list.length, 0);
  return { key, bytes: body.byteLength, tables: Object.keys(dump.tables).length, rows, pruned: old.length };
}
