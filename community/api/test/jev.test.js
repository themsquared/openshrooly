import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import { getDeviceMode, runAutopilotForDevice, setDeviceAutopilotMode } from "../src/coach-autopilot.js";
import {
  JEV_QUESTIONS,
  JEV_URL,
  applyJevDecision,
  askJev,
  buildSeries,
  deciderMode,
  jevCapBlock,
  lightRangeFor,
  recordJevCall,
} from "../src/jev.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);

const choice = (c, p) => {
  const rest = (1 - p) / 2;
  const probabilities = { raise: rest, hold: rest, lower: rest, [c]: p };
  return { type: "choice", choice: c, confidence: (3 * p - 1) / 2, probabilities };
};

function answers({ temperature = choice("hold", 0.9), humidity = choice("hold", 0.9), fan = choice("hold", 0.9), light = choice("hold", 0.9), abnormal = 0.05 } = {}) {
  return { temperature, humidity, fan, light, abnormal: { type: "noul", noul: abnormal } };
}

function mockFetch(body, { status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", COACH_AUTOPILOT_ENABLED: "1", ...extra });
}

async function subscribe(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(ctx, stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id }));
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
}

/** A chamber on Autopilot with one fresh reading. Returns what a pass needs. */
async function chamber(ctx, email, deviceId, reading = {}) {
  const { token, user } = await register(ctx, email);
  await subscribe(ctx, token);
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [deviceId, `hw-${deviceId}`, "{}", "Kitchen", "active", user.id, null, null, null, 1, nowIso(), nowIso()]
  );
  await ctx.db.run("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    pearlOyster.id,
    JSON.stringify(pearlOyster),
    user.id,
    1,
    nowIso(),
    nowIso(),
  ]);
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    deviceId,
    JSON.stringify({ humidity: 88, humidity_setpoint: 88, temperature: 16, temperature_setpoint: 16, ...reading }),
    nowIso(),
  ]);
  const enabled = await setDeviceAutopilotMode(ctx.db, ctx, user, { deviceId, mode: "autopilot", profileId: pearlOyster.id });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const device = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  return { token, user, device };
}

async function pendingPayloads(ctx, deviceId) {
  const rows = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", [deviceId]);
  return rows.map((r) => JSON.parse(r.payload));
}

test("the flag defaults to rules", () => {
  assert.equal(deciderMode({}), "rules");
  assert.equal(deciderMode({ AUTOPILOT_DECIDER: "rules" }), "rules");
  assert.equal(deciderMode({ AUTOPILOT_DECIDER: "nonsense" }), "rules");
  assert.equal(deciderMode({ AUTOPILOT_DECIDER: "jev" }), "jev");
});

test("askJev sends every question in one request with the bearer key", async () => {
  const fetchImpl = mockFetch({ model: "jev-1.14.0", answers: answers(), usage: { input_tokens: 1234, output_tokens: 40 } });
  const res = await askJev({ TYPESAFE_API_KEY: "sk-test" }, { a: 1 }, { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.usage.input_tokens, 1234);
  assert.equal(fetchImpl.calls.length, 1);
  const sent = fetchImpl.calls[0];
  assert.equal(sent.url, JEV_URL);
  assert.equal(sent.init.headers.authorization, "Bearer sk-test");
  assert.equal(sent.body.model, "jev-1.14.0");
  assert.deepEqual(Object.keys(sent.body.questions).sort(), ["abnormal", "fan", "humidity", "light", "temperature"]);
  for (const k of ["temperature", "humidity", "fan", "light"]) {
    assert.equal(JEV_QUESTIONS[k].type, "choice");
    assert.deepEqual(Object.keys(JEV_QUESTIONS[k].criteria), ["raise", "hold", "lower"]);
  }
  assert.equal(JEV_QUESTIONS.abnormal.type, "noul");
});

test("askJev falls back cleanly: no key, HTTP error, network error, timeout", async () => {
  let called = false;
  const never = async () => {
    called = true;
  };
  assert.deepEqual(await askJev({}, {}, { fetchImpl: never }), { ok: false, error: "no_key" });
  assert.equal(called, false);
  const k = { TYPESAFE_API_KEY: "sk-test" };
  assert.equal((await askJev(k, {}, { fetchImpl: mockFetch({}, { status: 429 }) })).error, "http_429");
  assert.equal((await askJev(k, {}, { fetchImpl: async () => { throw new TypeError("boom"); } })).error, "network");
  const hang = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const timed = await askJev(k, {}, { fetchImpl: hang, timeoutMs: 20 });
  assert.equal(timed.error, "timeout");
  assert.equal((await askJev(k, {}, { fetchImpl: mockFetch({ nope: 1 }) })).error, "bad_response");
});

test("policy: confident answers move one fixed step, unsure ones keep the rules value", () => {
  const rules = { temperature_c: 17, humidity_percent: 90, fan_speed_percent: 45, reasons: ["rules"] };
  const setpoints = { temperature_c: 16, humidity_percent: 88, fan_speed_percent: 40 };
  const out = applyJevDecision({
    answers: answers({
      temperature: choice("lower", 0.95),
      humidity: choice("raise", 0.9),
      fan: choice("raise", 0.5), // confidence 0.25, under the threshold
      light: choice("raise", 0.95),
    }),
    rules,
    setpoints,
    knobs: { white_intensity: 90 },
    lightRange: [46, 138],
  });
  assert.equal(out.suggestion.temperature_c, 15.5);
  assert.equal(out.suggestion.humidity_percent, 90);
  assert.equal(out.suggestion.fan_speed_percent, 45, "falls back to the rules fan value");
  assert.equal(out.light, 138, "light is clamped to the recipe band");
  assert.equal(out.audit.knobs.fan.used, "rules");
  assert.equal(out.audit.knobs.temperature.used, "jev");
  assert.ok(out.audit.knobs.humidity.probabilities.raise > 0.8);
  assert.equal(out.pause, false);
  const held = applyJevDecision({ answers: answers({ humidity: choice("hold", 0.9) }), rules, setpoints });
  assert.equal(held.suggestion.humidity_percent, 88, "confident hold keeps the current setpoint");
  assert.equal(applyJevDecision({ answers: answers({ abnormal: 0.9 }), rules, setpoints }).pause, true);
  assert.equal(applyJevDecision({ answers: answers({ abnormal: 0.6 }), rules, setpoints }).pause, false);
  const strict = applyJevDecision({
    answers: answers({ humidity: choice("raise", 0.9) }),
    rules,
    setpoints,
    policy: { minConfidence: 0.95, abnormalPause: 0.85, steps: { humidity_percent: 2 } },
  });
  assert.equal(strict.suggestion.humidity_percent, 90, "under a stricter threshold the rules value stands");
  assert.deepEqual(lightRangeFor(92, [0, 4000]), [46, 138]);
  assert.equal(lightRangeFor(null), null);
});

test("series covers every numeric feed, bucketed and columnar", () => {
  const now = Date.parse("2026-10-26T18:30:00Z");
  const rows = [];
  for (let i = 0; i < 30; i++) {
    rows.push({
      created_at: new Date(now - i * 15 * 60000).toISOString(),
      document: JSON.stringify({ temperature: 20 + i * 0.01, temperature_c: 20, humidity: 90, water_level: 70, air_exchange_speed: 25, white_intensity: 200, sunrise_hour: 8, light_hours: 10, co2: 800, firmware_version: "x" }),
    });
  }
  const s = buildSeries(rows, { now, hours: 6, bucketMin: 30 });
  assert.equal(s.rows.length, 12);
  for (const col of ["temperature", "humidity", "water_level", "air_exchange_speed", "white_intensity", "co2", "light_on"]) {
    assert.ok(s.cols.includes(col), col);
  }
  assert.ok(!s.cols.includes("temperature_c"), "aliases are dropped");
  assert.ok(!s.cols.includes("firmware_version"));
  assert.equal(s.rows[s.rows.length - 1][0], 0, "newest bucket last");
});

test("rules flag never calls Jev", async () => {
  const ctx = env({ TYPESAFE_API_KEY: "sk-test" });
  const fetchImpl = mockFetch({ answers: answers(), usage: {} });
  ctx.JEV_FETCH = fetchImpl;
  const { user, device } = await chamber(ctx, "jev-rules@example.com", "dev-jev-rules", { humidity: 80 });
  const result = await runAutopilotForDevice(ctx.db, ctx, { device, user });
  assert.equal(fetchImpl.calls.length, 0);
  assert.notEqual(result.decider?.decider, "jev");
});

test("Jev nudges humidity, clamped to the stage guardrail, and the audit log keeps the probabilities", async () => {
  const fetchImpl = mockFetch({ model: "jev-1.14.0", answers: answers({ humidity: choice("raise", 0.95) }), usage: { input_tokens: 2000, output_tokens: 50 } });
  const ctx = env({ AUTOPILOT_DECIDER: "jev", TYPESAFE_API_KEY: "sk-test", JEV_FETCH: fetchImpl });
  // Setpoint already at the top of the guardrail: a confident raise must not push past it.
  const { user, device } = await chamber(ctx, "jev-clamp@example.com", "dev-jev-clamp", { humidity: 84, humidity_setpoint: 90, temperature: 16, temperature_setpoint: 16 });
  const result = await runAutopilotForDevice(ctx.db, ctx, { device, user });
  assert.equal(fetchImpl.calls.length, 1);
  const sentState = fetchImpl.calls[0].body.state;
  assert.ok(sentState.series.cols.includes("humidity"));
  assert.ok(Array.isArray(sentState.guardrails.humidity_percent));
  assert.equal(JSON.stringify(sentState).includes("sk-test"), false, "the key never rides in the state");
  assert.equal(JSON.stringify(sentState).includes(user.email), false);
  const rhMax = sentState.guardrails.humidity_percent[1];
  assert.equal(result.decider.decider, "jev");
  assert.equal(rhMax, 90);
  assert.equal(result.applied, undefined, "already at the guardrail, so a raise changes nothing");
  assert.equal(result.skipped, "no_change", JSON.stringify(result));
  assert.equal((await pendingPayloads(ctx, "dev-jev-clamp")).length, 0);
  const ctx2 = env({ AUTOPILOT_DECIDER: "jev", TYPESAFE_API_KEY: "sk-test", JEV_FETCH: fetchImpl });
  const two = await chamber(ctx2, "jev-raise@example.com", "dev-jev-raise", { humidity: 84, humidity_setpoint: 86, temperature: 16, temperature_setpoint: 16 });
  const applied = await runAutopilotForDevice(ctx2.db, ctx2, { device: two.device, user: two.user });
  assert.equal(applied.applied, true, JSON.stringify(applied));
  const [payload] = await pendingPayloads(ctx2, "dev-jev-raise");
  assert.equal(payload.humidity_percent, 88, "one fixed 2-point step");
  const ttl = Date.parse(payload.expires_at) - Date.now();
  assert.ok(ttl > 110 * 60000 && ttl <= 120 * 60000, "the 2-hour command expiry still applies");
  const log = await ctx2.db.all("SELECT * FROM coach_autopilot_log WHERE device_id=? ORDER BY id DESC LIMIT ?", ["dev-jev-raise", 5]);
  const apply = log.find((r) => r.action === "apply");
  const readings = JSON.parse(apply.readings);
  assert.equal(readings.decider.decider, "jev");
  assert.equal(readings.decider.model, "jev-1.14.0");
  assert.equal(readings.decider.knobs.humidity.choice, "raise");
  assert.ok(readings.decider.knobs.humidity.probabilities.raise >= 0.9);
  assert.equal(readings.decider.usage.input_tokens, 2000);
  assert.match(apply.reason, /Jev: raise humidity/);
});

test("Jev errors fall back to the rules decision", async () => {
  const boom = async () => {
    throw new TypeError("network down");
  };
  const jevCtx = env({ AUTOPILOT_DECIDER: "jev", TYPESAFE_API_KEY: "sk-test", JEV_FETCH: boom });
  const a = await chamber(jevCtx, "jev-fail@example.com", "dev-jev-fail", { humidity: 80, humidity_setpoint: 84 });
  const viaJev = await runAutopilotForDevice(jevCtx.db, jevCtx, { device: a.device, user: a.user });
  const rulesCtx = env();
  const b = await chamber(rulesCtx, "jev-fail-rules@example.com", "dev-jev-fail", { humidity: 80, humidity_setpoint: 84 });
  const viaRules = await runAutopilotForDevice(rulesCtx.db, rulesCtx, { device: b.device, user: b.user });
  assert.equal(viaJev.decider.fallback, "network");
  assert.deepEqual(viaJev.next, viaRules.next);
  const noKey = env({ AUTOPILOT_DECIDER: "jev" });
  const c = await chamber(noKey, "jev-nokey@example.com", "dev-jev-nokey", { humidity: 80, humidity_setpoint: 84 });
  const viaNoKey = await runAutopilotForDevice(noKey.db, noKey, { device: c.device, user: c.user });
  assert.equal(viaNoKey.decider.fallback, "no_key");
  assert.deepEqual(viaNoKey.next, viaRules.next);
});

test("abnormal readings from Jev pause Autopilot to Advisor", async () => {
  const fetchImpl = mockFetch({ answers: answers({ abnormal: 0.97, humidity: choice("raise", 0.95) }), usage: { input_tokens: 10 } });
  const ctx = env({ AUTOPILOT_DECIDER: "jev", TYPESAFE_API_KEY: "sk-test", JEV_FETCH: fetchImpl });
  const { token, user, device } = await chamber(ctx, "jev-odd@example.com", "dev-jev-odd", { humidity: 84, humidity_setpoint: 86 });
  const result = await runAutopilotForDevice(ctx.db, ctx, { device, user });
  assert.equal(result.paused, true);
  assert.equal(result.flipped_to, "advisor");
  assert.match(result.reason, /abnormal/);
  assert.equal((await pendingPayloads(ctx, "dev-jev-odd")).length, 0);
  const status = await call(ctx, "GET", "/api/coach/autopilot?device_id=dev-jev-odd", { token });
  assert.equal(status.data.mode, "advisor");
  assert.equal(status.data.status, "paused");
});

test("Off-menu profiles are refused before Jev is asked", async () => {
  const fetchImpl = mockFetch({ answers: answers({ humidity: choice("raise", 0.95) }), usage: {} });
  const ctx = env({ AUTOPILOT_DECIDER: "jev", TYPESAFE_API_KEY: "sk-test", JEV_FETCH: fetchImpl });
  const { user, device } = await chamber(ctx, "jev-psi@example.com", "dev-jev-psi", { humidity: 84, humidity_setpoint: 86 });
  await ctx.db.run("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    "psi-cube",
    JSON.stringify({ id: "psi-cube", pack: "psilocybin", restricted: true, tags: ["psilocybin"], stages: [{ id: "fruiting", humidity_percent: 90 }] }),
    user.id,
    1,
    nowIso(),
    nowIso(),
  ]);
  const saved = await getDeviceMode(ctx.db, "dev-jev-psi", user.id);
  saved.profile_id = "psi-cube";
  const result = await runAutopilotForDevice(ctx.db, ctx, { device, user });
  assert.equal(result.paused, true);
  assert.match(result.reason, /not allowed/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("per-device caps stop calls and fall back to rules", async () => {
  const ctx = env();
  const now = Date.parse("2026-10-26T12:00:00Z");
  assert.equal(await jevCapBlock(ctx.db, {}, "d1", now), null);
  await recordJevCall(ctx.db, "d1", { input_tokens: 3000 }, now);
  assert.equal(await jevCapBlock(ctx.db, {}, "d1", now + 60000), "min_interval");
  assert.equal(await jevCapBlock(ctx.db, {}, "d1", now + 31 * 60000), null);
  assert.equal(await jevCapBlock(ctx.db, { JEV_DAILY_CALLS_PER_DEVICE: "1" }, "d1", now + 31 * 60000), "daily_calls_cap");
  assert.equal(await jevCapBlock(ctx.db, { JEV_DAILY_TOKENS_PER_DEVICE: "2000" }, "d1", now + 31 * 60000), "daily_tokens_cap");
  assert.equal(await jevCapBlock(ctx.db, { JEV_GLOBAL_DAILY_TOKENS: "100" }, "d1", now + 31 * 60000), "global_tokens_cap");
  assert.equal(await jevCapBlock(ctx.db, {}, "d1", now + 86400000), null, "a new day resets");

  const fetchImpl = mockFetch({ answers: answers({ humidity: choice("raise", 0.95) }), usage: { input_tokens: 10 } });
  const capped = env({ AUTOPILOT_DECIDER: "jev", TYPESAFE_API_KEY: "sk-test", JEV_FETCH: fetchImpl, JEV_DAILY_CALLS_PER_DEVICE: "0" });
  const { user, device } = await chamber(capped, "jev-cap@example.com", "dev-jev-cap", { humidity: 84, humidity_setpoint: 86 });
  const result = await runAutopilotForDevice(capped.db, capped, { device, user });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(result.decider.fallback, "daily_calls_cap");
});
