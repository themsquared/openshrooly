/** Parse ESPHome / hub sensor payloads into Coach telemetry JSON. */

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { sqlQuote } from "../src/seed.js";

export const CHAMBER_SENSORS = {
  temperature: ["sensor", "current_temperature", "temperature"],
  humidity: ["sensor", "current_humidity", "humidity"],
  water_level: ["sensor", "water_level", "water_level_percent"],
  fan_speed: ["sensor", "current_air_exchange_fan_speed", "air_exchange_fan_speed"],
  humidity_setpoint: ["number", "target_humidity"],
  temperature_setpoint: ["number", "temperature_target", "temperature__target"],
};

export const REACHABILITY_MS = 5_000;
export const POLL_INTERVAL_MS = 60_000;
export const ERROR_BACKOFF_MS = 5 * 60_000;
export const READINGS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const POLL_LOG_MAX_BYTES = 1_000_000;

export function sensorValue(payload) {
  if (payload == null) return null;
  if (typeof payload === "number" && Number.isFinite(payload)) return payload;
  if (typeof payload === "string") {
    const n = Number.parseFloat(payload);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof payload === "object") {
    if (payload.value != null) return sensorValue(payload.value);
    if (payload.state != null) return sensorValue(payload.state);
  }
  return null;
}

export function readingsFromEntities(entities = {}) {
  return {
    temperature: sensorValue(entities.temperature),
    humidity: sensorValue(entities.humidity),
    water_level: sensorValue(entities.water_level),
    fan_speed: sensorValue(entities.fan_speed ?? entities.fan_rpm),
    humidity_setpoint: sensorValue(entities.humidity_setpoint ?? entities.target_humidity),
    temperature_setpoint: sensorValue(entities.temperature_setpoint ?? entities.temperature_target),
  };
}

export function telemetryDocument(readings, extra = {}) {
  return {
    humidity: readings.humidity,
    humidity_percent: readings.humidity,
    temperature: readings.temperature,
    temperature_c: readings.temperature,
    humidity_setpoint: readings.humidity_setpoint,
    target_humidity: readings.humidity_setpoint,
    temperature_setpoint: readings.temperature_setpoint,
    target_temperature: readings.temperature_setpoint,
    fan_speed: readings.fan_speed,
    water_level: readings.water_level,
    ...extra,
  };
}

export function normalizeChamberUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, "");
  return `http://${value.replace(/\/$/, "")}`;
}

export function pruneBeforeIso(now = Date.now(), retentionMs = READINGS_RETENTION_MS) {
  return new Date(now - retentionMs).toISOString().replace(/\.\d+Z$/, "Z");
}

export function nextPollDelay(ok, intervalMs = POLL_INTERVAL_MS) {
  return ok ? intervalMs : ERROR_BACKOFF_MS;
}

/** Append a line and rotate when the file would exceed maxBytes. Checked on every write. */
export function appendRotatedLog(filePath, line, { maxBytes = POLL_LOG_MAX_BYTES } = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const text = String(line).endsWith("\n") ? String(line) : `${line}\n`;
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    size = 0;
  }
  if (size > 0 && size + Buffer.byteLength(text) > maxBytes) {
    renameSync(filePath, `${filePath}.1`);
  }
  appendFileSync(filePath, text);
}

export async function fetchJson(url, { timeoutMs = REACHABILITY_MS, fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: ac.signal,
      redirect: "error",
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function readEntity(base, domain, ids, deps = {}) {
  for (const id of ids) {
    try {
      const payload = await fetchJson(`${base}/${domain}/${id}`, deps);
      if (payload && (payload.value != null || payload.state != null || typeof payload === "number")) {
        return payload;
      }
    } catch {
      // try the next ESPHome id
    }
  }
  return null;
}

export async function readChamber(baseUrl, deps = {}) {
  const base = normalizeChamberUrl(baseUrl);
  const entities = {};
  for (const [key, [domain, ...ids]] of Object.entries(CHAMBER_SENSORS)) {
    entities[key] = await readEntity(base, domain, ids, deps);
  }
  return readingsFromEntities(entities);
}

export function buildImportSql({
  deviceId,
  name,
  userId,
  document,
  created,
  now = Date.now(),
}) {
  const seen = sqlQuote(created);
  const prune = sqlQuote(pruneBeforeIso(now));
  const doc = typeof document === "string" ? document : JSON.stringify(document);
  return [
    `INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (${sqlQuote(deviceId)}, ${sqlQuote(`hw-${deviceId}`)}, '{}', ${sqlQuote(name)}, 'claimed', ${Number(userId)}, NULL, NULL, NULL, 1, ${seen}, ${seen})`,
    `ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, name=excluded.name, status='claimed', owner_id=excluded.owner_id, cloud_enabled=1;`,
    `INSERT INTO device_telemetry (device_id, document, created_at) VALUES (${sqlQuote(deviceId)}, ${sqlQuote(doc)}, ${seen});`,
    `DELETE FROM device_telemetry WHERE device_id=${sqlQuote(deviceId)} AND created_at<${prune};`,
  ].join("\n");
}

/** Upsert the chamber row and append a reading. Never deletes the device or its children. */
export async function writeImport(db, { deviceId, name, userId, document, created, now = Date.now() }) {
  const existing = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  if (existing) {
    await db.run("UPDATE cloud_devices SET last_seen_at=? WHERE id=?", [created, deviceId]);
    if (name) await db.run("UPDATE cloud_devices SET name=? WHERE id=?", [name, deviceId]);
  } else {
    await db.run(
      "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [deviceId, `hw-${deviceId}`, "{}", name, "claimed", userId, null, null, null, 1, created, created]
    );
  }
  await db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    deviceId,
    typeof document === "string" ? document : JSON.stringify(document),
    created,
  ]);
  await db.run("DELETE FROM device_telemetry WHERE device_id=? AND created_at<?", [deviceId, pruneBeforeIso(now)]);
  return { upserted: Boolean(existing) };
}
