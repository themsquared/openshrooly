/** Shared wrangler local D1 helper for Grow Coach beta. Do not use against prod. */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const API_ROOT = join(import.meta.dirname, "..");
export const COACH_LOCAL_CONFIG = "wrangler.coach-local.toml";
export const COACH_LOCAL_DB = "shroomlabs-coach-local";
export const COACH_LOCAL_PERSIST = ".wrangler/coach-local";
export const COACH_LOCAL_USER_ID = 1;
export const COACH_LOCAL_DEVICE_ID = "local-chamber";

export function handleWranglerResult(result, { throwOnError = false, quiet = false } = {}) {
  if (!result.status) return result.stdout || "";
  const detail = String(result.stderr || result.stdout || `wrangler d1 execute failed (${result.status})`).trim();
  if (throwOnError) throw new Error(detail || "wrangler d1 execute failed");
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status);
}

export function wranglerLocalD1(file, { quiet = false, throwOnError = false } = {}) {
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
}

export function wranglerLocalD1Command(sql, { json = false } = {}) {
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
  return handleWranglerResult(result, { quiet: true, throwOnError: json });
}

export function wranglerLocalD1Rows(sql) {
  const raw = wranglerLocalD1Command(sql, { json: true });
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  const batch = Array.isArray(parsed) ? parsed[0] : parsed;
  return batch?.results || batch?.result?.[0]?.results || [];
}
