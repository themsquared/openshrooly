/** Shared wrangler local D1 helper for Grow Coach beta. Do not use against prod. */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const API_ROOT = join(import.meta.dirname, "..");
export const COACH_LOCAL_CONFIG = "wrangler.coach-local.toml";
export const COACH_LOCAL_DB = "shroomlabs-coach-local";
export const COACH_LOCAL_PERSIST = ".wrangler/coach-local";
export const COACH_LOCAL_USER_ID = 1;
export const COACH_LOCAL_DEVICE_ID = "local-chamber";
export const SQLITE_BUSY_RETRIES = 3;
export const SQLITE_BUSY_BASE_MS = 40;

export function isSqliteBusy(err) {
  const text = typeof err === "string" ? err : err?.message || String(err || "");
  return /SQLITE_BUSY|database is locked/i.test(text);
}

export function sqliteBusyDelayMs(attempt, baseMs = SQLITE_BUSY_BASE_MS, rand = Math.random()) {
  return Math.round(baseMs * (attempt + 1) * (0.5 + rand));
}

export function defaultBusySleep(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function retryOnSqliteBusy(run, { retries = SQLITE_BUSY_RETRIES, baseMs = SQLITE_BUSY_BASE_MS, sleep = defaultBusySleep, random = Math.random } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return run();
    } catch (err) {
      last = err;
      if (!isSqliteBusy(err) || attempt === retries) throw err;
      sleep(sqliteBusyDelayMs(attempt, baseMs, random()));
    }
  }
  throw last;
}

export function handleWranglerResult(result, { throwOnError = false, quiet = false } = {}) {
  if (!result.status) return result.stdout || "";
  const detail = String(result.stderr || result.stdout || `wrangler d1 execute failed (${result.status})`).trim();
  const err = new Error(detail || "wrangler d1 execute failed");
  if (throwOnError || isSqliteBusy(detail)) throw err;
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status);
}

export function wranglerLocalD1(file, { quiet = false, throwOnError = false, retries = SQLITE_BUSY_RETRIES, sleep, random } = {}) {
  return retryOnSqliteBusy(
    () => {
      const result = spawnSync(
        "npx",
        [
          "wrangler",
          "d1",
          "execute",
          COACH_LOCAL_DB,
          "--local",
          "-c",
          COACH_LOCAL_CONFIG,
          "--persist-to",
          COACH_LOCAL_PERSIST,
          "--file",
          file,
        ],
        { stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8", cwd: API_ROOT }
      );
      return handleWranglerResult(result, { quiet, throwOnError });
    },
    { retries, sleep, random }
  );
}

export function wranglerLocalD1Command(sql, { json = false, throwOnError = true, retries = SQLITE_BUSY_RETRIES, sleep, random } = {}) {
  return retryOnSqliteBusy(
    () => {
      const args = [
        "wrangler",
        "d1",
        "execute",
        COACH_LOCAL_DB,
        "--local",
        "-c",
        COACH_LOCAL_CONFIG,
        "--persist-to",
        COACH_LOCAL_PERSIST,
        "--command",
        sql,
      ];
      if (json) args.push("--json");
      const result = spawnSync("npx", args, { encoding: "utf8", cwd: API_ROOT, stdio: ["ignore", "pipe", "pipe"] });
      return handleWranglerResult(result, { quiet: true, throwOnError });
    },
    { retries, sleep, random }
  );
}

export function wranglerLocalD1Rows(sql, opts = {}) {
  const raw = wranglerLocalD1Command(sql, { ...opts, json: true, throwOnError: true });
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  const batch = Array.isArray(parsed) ? parsed[0] : parsed;
  return batch?.results || batch?.result?.[0]?.results || [];
}
