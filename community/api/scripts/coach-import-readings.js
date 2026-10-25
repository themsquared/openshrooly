#!/usr/bin/env node
/**
 * Import current chamber readings into local Coach D1.
 * Default is one-shot upsert (never recreates the device row).
 * --poll GET-only loops with a 5s reachability timeout and 5 min error backoff.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  COACH_LOCAL_DEVICE_ID,
  COACH_LOCAL_USER_ID,
  wranglerLocalD1,
} from "./coach-local-d1.js";
import {
  ERROR_BACKOFF_MS,
  POLL_INTERVAL_MS,
  buildImportSql,
  fetchJson,
  nextPollDelay,
  normalizeChamberUrl,
  readChamber,
  readingsFromEntities,
  sensorValue,
  telemetryDocument,
  writeImport,
} from "./coach-readings.js";

export function arg(name, fallback = "", argv = process.argv) {
  const prefix = `--${name}=`;
  const hit = argv.find((item) => item.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0) return argv[idx + 1] || "";
  return fallback;
}

export function flag(name, argv = process.argv) {
  return argv.includes(`--${name}`);
}

export async function resolveFromHub(hubUrl, deviceHint, deps = {}) {
  const base = normalizeChamberUrl(hubUrl);
  const devices = await (deps.fetchJson || fetchJson)(`${base}/api/devices`, deps);
  if (!Array.isArray(devices) || !devices.length) throw new Error("hub has no chambers");
  const hint = String(deviceHint || "");
  const row =
    devices.find((d) => String(d.id) === hint || String(d.host) === hint || String(d.name) === hint) || devices[0];
  const host = row.host.includes(":") ? `[${row.host}]` : row.host;
  const port = Number(row.port) || 80;
  return { name: row.name || "LAN chamber", chamber: `http://${host}:${port}` };
}

export async function collectReadings({ argv = process.argv, fetchImpl } = {}) {
  const chamberFlag = arg("chamber", "", argv);
  const hubFlag = arg("hub", "", argv);
  const deviceHint = arg("device", "", argv);
  const name = arg("name", "LAN chamber", argv);
  let readings;
  let chamberName = name;
  let source = "";
  const deps = fetchImpl ? { fetchImpl } : {};

  if (argv.includes("--json") || argv.some((item) => item.startsWith("--json="))) {
    const raw = arg("json", "", argv) || argv[argv.indexOf("--json") + 1] || "{}";
    readings = readingsFromEntities(JSON.parse(raw));
    source = "json";
  } else if (hubFlag) {
    const resolved = await resolveFromHub(hubFlag, deviceHint, deps);
    chamberName = resolved.name || name;
    readings = await readChamber(resolved.chamber, deps);
    source = resolved.chamber;
  } else if (chamberFlag) {
    readings = await readChamber(chamberFlag, deps);
    source = normalizeChamberUrl(chamberFlag);
  } else {
    throw new Error(
      "Usage: node scripts/coach-import-readings.js --chamber http://192.168.1.42\n" +
        "   or: node scripts/coach-import-readings.js --hub http://127.0.0.1:8090 [--device 1]\n" +
        "   or: node scripts/coach-import-readings.js --poll --chamber http://192.168.1.42"
    );
  }

  if (sensorValue(readings.humidity) == null && sensorValue(readings.temperature) == null) {
    throw new Error(`No humidity or temperature from ${source || "input"}.`);
  }
  return { readings, chamberName, source };
}

export async function persistReadings(
  { readings, chamberName, source, deviceId, userId, now = Date.now(), db, execSql } = {}
) {
  const created = new Date(now).toISOString().replace(/\.\d+Z$/, "Z");
  const document = telemetryDocument(readings, { source });
  if (db) {
    await writeImport(db, {
      deviceId,
      name: chamberName,
      userId,
      document,
      created,
      now,
    });
  } else if (execSql) {
    execSql(buildImportSql({ deviceId, name: chamberName, userId, document, created, now }));
  } else {
    throw new Error("persistReadings needs db or execSql");
  }
  return { created, document };
}

function wranglerExecSql(sql) {
  const file = join(mkdtempSync(join(tmpdir(), "shroomlabs-coach-tel-")), "telemetry.sql");
  writeFileSync(file, sql);
  wranglerLocalD1(file);
}

export async function runPollOnce(opts = {}) {
  const collect = opts.collectReadings || collectReadings;
  const collected = opts.collected || (await collect(opts));
  const persisted = await persistReadings({
    ...collected,
    deviceId: opts.deviceId,
    userId: opts.userId,
    now: opts.now,
    db: opts.db,
    execSql: opts.execSql,
  });
  return { ...collected, ...persisted };
}

export async function runPollLoop(opts = {}) {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = opts.log || console.error;
  let delay = intervalMs;
  while (!opts.stop?.()) {
    try {
      const result = await runPollOnce(opts);
      log(
        `Imported ${result.chamberName} as ${opts.deviceId} from ${result.source || "json"}: RH ${result.readings.humidity ?? "n/a"}% · ${result.readings.temperature ?? "n/a"} °C`
      );
      delay = nextPollDelay(true, intervalMs);
    } catch (err) {
      log(`poll error: ${err.message || err} (backoff ${ERROR_BACKOFF_MS / 1000}s)`);
      delay = nextPollDelay(false, intervalMs);
    }
    if (opts.stop?.()) break;
    await sleep(delay);
  }
}

export async function main(argv = process.argv) {
  const deviceId = arg("device-id", COACH_LOCAL_DEVICE_ID, argv);
  const userId = Number(arg("user-id", String(COACH_LOCAL_USER_ID), argv)) || COACH_LOCAL_USER_ID;
  const intervalSec = Number(arg("interval", String(POLL_INTERVAL_MS / 1000), argv));
  const intervalMs = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec * 1000 : POLL_INTERVAL_MS;
  const shared = { argv, deviceId, userId, execSql: wranglerExecSql, intervalMs };

  if (flag("poll", argv)) {
    console.error(`Polling ${arg("chamber", arg("hub", "chamber", argv), argv)} every ${intervalMs / 1000}s (Ctrl+C to stop).`);
    await runPollLoop(shared);
    return;
  }

  const result = await runPollOnce(shared);
  console.log(
    `Imported ${result.chamberName} as ${deviceId} from ${result.source || "json"}: RH ${result.readings.humidity ?? "n/a"}% · ${result.readings.temperature ?? "n/a"} °C`
  );
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(err.message?.startsWith("Usage:") ? 2 : 1);
  });
}
