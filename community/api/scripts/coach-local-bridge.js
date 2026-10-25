#!/usr/bin/env node
/**
 * Apply one pending local device_command to the LAN chamber (Option A).
 * DRY_RUN by default. Live writes require COACH_BRIDGE_LIVE=1 and no DRY_RUN=1.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { nowIso } from "../src/crypto.js";
import {
  BRIDGE_KILL_FILE,
  BRIDGE_STATE_FILE,
  bridgeMode,
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

function loadStage(deviceId) {
  const mode = wranglerLocalD1Rows(
    `SELECT profile_id FROM coach_device_mode WHERE device_id=${sqlQuote(deviceId)} LIMIT 1;`
  )[0];
  const profileId = mode?.profile_id;
  if (!profileId) return {};
  const row = wranglerLocalD1Rows(`SELECT document FROM profiles WHERE id=${sqlQuote(profileId)} LIMIT 1;`)[0];
  const doc = parseRowPayload(row);
  return stageFromProfile(doc);
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
    log,
    listPending: async () =>
      wranglerLocalD1Rows(
        `SELECT * FROM device_commands WHERE device_id=${sqlQuote(deviceId)} AND consumed_at IS NULL ORDER BY id ASC LIMIT 1;`
      ),
    loadStage: async () => loadStage(deviceId),
    readChamber: async () => readChamber(chamber),
    applyWrites: async (writes) => httpApplyWrites(chamber, writes),
    markCommand: async (command, result) => {
      const payload = withBridgeResult(command, result);
      wranglerLocalD1Command(
        `UPDATE device_commands SET consumed_at=${sqlQuote(nowIso())}, payload=${sqlQuote(JSON.stringify(payload))} WHERE id=${Number(command.id)} AND device_id=${sqlQuote(deviceId)};`
      );
    },
  });
}

export async function main() {
  const chamber = normalizeChamberUrl(arg("chamber"));
  if (!chamber) {
    console.error("Usage: node scripts/coach-local-bridge.js --chamber http://192.168.1.42 [--loop]");
    process.exit(2);
  }
  const deviceId = arg("device-id", COACH_LOCAL_DEVICE_ID);
  const intervalSec = Number(arg("interval", String(POLL_INTERVAL_MS / 1000)));
  const intervalMs = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec * 1000 : POLL_INTERVAL_MS;
  const looping = process.argv.includes("--loop");
  console.error(
    `Coach bridge ${bridgeMode(process.env)} for ${deviceId} → ${chamber}${looping ? ` every ${intervalMs / 1000}s` : ""} (Ctrl+C to stop).`
  );
  if (existsSync(resolvePath(BRIDGE_KILL_FILE))) {
    console.error(`Kill switch on: ${BRIDGE_KILL_FILE}`);
  }
  if (bridgeMode(process.env) === "live") {
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

  do {
    await runOnce({ chamber, deviceId });
    if (!looping) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (looping);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
