import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryDb } from "../src/db.js";
import { nowIso } from "../src/crypto.js";
import { profileStageTargets } from "../src/coach.js";
import {
  BRIDGE_COMMAND_TTL_MS,
  BRIDGE_RATE_MS,
  BRIDGE_STALE_MS,
  bridgeCommandExpired,
  bridgeMode,
  chamberSetpointsUnreadable,
  missingFromSnapshot,
  chamberAuthHeader,
  expireStaleOnLiveStart,
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

test("schedule and light commands are refused until they have step and override checks", () => {
  const plan = planBridgeCommand({
    command: {
      id: 3,
      kind: "schedule",
      issued_at: nowIso(),
      payload: { sunrise_hour: 8, duration_hours: 12, white_led_lux: 200, red_percent: 10, green_percent: 0, blue_percent: 0 },
    },
    reading,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.mark, true);
  assert.match(plan.reason, /only setpoints/i);
  assert.match(plan.reason, /lights/i);
});

test("unread chamber setpoints refuse the write and mark the command failed", async () => {
  assert.match(chamberSetpointsUnreadable(null, { temperature_c: 16 }), /could not be read/i);
  const unread = planBridgeCommand({
    command: command(),
    stage: fruiting,
    reading: { temperature: 16.2, humidity: 87 },
  });
  assert.equal(unread.ok, false);
  assert.match(unread.reason, /setpoint could not be read/i);
  assert.equal(unread.mark, true);

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
    readChamber: async () => ({ temperature: 16, humidity: 88 }),
    applyWrites: async (writes) => {
      posts.push(...writes);
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(posts.length, 0);
  const left = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["local-chamber"]);
  assert.equal(left.length, 0);
  const marked = await db.all("SELECT * FROM device_commands WHERE device_id=?", ["local-chamber"]);
  assert.match(JSON.parse(marked[0].payload)._bridge.reason, /could not be read/i);
  assert.equal(JSON.parse(marked[0].payload)._bridge.status, "failed");
});

test("dry-run marks the row dry_run so it is never replayed", async () => {
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
  assert.equal(result.status, "dry_run");
  assert.equal(result.sent, false);
  assert.equal(posts.length, 0);
  const still = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["local-chamber"]);
  assert.equal(still.length, 0);
  const marked = await db.all("SELECT * FROM device_commands WHERE device_id=?", ["local-chamber"]);
  assert.equal(JSON.parse(marked[0].payload)._bridge.status, "dry_run");
  assert.equal(JSON.parse(marked[0].payload)._bridge.sent, false);
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
  const twenty = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(
    bridgeCommandExpired({ issued_at: new Date(twenty - 20 * 60 * 1000).toISOString(), payload: "{}" }, twenty),
    false
  );
  assert.equal(
    bridgeCommandExpired(
      { issued_at: new Date(twenty - BRIDGE_COMMAND_TTL_MS - 1000).toISOString(), payload: "{}" },
      twenty
    ),
    true
  );
  assert.equal(BRIDGE_STALE_MS, 30 * 60 * 1000);
});

test("live writes refuse commands that lack a from snapshot", async () => {
  assert.match(missingFromSnapshot({ temperature_c: 16 }), /from snapshot/i);
  assert.match(missingFromSnapshot({ from: {} }), /from snapshot/i);
  assert.equal(missingFromSnapshot({ from: { temperature_c: 16 } }), null);
  const noFrom = command({
    payload: JSON.stringify({ temperature_c: 16.5, humidity_percent: 88, source: "grow-coach-autopilot", approved: true }),
  });
  const parsed = JSON.parse(noFrom.payload);
  assert.equal(parsed.from, undefined);
  const plan = planBridgeCommand({ command: noFrom, stage: fruiting, reading });
  assert.equal(plan.ok, false);
  assert.equal(plan.mark, true);
  assert.match(plan.reason, /from snapshot/i);

  const db = createMemoryDb();
  await db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["local-chamber", "hw-local", "{}", "LAN", "claimed", 1, null, null, null, 1, nowIso(), nowIso()]
  );
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "local-chamber",
    "setpoints",
    noFrom.payload,
    nowIso(),
    null,
  ]);
  const posts = [];
  const live = await runBridgeCycle({
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
  assert.equal(live.ok, false);
  assert.equal(live.sent, false);
  assert.match(live.reason, /from snapshot/i);
  assert.equal(posts.length, 0);
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

test("rate-limit timestamp is recorded before the live write so a failed mark cannot bypass it", async () => {
  const db = createMemoryDb();
  await db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["local-chamber", "hw-local", "{}", "LAN", "claimed", 1, null, null, null, 1, nowIso(), nowIso()]
  );
  let state = {};
  const now = Date.parse("2026-10-25T12:00:00Z");
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "local-chamber",
    "setpoints",
    command().payload,
    new Date(now - 60_000).toISOString(),
    null,
  ]);
  const posts = [];
  await assert.rejects(
    () =>
      runBridgeCycle({
        ...memoryPending(db),
        env: { COACH_BRIDGE_LIVE: "1" },
        now,
        state,
        saveState: (next) => {
          state = { ...state, ...next };
        },
        stage: fruiting,
        readChamber: async () => reading,
        applyWrites: async (writes) => {
          posts.push(...writes);
          return { ok: true };
        },
        markCommand: async () => {
          throw new Error("mark failed");
        },
      }),
    /mark failed/
  );
  assert.ok(posts.length > 0);
  assert.equal(state.last_live_write_at, now);
  assert.equal(rateLimited(state, now + 60_000), true);

  const posts2 = [];
  const again = await runBridgeCycle({
    ...memoryPending(db),
    env: { COACH_BRIDGE_LIVE: "1" },
    now: now + 60_000,
    state,
    stage: fruiting,
    readChamber: async () => reading,
    applyWrites: async (writes) => {
      posts2.push(...writes);
      return { ok: true };
    },
  });
  assert.equal(again.skipped, "rate_limit");
  assert.equal(posts2.length, 0);
});

test("live start expires pending commands older than 30 minutes", async () => {
  const db = createMemoryDb();
  await db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["local-chamber", "hw-local", "{}", "LAN", "claimed", 1, null, null, null, 1, nowIso(), nowIso()]
  );
  const now = Date.parse("2026-10-25T12:00:00Z");
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "local-chamber",
    "setpoints",
    command().payload,
    new Date(now - 45 * 60 * 1000).toISOString(),
    null,
  ]);
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "local-chamber",
    "setpoints",
    command().payload,
    new Date(now - 5 * 60 * 1000).toISOString(),
    null,
  ]);
  const expired = await expireStaleOnLiveStart({
    now,
    listPendingAll: async () => db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["local-chamber"]),
    markCommand: async (row, result) => {
      await db.run("UPDATE device_commands SET consumed_at=?, payload=? WHERE id=? AND device_id=?", [
        new Date(now).toISOString(),
        JSON.stringify(withBridgeResult(row, result)),
        row.id,
        "local-chamber",
      ]);
    },
  });
  assert.equal(expired, 1);
  const open = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["local-chamber"]);
  assert.equal(open.length, 1);
  assert.ok(Date.parse(open[0].issued_at) > now - BRIDGE_STALE_MS);
});

test("httpApplyWrites posts number set and records nothing on mock refusal", async () => {
  const calls = [];
  const result = await httpApplyWrites(
    "http://192.168.1.42",
    [{ field: "temperature_target", value: 16, entityIds: ["temperature_target"] }],
    {
      fetchImpl: async (url, opts) => {
        calls.push({ url, method: opts.method, headers: opts.headers });
        return { ok: true };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/number\/temperature_target\/set\?value=16/);
  assert.equal(calls[0].headers?.authorization, undefined);
});

test("chamberAuthHeader is Basic admin:password and omitted without a password", () => {
  assert.equal(chamberAuthHeader({}), null);
  assert.equal(chamberAuthHeader({ COACH_CHAMBER_USER: "admin" }), null);
  assert.equal(chamberAuthHeader({ COACH_CHAMBER_PASSWORD: "" }), null);
  assert.equal(
    chamberAuthHeader({ COACH_CHAMBER_PASSWORD: "screen-secret" }),
    `Basic ${Buffer.from("admin:screen-secret").toString("base64")}`
  );
  assert.equal(
    chamberAuthHeader({ COACH_CHAMBER_USER: "op", COACH_CHAMBER_PASSWORD: "screen-secret" }),
    `Basic ${Buffer.from("op:screen-secret").toString("base64")}`
  );
});

test("httpApplyWrites sends authorization only when auth is set", async () => {
  const withAuth = [];
  const withoutAuth = [];
  const auth = chamberAuthHeader({ COACH_CHAMBER_PASSWORD: "screen-secret" });
  await httpApplyWrites(
    "http://192.168.1.42",
    [{ field: "temperature_target", value: 16, entityIds: ["temperature__target"] }],
    {
      auth,
      fetchImpl: async (_url, opts) => {
        withAuth.push(opts.headers);
        return { ok: true };
      },
    }
  );
  await httpApplyWrites(
    "http://192.168.1.42",
    [{ field: "temperature_target", value: 16, entityIds: ["temperature__target"] }],
    {
      fetchImpl: async (_url, opts) => {
        withoutAuth.push(opts.headers);
        return { ok: true };
      },
    }
  );
  assert.equal(withAuth[0].authorization, auth);
  assert.equal(withoutAuth[0].authorization, undefined);
});

test("httpApplyWrites records 401 and does not retry the second firmware id", async () => {
  const calls = [];
  const result = await httpApplyWrites(
    "http://192.168.1.42",
    [
      {
        field: "temperature_target",
        value: 16,
        entityIds: ["temperature__target", "temperature_target"],
      },
    ],
    {
      auth: chamberAuthHeader({ COACH_CHAMBER_PASSWORD: "wrong" }),
      fetchImpl: async (url, opts) => {
        calls.push({ url, authorization: opts.headers?.authorization });
        return { ok: false, status: 401 };
      },
    }
  );
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/number\/temperature__target\/set/);
  assert.equal(result.failed[0].error, "chamber web password missing or wrong (401)");
  assert.equal(result.error, "chamber web password missing or wrong (401)");
  assert.equal(result.failed[0].entity_id, null);
});

test("httpApplyWrites records HTTP status or error name on non-auth failures", async () => {
  const http = await httpApplyWrites(
    "http://192.168.1.42",
    [{ field: "target_humidity", value: 88, entityIds: ["target_humidity"] }],
    { fetchImpl: async () => ({ ok: false, status: 500 }) }
  );
  assert.equal(http.failed[0].error, "HTTP 500");

  let forbiddenCalls = 0;
  const forbidden = await httpApplyWrites(
    "http://192.168.1.42",
    [{ field: "temperature_target", value: 16, entityIds: ["temperature__target", "temperature_target"] }],
    {
      fetchImpl: async () => {
        forbiddenCalls += 1;
        return { ok: false, status: 403 };
      },
    }
  );
  assert.equal(forbidden.failed[0].error, "HTTP 403");
  assert.equal(forbiddenCalls, 1);

  const crashed = await httpApplyWrites(
    "http://192.168.1.42",
    [{ field: "target_humidity", value: 88, entityIds: ["target_humidity"] }],
    {
      fetchImpl: async () => {
        const err = new Error("offline");
        err.name = "AbortError";
        throw err;
      },
    }
  );
  assert.equal(crashed.failed[0].error, "AbortError");
});

test("plan prefers temperature__target then falls back to temperature_target", () => {
  const plan = planBridgeCommand({ command: command(), stage: fruiting, reading });
  const temp = plan.writes.find((w) => w.field === "temperature_target");
  assert.deepEqual(temp.entityIds, ["temperature__target", "temperature_target"]);
});

test("live cycle logs the chamber write error instead of a generic failure", async () => {
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
  const logs = [];
  await runBridgeCycle({
    ...memoryPending(db),
    env: { COACH_BRIDGE_LIVE: "1" },
    state: {},
    stage: fruiting,
    readChamber: async () => reading,
    applyWrites: async () => ({
      ok: false,
      applied: [],
      failed: [
        {
          field: "temperature_target",
          value: 16,
          entity_id: null,
          error: "chamber web password missing or wrong (401)",
        },
      ],
      error: "chamber web password missing or wrong (401)",
    }),
    log: (event) => logs.push(event),
  });
  assert.equal(logs[0].action, "failed");
  assert.equal(logs[0].reason, "chamber web password missing or wrong (401)");
  assert.doesNotMatch(JSON.stringify(logs[0]), /authorization|screen-secret|COACH_CHAMBER_PASSWORD=/i);
  const marked = await db.all("SELECT * FROM device_commands WHERE device_id=?", ["local-chamber"]);
  assert.equal(JSON.parse(marked[0].payload)._bridge.reason, "chamber web password missing or wrong (401)");
});

test("bridge refuses a device whose Autopilot delivery is cloud", async () => {
  const cloudCmd = command({
    payload: {
      temperature_c: 16.5,
      humidity_percent: 88,
      from: { temperature_c: 16, humidity_percent: 88 },
      source: "grow-coach-autopilot",
      delivery: "cloud",
    },
  });
  const byPayload = planBridgeCommand({ command: cloudCmd, stage: fruiting, reading });
  assert.equal(byPayload.ok, false);
  assert.equal(byPayload.mark, false);
  assert.match(byPayload.reason, /cloud delivery/i);

  const byId = planBridgeCommand({
    command: command(),
    stage: fruiting,
    reading,
    device: { id: "sldev_abc" },
  });
  assert.equal(byId.ok, false);
  assert.equal(byId.mark, false);

  const db = createMemoryDb();
  await db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["sldev_live", "hw-live", "{}", "Kitchen", "active", 1, null, null, null, 1, nowIso(), nowIso()]
  );
  await db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
    "sldev_live",
    "setpoints",
    cloudCmd.payload,
    nowIso(),
    null,
  ]);
  const posts = [];
  const result = await runBridgeCycle({
    ...memoryPending(db, "sldev_live"),
    env: { COACH_BRIDGE_LIVE: "1" },
    device: { id: "sldev_live" },
    deviceMode: { delivery: "cloud" },
    stage: fruiting,
    readChamber: async () => reading,
    applyWrites: async (writes) => {
      posts.push(...writes);
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "skipped");
  assert.equal(posts.length, 0);
  const left = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", ["sldev_live"]);
  assert.equal(left.length, 1);
});
