import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import { autopilotChanges, autopilotDecider, describeAutopilotAction } from "../src/coach-autopilot.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", COACH_AUTOPILOT_ENABLED: "1", ...extra });
}

async function subscribe(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(
    ctx,
    stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id })
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
}

async function addDevice(ctx, userId, id, { name = "Kitchen", lastSeen = nowIso() } = {}) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", name, "active", userId, null, null, null, 1, lastSeen, nowIso()]
  );
}

async function addReading(ctx, deviceId, doc) {
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [deviceId, JSON.stringify(doc), nowIso()]);
}

async function addProfile(ctx, userId, profile) {
  await ctx.db.run("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    profile.id,
    JSON.stringify(profile),
    userId,
    1,
    nowIso(),
    nowIso(),
  ]);
}

async function setMode(ctx, token, deviceId, mode, profileId) {
  const res = await call(ctx, "POST", "/api/coach/autopilot/mode", { token, body: { device_id: deviceId, mode, profile_id: profileId } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
}

test("decision changes read from and to per knob, and swap for rows that did not apply", () => {
  const applied = autopilotChanges(
    "apply",
    { temperature_c: 17, humidity_percent: 90, fan_speed_percent: 30, air_exchange_speed: 30, light_hours: 5, grow_phase: "Colonizing" },
    { temperature_c: 17, humidity_percent: 90, air_exchange_speed: 25, light_hours: 10, grow_phase: "Fruiting" }
  );
  assert.deepEqual(
    applied.map((c) => [c.key, c.from, c.to]),
    [
      ["fan", 30, 25],
      ["light_hours", 5, 10],
      ["grow_phase", "Colonizing", "Fruiting"],
    ]
  );
  assert.equal(applied[0].label, "Fan");
  assert.equal(applied[0].unit, "%");
  const expired = autopilotChanges("expired", { temperature_c: 18 }, { temperature_c: 19 });
  assert.deepEqual(expired.map((c) => [c.key, c.from, c.to]), [["temperature_c", 19, 18]]);
  assert.deepEqual(autopilotChanges("pause", null, null), []);
});

test("decider says Jev with confidence for Jev rows and rules otherwise", () => {
  const jev = autopilotDecider({
    temperature: 21,
    decider: {
      decider: "jev",
      model: "jev-1",
      knobs: {
        temperature: { choice: "lower", confidence: 0.91, used: "jev" },
        humidity: { choice: "hold", confidence: 0.84, used: "jev" },
        fan: { choice: "raise", confidence: 0.4, used: "rules" },
      },
    },
  });
  assert.equal(jev.who, "jev");
  assert.equal(jev.model, "jev-1");
  assert.equal(jev.confidence, 0.84);
  assert.equal(autopilotDecider({ temperature: 21 }).who, "rules");
  assert.equal(autopilotDecider({ decider: { decider: "rules", wanted: "jev", fallback: "no_key" } }).fallback, "no_key");
  const row = describeAutopilotAction({
    id: 4,
    device_id: "d",
    action: "apply",
    old_value: JSON.stringify({ temperature_c: 19, humidity_percent: 90 }),
    new_value: JSON.stringify({ temperature_c: 18, humidity_percent: 90 }),
    reason: "Warm.",
    readings: JSON.stringify({ decider: { decider: "jev", knobs: { temperature: { choice: "lower", confidence: 0.9, used: "jev" } } } }),
    apply_status: "applied",
    created_at: nowIso(),
  });
  assert.equal(row.changes[0].confidence, 0.9);
  assert.equal(row.outcome, "applied");
  assert.equal(row.undoable, true);
  assert.equal(describeAutopilotAction({ ...row, old_value: null, new_value: null, action: "pause", apply_status: null }).undoable, false);
});

test("overview and decisions need Coach access", async () => {
  const ctx = env();
  const { token } = await register(ctx, "nobody@example.com");
  assert.equal((await call(ctx, "GET", "/api/coach/overview", { token })).status, 404);
  assert.equal((await call(ctx, "GET", "/api/coach/decisions", { token })).status, 404);
  assert.equal((await call(ctx, "GET", "/api/coach/overview")).status, 401);
});

test("overview shows status, mode, and a recommendation per chamber; off-menu chambers get no Coach", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "page@example.com");
  await subscribe(ctx, token);
  await addProfile(ctx, user.id, pearlOyster);
  await addProfile(ctx, user.id, { id: "psi-cube", name: "Cube", pack: "psilocybin", restricted: true, tags: ["psilocybin"], stages: [] });
  await addDevice(ctx, user.id, "dev-a", { name: "Kitchen" });
  await addDevice(ctx, user.id, "dev-b", { name: "Shelf", lastSeen: null });
  await addReading(ctx, "dev-a", { humidity: 88, humidity_setpoint: 90, temperature: 22.76, temperature_setpoint: 24 });
  await setMode(ctx, token, "dev-a", "advisor", pearlOyster.id);
  await ctx.db.run(
    "INSERT INTO coach_device_mode (device_id, user_id, mode, paused, pause_reason, pause_until, profile_id, last_change_at, changes_day, changes_count, last_setpoints, last_manual_at, pending_command_id, delivery, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["dev-b", user.id, "advisor", 0, null, null, "psi-cube", null, null, 0, null, null, null, null, nowIso()]
  );

  const res = await call(ctx, "GET", "/api/coach/overview", { token });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const [a, b] = res.data.chambers;
  assert.equal(a.device.name, "Kitchen");
  assert.equal(a.autopilot.mode, "advisor");
  assert.equal(a.recommendation.profile_id, pearlOyster.id);
  assert.ok(a.recommendation.suggestion, JSON.stringify(a.recommendation));
  assert.equal(a.recommendation.differs, true);
  assert.ok(a.device.targets.temperature_max != null);
  assert.equal(b.device.name, "Shelf");
  assert.equal(b.device.off_menu, true);
  assert.equal(b.autopilot, null);
  assert.equal(b.recommendation, null);
  assert.equal(b.device.profile, null);
  assert.equal(b.device.last_seen_at, null);
  assert.ok(!JSON.stringify(b).includes("psi-cube"));
});

test("decisions page newest first across chambers with load more, and Undo flags", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "feed@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-a", { name: "Kitchen" });
  await addDevice(ctx, user.id, "dev-b", { name: "Shelf" });
  const ins = (deviceId, action, status, oldValue, newValue) =>
    ctx.db.run(
      "INSERT INTO coach_autopilot_log (device_id, user_id, action, old_value, new_value, reason, readings, undone_at, command_id, apply_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [deviceId, user.id, action, oldValue && JSON.stringify(oldValue), newValue && JSON.stringify(newValue), "Because.", null, null, null, status, nowIso()]
    );
  for (let i = 0; i < 7; i += 1) {
    await ins(i % 2 ? "dev-b" : "dev-a", "apply", "applied", { temperature_c: 20 - i }, { temperature_c: 19 - i });
  }
  await ins("dev-a", "pause", null, null, null);
  await ins("dev-other", "apply", "applied", { temperature_c: 1 }, { temperature_c: 2 });

  const first = await call(ctx, "GET", "/api/coach/decisions?limit=5", { token });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.deepEqual(first.data.decisions.map((d) => d.id), [8, 7, 6, 5, 4]);
  assert.equal(first.data.decisions[0].action, "pause");
  assert.equal(first.data.decisions[0].undoable, false);
  assert.equal(first.data.decisions[1].undoable, true);
  assert.equal(first.data.decisions[2].device_name, "Shelf");
  assert.equal(first.data.has_more, true);
  assert.equal(first.data.next_before, 4);
  const second = await call(ctx, "GET", `/api/coach/decisions?limit=5&before=${first.data.next_before}`, { token });
  assert.deepEqual(second.data.decisions.map((d) => d.id), [3, 2, 1]);
  assert.equal(second.data.has_more, false);
  const one = await call(ctx, "GET", "/api/coach/decisions?device_id=dev-b", { token });
  assert.ok(one.data.decisions.every((d) => d.device_id === "dev-b"));
  assert.equal(one.data.decisions.length, 3);
});
