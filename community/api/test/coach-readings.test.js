import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryDb } from "../src/db.js";
import { nowIso } from "../src/crypto.js";
import {
  ERROR_BACKOFF_MS,
  POLL_INTERVAL_MS,
  READINGS_RETENTION_MS,
  buildImportSql,
  nextPollDelay,
  normalizeChamberUrl,
  pruneBeforeIso,
  readingsFromEntities,
  sensorValue,
  telemetryDocument,
  writeImport,
} from "../scripts/coach-readings.js";
import { persistReadings, runPollLoop } from "../scripts/coach-import-readings.js";

const importSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../scripts/coach-import-readings.js"), "utf8");

test("ESPHome sensor payloads become Coach telemetry", () => {
  assert.equal(sensorValue({ value: 91.2, state: "91.2 %" }), 91.2);
  assert.equal(sensorValue({ state: "20.4 °C" }), 20.4);
  const readings = readingsFromEntities({
    temperature: { value: 20.4 },
    humidity: { value: 91.2 },
    humidity_setpoint: { value: 90 },
    temperature_setpoint: { value: 20 },
    water_level: { value: 42 },
  });
  const doc = telemetryDocument(readings, { source: "http://192.168.1.42" });
  assert.equal(doc.humidity, 91.2);
  assert.equal(doc.humidity_setpoint, 90);
  assert.equal(doc.temperature_c, 20.4);
  assert.equal(doc.water_level, 42);
  assert.equal(normalizeChamberUrl("192.168.1.42"), "http://192.168.1.42");
});

test("import SQL upserts the device and never replaces or deletes children", () => {
  const sql = buildImportSql({
    deviceId: "local-chamber",
    name: "LAN chamber",
    userId: 1,
    document: { humidity: 90, temperature: 18 },
    created: "2026-10-25T06:00:00Z",
    now: Date.parse("2026-10-25T06:00:00Z"),
  });
  assert.doesNotMatch(sql, /INSERT OR REPLACE/i);
  assert.doesNotMatch(sql, /DELETE FROM cloud_devices/i);
  assert.doesNotMatch(sql, /DELETE FROM device_commands/i);
  assert.doesNotMatch(sql, /DELETE FROM alerts/i);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(sql, /last_seen_at=excluded\.last_seen_at/);
  assert.match(sql, /INSERT INTO device_telemetry/);
  assert.match(sql, /DELETE FROM device_telemetry WHERE device_id='local-chamber' AND created_at</);
  assert.match(importSrc, /buildImportSql|writeImport/);
  assert.doesNotMatch(importSrc, /INSERT OR REPLACE/);
});

test("second import keeps commands, alerts-adjacent rows, and older readings", async () => {
  const db = createMemoryDb();
  await db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["local-chamber", "hw-local-chamber", "{}", "LAN chamber", "claimed", 1, null, null, null, 1, "2026-10-25T01:00:00Z", "2026-10-24T00:00:00Z"]
  );
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "local-chamber",
    "setpoints",
    JSON.stringify({ temperature_c: 16 }),
    "2026-10-25T01:00:00Z",
    null,
  ]);
  await db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    "local-chamber",
    JSON.stringify({ humidity: 88, temperature: 16 }),
    "2026-10-25T01:00:00Z",
  ]);
  const createdAt = "2026-10-24T00:00:00Z";
  await persistReadings({
    readings: { humidity: 90, temperature: 17 },
    chamberName: "LAN chamber",
    source: "http://192.168.1.42",
    deviceId: "local-chamber",
    userId: 1,
    now: Date.parse("2026-10-25T06:00:00Z"),
    db,
  });
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", ["local-chamber"]);
  assert.equal(device.created_at, createdAt);
  assert.equal(device.last_seen_at, "2026-10-25T06:00:00Z");
  const cmds = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["local-chamber"]);
  assert.equal(cmds.length, 1);
  const tel = await db.all("SELECT * FROM device_telemetry WHERE device_id=?", ["local-chamber"]);
  assert.equal(tel.length, 2);
});

test("poll prunes readings older than 14 days and backs off 5 minutes on error", async () => {
  const db = createMemoryDb();
  const now = Date.parse("2026-10-25T06:00:00Z");
  await writeImport(db, {
    deviceId: "local-chamber",
    name: "LAN chamber",
    userId: 1,
    document: { humidity: 80, temperature: 18 },
    created: "2026-10-01T00:00:00Z",
    now: Date.parse("2026-10-01T00:00:00Z"),
  });
  await writeImport(db, {
    deviceId: "local-chamber",
    name: "LAN chamber",
    userId: 1,
    document: { humidity: 90, temperature: 16 },
    created: "2026-10-25T06:00:00Z",
    now,
  });
  const tel = await db.all("SELECT * FROM device_telemetry WHERE device_id=?", ["local-chamber"]);
  assert.equal(tel.length, 1);
  assert.equal(JSON.parse(tel[0].document).humidity, 90);
  assert.equal(Date.parse(tel[0].created_at) > Date.parse(pruneBeforeIso(now)), true);
  assert.ok(now - Date.parse(pruneBeforeIso(now)) === READINGS_RETENTION_MS);
  assert.equal(nextPollDelay(true), POLL_INTERVAL_MS);
  assert.equal(nextPollDelay(false), ERROR_BACKOFF_MS);

  const sleeps = [];
  let ticks = 0;
  await runPollLoop({
    stop: () => ++ticks > 2,
    intervalMs: 1000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    collectReadings: async () => {
      throw new Error("chamber down");
    },
    log() {},
  });
  assert.ok(sleeps.includes(ERROR_BACKOFF_MS));
});
