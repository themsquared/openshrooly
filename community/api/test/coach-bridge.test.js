import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryDb } from "../src/db.js";
import { nowIso } from "../src/crypto.js";
import { profileStageTargets } from "../src/coach.js";
import {
  BRIDGE_RATE_MS,
  bridgeCommandExpired,
  bridgeMode,
  httpApplyWrites,
  planBridgeCommand,
  rateLimited,
  runBridgeCycle,
  withBridgeResult,
} from "../src/coach-bridge.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);
const fruiting = profileStageTargets((pearlOyster.stages || []).find((s) => s.id === "fruiting") || pearlOyster.stages[0]);

function command(overrides = {}) {
  return {
    id: 1,
    device_id: "local-chamber",
    kind: "setpoints",
    issued_at: nowIso(),
    consumed_at: null,
    payload: JSON.stringify({
      temperature_c: 16.5,
      humidity_percent: 88,
      from: { temperature_c: 16, humidity_percent: 88 },
      source: "grow-coach-autopilot",
      approved: true,
    }),
    ...overrides,
    payload: overrides.payload
      ? typeof overrides.payload === "string"
        ? overrides.payload
        : JSON.stringify(overrides.payload)
      : JSON.stringify({
          temperature_c: 16.5,
          humidity_percent: 88,
          from: { temperature_c: 16, humidity_percent: 88 },
          source: "grow-coach-autopilot",
          approved: true,
          ...(typeof overrides.payload === "object" ? overrides.payload : {}),
        }),
  };
}

const reading = { temperature: 16.2, humidity: 87, temperature_setpoint: 16, humidity_setpoint: 88 };

function memoryPending(db, deviceId = "local-chamber") {
  return {
    async listPending() {
      return db.all(
        "SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL ORDER BY id ASC LIMIT ?",
        [deviceId, 1]
      );
    },
    async markCommand(row, result) {
      await db.run("UPDATE device_commands SET consumed_at=?, payload=? WHERE id=? AND device_id=?", [
        nowIso(),
        JSON.stringify(withBridgeResult(row, result)),
        row.id,
        deviceId,
      ]);
    },
  };
}

test("bridge re-validates clamps to the profile stage range and step limit", () => {
  const plan = planBridgeCommand({
    command: command({ payload: { temperature_c: 24, humidity_percent: 99, from: { temperature_c: 16, humidity_percent: 88 } } }),
    stage: fruiting,
    reading,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.applied.temperature_c, fruiting.temperature_target_max);
  assert.equal(plan.applied.humidity_percent, fruiting.humidity_target_max);
  assert.ok(plan.writes.every((w) => w.field === "temperature_target" || w.field === "target_humidity"));
  assert.ok(!plan.writes.some((w) => /fan/i.test(w.field)));
});

test("invalid light payloads are refused; valid lights become number writes", () => {
  const bad = planBridgeCommand({
    command: { id: 2, kind: "schedule", issued_at: nowIso(), payload: { sunrise_hour: 30 } },
    reading,
  });
  assert.equal(bad.ok, false);
  const ok = planBridgeCommand({
    command: {
      id: 3,
      kind: "schedule",
      issued_at: nowIso(),
      payload: { sunrise_hour: 8, duration_hours: 12, white_led_lux: 200, red_percent: 10, green_percent: 0, blue_percent: 0 },
    },
    reading,
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.writes.some((w) => w.field === "sunrise_hour" && w.value === 8));
});

test("dry-run sends nothing and leaves the row pending", async () => {
  const db = createMemoryDb();
  await db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["local-chamber", "hw-local", "{}", "LAN", "claimed", 1, null, null, null, 1, nowIso(), nowIso()]
  );
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "local-chamber",
    "setpoints",
    command().payload,
    nowIso(),
    null,
  ]);
  const posts = [];
  const result = await runBridgeCycle({
    ...memoryPending(db),
    env: { DRY_RUN: "1" },
    stage: fruiting,
    readChamber: async () => reading,
    applyWrites: async (writes) => {
      posts.push(...writes);
      return { ok: true };
    },
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.sent, false);
  assert.equal(posts.length, 0);
  const still = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["local-chamber"]);
  assert.equal(still.length, 1);
  assert.equal(bridgeMode({}), "dry-run");
  assert.equal(bridgeMode({ COACH_BRIDGE_LIVE: "1", DRY_RUN: "1" }), "dry-run");
});

test("expired commands are refused", () => {
  const expired = planBridgeCommand({
    command: command({
      issued_at: "2026-10-20T00:00:00Z",
      payload: { temperature_c: 16, expires_at: "2026-10-24T00:00:00Z" },
    }),
    stage: fruiting,
    reading,
    now: Date.parse("2026-10-25T00:00:00Z"),
  });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /expired/i);
  assert.equal(
    bridgeCommandExpired({ issued_at: "2026-10-20T00:00:00Z", payload: "{}" }, Date.parse("2026-10-25T12:00:00Z")),
    true
  );
});

test("manual override wins when the chamber setpoint moved", () => {
  const plan = planBridgeCommand({
    command: command(),
    stage: fruiting,
    reading: { ...reading, temperature_setpoint: 18, humidity_setpoint: 80 },
  });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /manual override/i);
});

test("live writes honor the 10 minute rate limit and the kill switch", async () => {
  const db = createMemoryDb();
  await db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["local-chamber", "hw-local", "{}", "LAN", "claimed", 1, null, null, null, 1, nowIso(), nowIso()]
  );
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "local-chamber",
    "setpoints",
    command().payload,
    nowIso(),
    null,
  ]);
  const posts = [];
  const killed = await runBridgeCycle({
    ...memoryPending(db),
    env: { COACH_BRIDGE_LIVE: "1" },
    killSwitch: true,
    stage: fruiting,
    readChamber: async () => reading,
    applyWrites: async (writes) => {
      posts.push(...writes);
      return { ok: true };
    },
  });
  assert.equal(killed.skipped, "kill_switch");
  assert.equal(posts.length, 0);

  const limited = await runBridgeCycle({
    ...memoryPending(db),
    env: { COACH_BRIDGE_LIVE: "1" },
    state: { last_live_write_at: Date.now() - 60_000 },
    stage: fruiting,
    readChamber: async () => reading,
    applyWrites: async (writes) => {
      posts.push(...writes);
      return { ok: true };
    },
  });
  assert.equal(limited.skipped, "rate_limit");
  assert.equal(posts.length, 0);
  assert.equal(rateLimited({ last_live_write_at: Date.now() - 60_000 }), true);
  assert.equal(rateLimited({ last_live_write_at: Date.now() - BRIDGE_RATE_MS - 1 }), false);

  const applied = await runBridgeCycle({
    ...memoryPending(db),
    env: { COACH_BRIDGE_LIVE: "1" },
    state: {},
    stage: fruiting,
    readChamber: async () => reading,
    applyWrites: async (writes) => {
      posts.push(...writes);
      return { ok: true };
    },
  });
  assert.equal(applied.sent, true);
  assert.ok(posts.length > 0);
  const left = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["local-chamber"]);
  assert.equal(left.length, 0);
});

test("httpApplyWrites posts number set and records nothing on mock refusal", async () => {
  const calls = [];
  const result = await httpApplyWrites(
    "http://192.168.1.42",
    [{ field: "temperature_target", value: 16, entityIds: ["temperature_target"] }],
    {
      fetchImpl: async (url, opts) => {
        calls.push({ url, method: opts.method });
        return { ok: true };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/number\/temperature_target\/set\?value=16/);
});
