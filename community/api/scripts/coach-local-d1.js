/** Shared wrangler local D1 helper for Grow Coach beta. Do not use against prod. */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const API_ROOT = join(import.meta.dirname, "..");
export const COACH_LOCAL_CONFIG = "wrangler.coach-local.toml";
export const COACH_LOCAL_DB = "shroomlabs-coach-local";
export const COACH_LOCAL_PERSIST = ".wrangler/coach-local";
export const COACH_LOCAL_USER_ID = 1;
export const COACH_LOCAL_DEVICE_ID = "local-chamber";

export function wranglerLocalD1(file) {
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
    { stdio: "inherit", cwd: API_ROOT }
  );
  if (result.status) process.exit(result.status);
}
