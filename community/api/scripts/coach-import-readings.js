#!/usr/bin/env node
/**
 * One-shot import of current chamber readings into local Coach D1.
 * Sources: chamber ESPHome REST, or the local hub's device list then the chamber.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nowIso } from "../src/crypto.js";
import { sqlQuote } from "../src/seed.js";
import {
  COACH_LOCAL_DEVICE_ID,
  COACH_LOCAL_USER_ID,
  wranglerLocalD1,
} from "./coach-local-d1.js";
import {
  CHAMBER_SENSORS,
  normalizeChamberUrl,
  readingsFromEntities,
  sensorValue,
  telemetryDocument,
} from "./coach-readings.js";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] || "";
  return fallback;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function readEntity(base, domain, ids) {
  for (const id of ids) {
    try {
      const payload = await fetchJson(`${base}/${domain}/${id}`);
      if (payload && (payload.value != null || payload.state != null || typeof payload === "number")) {
        return payload;
      }
    } catch {
      // try the next ESPHome id
    }
  }
  return null;
}

export async function readChamber(baseUrl) {
  const base = normalizeChamberUrl(baseUrl);
  const entities = {};
  for (const [key, [domain, ...ids]] of Object.entries(CHAMBER_SENSORS)) {
    entities[key] = await readEntity(base, domain, ids);
  }
  return readingsFromEntities(entities);
}

async function resolveFromHub(hubUrl, deviceHint) {
  const base = normalizeChamberUrl(hubUrl);
  const devices = await fetchJson(`${base}/api/devices`);
  if (!Array.isArray(devices) || !devices.length) throw new Error("hub has no chambers");
  const hint = String(deviceHint || "");
  const row =
    devices.find((d) => String(d.id) === hint || String(d.host) === hint || String(d.name) === hint) || devices[0];
  const host = row.host.includes(":") ? `[${row.host}]` : row.host;
  const port = Number(row.port) || 80;
  return { name: row.name || "LAN chamber", chamber: `http://${host}:${port}` };
}

const chamberFlag = arg("chamber");
const hubFlag = arg("hub");
const deviceHint = arg("device");
const deviceId = arg("device-id", COACH_LOCAL_DEVICE_ID);
const name = arg("name", "LAN chamber");

let readings;
let chamberName = name;
let source = "";

if (process.argv.includes("--json")) {
  readings = readingsFromEntities(JSON.parse(arg("json") || process.argv[process.argv.indexOf("--json") + 1] || "{}"));
  source = "json";
} else if (hubFlag) {
  const resolved = await resolveFromHub(hubFlag, deviceHint);
  chamberName = resolved.name || name;
  readings = await readChamber(resolved.chamber);
  source = resolved.chamber;
} else if (chamberFlag) {
  readings = await readChamber(chamberFlag);
  source = normalizeChamberUrl(chamberFlag);
} else {
  console.error("Usage: node scripts/coach-import-readings.js --chamber http://192.168.1.42");
  console.error("   or: node scripts/coach-import-readings.js --hub http://127.0.0.1:8090 [--device 1]");
  process.exit(2);
}

if (sensorValue(readings.humidity) == null && sensorValue(readings.temperature) == null) {
  console.error(`No humidity or temperature from ${source || "input"}.`);
  process.exit(1);
}

const created = nowIso();
const document = telemetryDocument(readings, { source });
const sql = [
  `INSERT OR REPLACE INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (${sqlQuote(deviceId)}, ${sqlQuote(`hw-${deviceId}`)}, '{}', ${sqlQuote(chamberName)}, 'claimed', ${COACH_LOCAL_USER_ID}, NULL, NULL, NULL, 1, ${sqlQuote(created)}, ${sqlQuote(created)});`,
  `INSERT INTO device_telemetry (device_id, document, created_at) VALUES (${sqlQuote(deviceId)}, ${sqlQuote(JSON.stringify(document))}, ${sqlQuote(created)});`,
].join("\n");

const file = join(mkdtempSync(join(tmpdir(), "shroomlabs-coach-tel-")), "telemetry.sql");
writeFileSync(file, sql);
wranglerLocalD1(file);
console.log(`Imported ${chamberName} as ${deviceId} from ${source || "json"}: RH ${readings.humidity ?? "n/a"}% · ${readings.temperature ?? "n/a"} °C`);
