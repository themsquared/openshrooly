#!/usr/bin/env node
/**
 * Dev-only LAN Autopilot delivery. Production uses the cloud inbox.
 * DRY_RUN by default. Live writes require COACH_BRIDGE_LIVE=1 and no DRY_RUN=1.
 * Refuses sldev_* / delivery=cloud devices so it cannot fight the cloud path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { nowIso } from "../src/crypto.js";
import {
  BRIDGE_KILL_FILE,
  BRIDGE_STATE_FILE,
  bridgeMode,
  chamberAuthHeader,
  expireStaleOnLiveStart,
  httpApplyWrites,
  runBridgeCycle,
  stageFromProfile,
  withBridgeResult,
} from "../src/coach-bridge.js";
import { sqlQuote } from "../src/seed.js";
import {
  API_ROOT,
  COACH_LOCAL_DEVICE_ID,
  wranglerLocalD1Command,
  wranglerLocalD1Rows,
} from "./coach-local-d1.js";
import { POLL_INTERVAL_MS, normalizeChamberUrl, readChamber } from "./coach-readings.js";

export const BRIDGE_LOOP_BACKOFF_MS = 60_000;
const DEV_VARS_PATH = join(API_ROOT, ".dev.vars");

export function parseDevVars(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Copy KEY=VALUE pairs into env without replacing keys that are already set. */
export function loadDevVarsInto(env, text) {
  const parsed = parseDevVars(text);
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
  }
  return env;
}

export function loadDevVarsFile(env = process.env, filePath = DEV_VARS_PATH) {
  try {
    loadDevVarsInto(env, readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  return env;
}

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] || "";
  return fallback;
}

function resolvePath(rel) {
  return join(API_ROOT, rel);
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function parseRowPayload(row) {
  if (!row) return null;
  if (typeof row.document === "string") {
    try {
      return JSON.parse(row.document);
    } catch {
      return null;
    }
  }
  return row.document || null;
}

function loadDeviceRow(deviceId) {
  return (
    wranglerLocalD1Rows(`SELECT * FROM cloud_devices WHERE id=${sqlQuote(deviceId)} LIMIT 1;`)[0] || { id: deviceId }
  );
}

function loadDeviceMode(deviceId) {
  return wranglerLocalD1Rows(`SELECT * FROM coach_device_mode WHERE device_id=${sqlQuote(deviceId)} LIMIT 1;`)[0] || {};
}

function loadStage(deviceId) {
  const mode = loadDeviceMode(deviceId);
  const profileId = mode?.profile_id;
  if (!profileId) return {};
  const row = wranglerLocalD1Rows(`SELECT document FROM profiles WHERE id=${sqlQuote(profileId)} LIMIT 1;`)[0];
  const doc = parseRowPayload(row);
  return stageFromProfile(doc);
}

export async function runBridgeLoop({
  runOnce,
  looping = false,
  intervalMs = POLL_INTERVAL_MS,
  errorBackoffMs = BRIDGE_LOOP_BACKOFF_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.error,
  stop,
} = {}) {
  do {
    try {
      await runOnce();
    } catch (err) {
      log(`bridge error: ${err.message || err} (backoff ${errorBackoffMs / 1000}s)`);
      if (!looping) throw err;
      await sleep(errorBackoffMs);
      continue;
    }
    if (!looping) break;
    if (stop?.()) break;
    await sleep(intervalMs);
  } while (looping && !stop?.());
}

async function runOnce({ chamber, deviceId, env = process.env } = {}) {
  const killPath = resolvePath(arg("kill-file", BRIDGE_KILL_FILE));
  const statePath = resolvePath(arg("state-file", BRIDGE_STATE_FILE));
  const log = (event) => {
    const line = JSON.stringify({ at: nowIso(), ...event });
    console.log(line);
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(join(dirname(statePath), "bridge.log"), `${line}\n`, { flag: "a" });
    } catch {
      // log file is best-effort
    }
  };

  return runBridgeCycle({
    env,
    killSwitch: existsSync(killPath),
    state: readState(statePath),
    saveState: (next) => writeState(statePath, { ...readState(statePath), ...next }),
    device: loadDeviceRow(deviceId),
    deviceMode: loadDeviceMode(deviceId),
    log,
    listPending: async () =>
      wranglerLocalD1Rows(
        `SELECT * FROM device_commands WHERE device_id=${sqlQuote(deviceId)} AND consumed_at IS NULL ORDER BY id ASC LIMIT 1;`
      ),
    loadStage: async () => loadStage(deviceId),
    readChamber: async () => readChamber(chamber),
    applyWrites: async (writes) => httpApplyWrites(chamber, writes, { auth: chamberAuthHeader(env) }),
    markCommand: async (command, result) => {
      const payload = withBridgeResult(command, result);
      wranglerLocalD1Command(
        `UPDATE device_commands SET consumed_at=${sqlQuote(nowIso())}, payload=${sqlQuote(JSON.stringify(payload))} WHERE id=${Number(command.id)} AND device_id=${sqlQuote(deviceId)};`
      );
    },
  });
}

export async function main() {
  loadDevVarsFile();
  const chamber = normalizeChamberUrl(arg("chamber"));
  if (!chamber) {
    console.error("Usage: node scripts/coach-local-bridge.js --chamber http://192.168.1.42 [--loop]");
    process.exit(2);
  }
  const deviceId = arg("device-id", COACH_LOCAL_DEVICE_ID);
  const intervalSec = Number(arg("interval", String(POLL_INTERVAL_MS / 1000)));
  const intervalMs = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec * 1000 : POLL_INTERVAL_MS;
  const looping = process.argv.includes("--loop");
  const env = process.env;
  console.error(
    `Coach bridge ${bridgeMode(env)} for ${deviceId} → ${chamber}${looping ? ` every ${intervalMs / 1000}s` : ""} (Ctrl+C to stop).`
  );
  if (existsSync(resolvePath(BRIDGE_KILL_FILE))) {
    console.error(`Kill switch on: ${BRIDGE_KILL_FILE}`);
  }
  if (bridgeMode(env) === "live" && !env.COACH_CHAMBER_PASSWORD) {
    console.error(
      "Live writes need COACH_CHAMBER_PASSWORD (the chamber web password shown on the device screen). Add it to community/api/.dev.vars; the bridge loads that file itself."
    );
  }
  if (bridgeMode(env) === "live") {
    const expired = await expireStaleOnLiveStart({
      listPendingAll: async () =>
        wranglerLocalD1Rows(
          `SELECT * FROM device_commands WHERE device_id=${sqlQuote(deviceId)} AND consumed_at IS NULL ORDER BY id ASC LIMIT 200;`
        ),
      markCommand: async (command, result) => {
        const payload = withBridgeResult(command, result);
        wranglerLocalD1Command(
          `UPDATE device_commands SET consumed_at=${sqlQuote(nowIso())}, payload=${sqlQuote(JSON.stringify(payload))} WHERE id=${Number(command.id)} AND device_id=${sqlQuote(deviceId)};`
        );
      },
      log: (event) => console.log(JSON.stringify({ at: nowIso(), ...event })),
    });
    if (expired) console.error(`Expired ${expired} stale pending command(s) on live start.`);
  }

  await runBridgeLoop({
    looping,
    intervalMs,
    runOnce: () => runOnce({ chamber, deviceId, env }),
    log: (line) => console.error(line),
  });
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
