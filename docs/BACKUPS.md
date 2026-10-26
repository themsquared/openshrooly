# D1 backups

Two layers protect the `shroomlabs` D1 database.

1. **Time Travel.** Cloudflare keeps 30 days of point-in-time history for D1 on Workers Paid. Nothing to run.
2. **Nightly export.** The API's 5 minute cron (`community/api/src/backup.js`) writes one gzipped JSON snapshot a day, after 10:00 UTC (3 AM Pacific), to the private R2 bucket `shroomlabs-backups` as `d1/YYYY-MM-DD.json.gz`. It keeps the newest 30 and deletes older ones. Each run logs `d1_backup` (or `d1_backup_failed`) in Workers Logs.

The bucket is private. Do not attach a custom domain or turn on r2.dev for it. The snapshot holds user emails and session hashes.

## Check that it ran

```
npx wrangler r2 object get shroomlabs-backups/d1/2026-10-26.json.gz --remote --file /tmp/d1.json.gz -c wrangler.deploy.toml
```

## Restore (destructive, needs Mike's OK)

A restore overwrites live data. Do not run any of this without Mike saying go.

1. Prefer Time Travel for anything in the last 30 days: `npx wrangler d1 time-travel info shroomlabs` then `restore`.
2. From a nightly file: `node scripts/backup-to-sql.mjs /tmp/d1.json.gz > /tmp/restore.sql`. Review it. Load it into a **new** D1 database first and check it, then switch the binding. Never load it over the live database.

## Limits

The export reads every row once a day. That is fine for now (the whole database is under 1 MB). If readings grow past a few hundred thousand rows, move this to a scheduled `wrangler d1 export` in CI.
