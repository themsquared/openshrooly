import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeStatusFile(path, status) {
  if (!path) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ok: true, reachable: true, ...status })}\n`, { mode: 0o600 });
}
