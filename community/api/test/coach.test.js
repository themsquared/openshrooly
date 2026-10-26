import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import {
  buildDeviceModel,
  compareReadingToStage,
  detectAlerts,
  formatHumidity,
  formatTempC,
  estimateNeurons,
  estimateUsd,
  latestReading,
  refuseRestrictedPack,
  stageTemperatureTargetRange,
  SAFE_BOUNDS,
  safeBoundsForStage,
  suggestSetpoints,
  TEMPERATURE_CLAMP,
} from "../src/coach-learn.js";
import { capabilities, coachAiConfigured, coachLocalRestEnabled } from "../src/providers.js";
import {
  COACH_CHAT_SYSTEM_PROMPT,
  DEFAULT_TEXT_MODEL,
  createModelProvider,
  stripThinkTags,
  workersAiRestUrl,
  workersAiText,
} from "../src/coach-models.js";
import { coachCaps, pickCoachProfile, profileStageTargets, slimCulinaryProfile } from "../src/coach.js";
import { call, callRaw, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";
import { buildJpeg, toBase64 } from "./image-fixtures.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);

function env() {
  return testEnv({ GROW_COACH_STUB: "1", COACH_AUTOPILOT_ENABLED: "1" });
}

async function subscribe(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(
    ctx,
    stripeCheckoutEvent({
      sessionId: session.data.id,
      itemId: session.data.item_id,
      userId: me.data.user.id,
    })
  );
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  return paid;
}

test("device learning raises humidity when the chamber droops and stays in bounds", () => {
  const samples = [
    { document: { humidity: 82, humidity_setpoint: 90, temperature: 21.2, temperature_setpoint: 20 }, created_at: "2026-10-01T00:00:00Z" },
    { document: { humidity: 84, humidity_setpoint: 90, temperature: 21.4, temperature_setpoint: 20 }, created_at: "2026-10-01T01:00:00Z" },
    { document: { humidity: 83, humidity_setpoint: 90, temperature: 21.5, temperature_setpoint: 20 }, created_at: "2026-10-01T02:00:00Z" },
  ];
  const model = buildDeviceModel(samples, [{ outcome: "success", pack: "culinary" }]);
  assert.ok(model.humidity_droop >= 5);
  assert.ok(model.temperature_offset > 1);
  const suggestion = suggestSetpoints(model, { humidity_percent: 90, temperature_c: 20, fan: { speed_percent: 30 } }, { auto: true });
  assert.ok(suggestion.humidity_percent > 90);
  assert.ok(suggestion.humidity_percent <= 96);
  assert.equal(suggestion.temperature_c, 20);
  assert.equal(suggestion.within_bounds, true);
  assert.equal(suggestion.auto_eligible, true);
});

test("device learning lowers humidity when the chamber runs wet and ignores restricted outcomes", () => {
  const samples = [
    { document: { humidity: 96, humidity_setpoint: 90, temperature: 18.2, temperature_setpoint: 20 }, created_at: "2026-10-01T00:00:00Z" },
    { document: { humidity: 95, humidity_setpoint: 90, temperature: 18.4, temperature_setpoint: 20 }, created_at: "2026-10-01T01:00:00Z" },
  ];
  const model = buildDeviceModel(samples, [
    { outcome: "success", pack: "psilocybin", restricted: true },
    { outcome: "fail", pack: "culinary" },
  ]);
  assert.ok(model.humidity_error >= 5);
  assert.equal(model.report_count, 1);
  assert.equal(model.outcome_success_rate, 0);
  const suggestion = suggestSetpoints(model, { humidity_percent: 90, temperature_c: 20 });
  assert.ok(suggestion.humidity_percent < 90);
  assert.ok(suggestion.humidity_percent >= 70);
  assert.equal(suggestion.temperature_c, 20);
});

test("alerts fire for humidity trouble, harvest window, and stalled colonization", () => {
  const wet = [
    { document: { humidity: 70, humidity_setpoint: 90, temperature: 20, temperature_setpoint: 20 }, created_at: "2026-10-01T00:00:00Z" },
    { document: { humidity: 71, humidity_setpoint: 90, temperature: 20, temperature_setpoint: 20 }, created_at: "2026-10-12T00:00:00Z" },
  ];
  const harvest = detectAlerts(buildDeviceModel(wet), wet, { id: "fruiting", name: "Fruiting", duration_days: 10 }, Date.parse("2026-10-12T00:00:00Z"));
  assert.ok(harvest.some((a) => a.kind === "humidity_trouble"));
  assert.ok(harvest.some((a) => a.kind === "time_to_harvest"));

  const stall = [
    { document: { humidity: 78, humidity_setpoint: 90, temperature: 20, temperature_setpoint: 20 }, created_at: "2026-10-01T00:00:00Z" },
    { document: { humidity: 79, humidity_setpoint: 90, temperature: 20, temperature_setpoint: 20 }, created_at: "2026-10-12T00:00:00Z" },
  ];
  const stalled = detectAlerts(
    buildDeviceModel(stall),
    stall,
    { id: "colonization", name: "Colonization", duration_days: 14 },
    Date.parse("2026-10-12T00:00:00Z")
  );
  assert.ok(stalled.some((a) => a.kind === "stalled_colonization"));
  assert.equal(refuseRestrictedPack({ pack: "psilocybin" }), true);
  assert.equal(refuseRestrictedPack({ pack: "culinary" }), false);
});

test("neuron estimate stays cheap versus the $4.99 price", () => {
  const chat = estimateNeurons({ inputTokens: 800, outputTokens: 200 });
  const photo = estimateNeurons({ inputTokens: 2000, outputTokens: 250, vision: true });
  const monthly = 1200 * chat + 240 * photo;
  assert.ok(estimateUsd(monthly) < 1, `cap-month AI $${estimateUsd(monthly)} should stay well under $4.99`);
});

test("chat and photo check are gated until Grow Coach is paid", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const denied = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(denied.status, 402);
  assert.doesNotMatch(JSON.stringify(denied.data), /3\.99/);
  // COACH_PUBLIC=1 in the test env, so the catalog is on sale but not unlocked.
  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.equal(catalog.data.available, true);
  assert.equal(catalog.data.entitled, false);
  await subscribe(ctx, token);
  const paidCatalog = await call(ctx, "GET", "/api/coach", { token });
  assert.equal(paidCatalog.data.available, true);
  assert.equal(paidCatalog.data.entitled, true);
  assert.equal(paidCatalog.data.product.amount_cents, 499);
  assert.match(paidCatalog.data.marketing, /not sold/i);
  const ok = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.reply, /Grow Coach/);
  assert.equal(ok.data.provider, "stub");
});

test("restricted pack is refused for subscribe, chat, photo, and auto-tune", async () => {
  const ctx = env();
  const { token } = await register(ctx, "psi@example.com");
  const blocked = await call(ctx, "POST", "/api/coach/subscribe", { token, body: { pack: "psilocybin" } });
  assert.equal(blocked.status, 400);
  await subscribe(ctx, token);
  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "pins?", pack: "psilocybin" } });
  assert.equal(chat.status, 400);
  const photo = await call(ctx, "POST", "/api/coach/photo", {
    token,
    body: { photo_base64: btoa("x"), pack: "psilocybin" },
  });
  assert.equal(photo.status, 400);
  const suggest = await call(ctx, "POST", "/api/coach/suggest", {
    token,
    body: { profile: { pack: "psilocybin" }, apply: true, approve: true },
  });
  assert.equal(suggest.status, 400);
});

test("approved suggestion can queue setpoints; body auto flag cannot skip approval", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "tune@example.com");
  await subscribe(ctx, token);
  const refused = await call(ctx, "POST", "/api/coach/suggest", {
    token,
    body: { apply: true, auto: true, stage: { humidity_percent: 90, temperature_c: 20 } },
  });
  assert.equal(refused.status, 403);
  const applied = await call(ctx, "POST", "/api/coach/suggest", {
    token,
    body: { apply: true, approve: true, device_id: "dev-tune", stage: { humidity_percent: 90, temperature_c: 20 } },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.applied, true);

  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["dev-auto", "hw-auto", "{}", "Kitchen", "claimed", user.id, null, null, null, 1, null, nowIso()]
  );
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    "dev-auto",
    JSON.stringify({ humidity: 82, humidity_setpoint: 90, temperature: 21.4, temperature_setpoint: 20 }),
    new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  ]);
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    "dev-auto",
    JSON.stringify({ humidity: 83, humidity_setpoint: 90, temperature: 21.6, temperature_setpoint: 20 }),
    new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  ]);
  const enabled = await call(ctx, "POST", "/api/coach/auto-tune", { token, body: { enabled: true } });
  assert.equal(enabled.status, 200);
  const autoApply = await call(ctx, "POST", "/api/coach/suggest", {
    token,
    body: { apply: true, device_id: "dev-auto", stage: { humidity_percent: 90, temperature_c: 20 } },
  });
  assert.equal(autoApply.status, 200, JSON.stringify(autoApply.data));
  assert.equal(autoApply.data.suggestion.auto_eligible, true);
});

test("photo check returns stage flags and next steps", async () => {
  const ctx = env();
  const { token } = await register(ctx, "photo@example.com");
  await subscribe(ctx, token);
  const photo = await call(ctx, "POST", "/api/coach/photo", {
    token,
    body: { photo_base64: toBase64(buildJpeg()), hint: "green mold on the block" },
  });
  assert.equal(photo.status, 200, JSON.stringify(photo.data));
  assert.ok(photo.data.flags.some((f) => f.kind === "contamination"));
  assert.match(photo.data.next_steps, /Isolate/i);
  assert.match(photo.data.photo_key, /^pending\/coach\/[0-9a-f]+\.(jpe?g|png|webp)$/);
  const anon = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(photo.data.photo_key)}`);
  assert.equal(anon.status, 404);
  const owner = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(photo.data.photo_key)}`, { token });
  assert.equal(owner.status, 200);

  const first = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(first.status, 200);
  const cached = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(cached.data.cached, true);
  const usage = await call(ctx, "GET", "/api/coach/usage", { token });
  assert.equal(usage.status, 200);
  assert.equal(usage.data.chats, 1);

  const me = await call(ctx, "GET", "/api/me", { token });
  await ctx.db.run("UPDATE coach_usage SET chats=?, photos=?, neurons=? WHERE user_id=? AND day=?", [
    40,
    0,
    0,
    me.data.user.id,
    nowIso().slice(0, 10),
  ]);
  const capped = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "another?" } });
  assert.equal(capped.status, 429);
});

function mockWorkersAi(result) {
  return {
    async run() {
      return result;
    },
  };
}

function privateBetaEnv(extra = {}) {
  return testEnv({
    COACH_PUBLIC: "0",
    COACH_AUTOPILOT_ENABLED: "1",
    GROW_COACH_PROVIDER: "workers-ai",
    GROW_COACH_STUB: "",
    ...extra,
  });
}

test("Qwen3 response shapes strip <think> tags before use", () => {
  assert.equal(DEFAULT_TEXT_MODEL, "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.equal(stripThinkTags("<think>hidden</think>Keep the door sealed."), "Keep the door sealed.");
  assert.equal(
    workersAiText({
      choices: [{ message: { content: "<think>reason\nacross lines</think>\nFill the reservoir." } }],
    }),
    "Fill the reservoir."
  );
  assert.equal(workersAiText({ response: "<think>hmm</think>Humidity is low." }), "Humidity is low.");
});

test("beta user can chat on mocked AI; think tags are stripped", async () => {
  const ctx = privateBetaEnv({
    AI: mockWorkersAi({
      choices: [{ message: { content: "<think>internal</think>Seal the door and fill the reservoir." } }],
      usage: { prompt_tokens: 80, completion_tokens: 20 },
    }),
  });
  const { token, user } = await register(ctx, "beta@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);

  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.beta, true);
  assert.equal(catalog.data.entitled, true);
  assert.equal(catalog.data.waitlist, false);
  assert.equal(catalog.data.preview, false);

  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(chat.status, 200, JSON.stringify(chat.data));
  assert.equal(chat.data.provider, "workers-ai");
  assert.equal(chat.data.reply, "Seal the door and fill the reservoir.");
  assert.doesNotMatch(chat.data.reply, /<think>/i);
  assert.doesNotMatch(chat.data.reply, /internal/);
});

test("non-beta user sees no Coach; subscribe is 404; public coach stays off", async () => {
  const ctx = privateBetaEnv({
    COACH_BETA_USER_IDS: "82",
    AI: mockWorkersAi({ response: "hello" }),
  });
  const { token, user } = await register(ctx, "wait@example.com");
  assert.notEqual(String(user.id), "82");

  const caps = await call(ctx, "GET", "/api/capabilities");
  assert.equal(caps.data.coach, false);
  assert.equal(capabilities(ctx).coach, false);

  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.deepEqual(catalog.data, { available: false });

  const denied = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(denied.status, 404);

  const sub = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(sub.status, 404);
  assert.doesNotMatch(JSON.stringify(sub.data), /Grow Coach|3\.99/);
});

test("Workers AI REST is local-only and never turns on from tokens alone", () => {
  const tokens = { CF_ACCOUNT_ID: "acc", WORKERS_AI_TOKEN: "tok", GROW_COACH_PROVIDER: "workers-ai" };
  assert.equal(coachLocalRestEnabled(tokens), false);
  assert.equal(coachAiConfigured(tokens), false);
  assert.equal(coachLocalRestEnabled({ ...tokens, ENVIRONMENT: "production" }), false);
  assert.equal(coachLocalRestEnabled({ ...tokens, ENVIRONMENT: "local" }), true);
  assert.equal(coachAiConfigured({ ...tokens, ENVIRONMENT: "local" }), true);
  assert.equal(coachLocalRestEnabled({ ...tokens, ENVIRONMENT: "local", AI: {} }), false);
  assert.equal(coachAiConfigured({ ...tokens, ENVIRONMENT: "local", AI: {} }), true);
  assert.equal(
    workersAiRestUrl("acc", "@cf/qwen/qwen3-30b-a3b-fp8"),
    "https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/qwen/qwen3-30b-a3b-fp8"
  );
  const prod = new Request("https://api.shroomlabs.io/api/coach/chat", { headers: { host: "api.shroomlabs.io" } });
  assert.equal(createModelProvider({ ...tokens, ENVIRONMENT: "local" }, prod).name, "disabled");
});

test("beta user can chat via local Workers AI REST; think tags are stripped", async () => {
  const calls = [];
  const ctx = privateBetaEnv({
    ENVIRONMENT: "local",
    CF_ACCOUNT_ID: "acc_test",
    WORKERS_AI_TOKEN: "tok_test",
    fetch: async (url, opts) => {
      calls.push({ url: String(url), headers: opts.headers, body: opts.body });
      return {
        ok: true,
        async json() {
          return {
            success: true,
            result: {
              choices: [{ message: { content: "<think>hidden</think>Seal the door and fill the reservoir." } }],
              usage: { prompt_tokens: 40, completion_tokens: 12 },
            },
          };
        },
      };
    },
  });
  const { token, user } = await register(ctx, "rest-beta@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);

  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.equal(catalog.data.beta, true);
  assert.equal(catalog.data.entitled, true);

  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(chat.status, 200, JSON.stringify(chat.data));
  assert.equal(chat.data.provider, "workers-ai-rest");
  assert.equal(chat.data.reply, "Seal the door and fill the reservoir.");
  assert.doesNotMatch(chat.data.reply, /<think>/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, workersAiRestUrl("acc_test", DEFAULT_TEXT_MODEL));
  assert.equal(calls[0].headers.authorization, "Bearer tok_test");
});

test("tokens without ENVIRONMENT=local do not open Coach REST", async () => {
  const ctx = privateBetaEnv({
    CF_ACCOUNT_ID: "acc_test",
    WORKERS_AI_TOKEN: "tok_test",
    fetch: async () => {
      throw new Error("REST must not run");
    },
  });
  const { token, user } = await register(ctx, "no-rest@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);
  const catalog = await call(ctx, "GET", "/api/coach", { token });
  // Comp access is on, but REST never runs: chat falls back to the local stub.
  assert.equal(catalog.data.beta, true);
  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "hi" } });
  assert.equal(chat.status, 200, JSON.stringify(chat.data));
  assert.equal(chat.data.provider, "stub");
});

test("oyster fruiting grounding uses the profile warning band, not a 14-16 C lore range", () => {
  const fruiting = profileStageTargets(pearlOyster.stages.find((s) => s.id === "fruiting"));
  assert.equal(fruiting.temperature_c, 16);
  assert.equal(fruiting.temperature_hysteresis, 1);
  assert.equal(fruiting.temperature_target_min, 15);
  assert.equal(fruiting.temperature_target_max, 17);
  assert.equal(fruiting.temperature_warning_min_c, 11);
  assert.equal(fruiting.temperature_warning_max_c, 21);
  assert.equal(fruiting.humidity_percent, 88);
  assert.equal(fruiting.humidity_target_min, 86);
  assert.equal(fruiting.humidity_target_max, 90);
  assert.ok(fruiting.temperature_warning_min_c < 14);
  assert.ok(fruiting.temperature_warning_max_c > 16);
  assert.deepEqual(SAFE_BOUNDS.temperature_c, [10, 32]);
  assert.deepEqual(TEMPERATURE_CLAMP, [10, 32]);
  assert.deepEqual(SAFE_BOUNDS.humidity_percent, [70, 96]);
  assert.deepEqual(safeBoundsForStage(fruiting).temperature_c, [11, 21]);

  const slim = slimCulinaryProfile(pearlOyster);
  assert.equal(slim.stages.find((s) => s.id === "fruiting").temperature_warning_max_c, 21);
  assert.equal(pickCoachProfile([slim], "pearl-oyster").id, "pearl-oyster");
});

test("coach chat prompt is plain prose grounded in the selected profile stages", () => {
  assert.match(COACH_CHAT_SYSTEM_PROMPT, /plain, short prose/i);
  assert.match(COACH_CHAT_SYSTEM_PROMPT, /do not use json or markdown tables/i);
  assert.match(COACH_CHAT_SYSTEM_PROMPT, /selected profile's per-stage/i);
  assert.match(COACH_CHAT_SYSTEM_PROMPT, /not generic species lore/i);
  assert.match(COACH_CHAT_SYSTEM_PROMPT, /safe bounds/i);
  assert.match(COACH_CHAT_SYSTEM_PROMPT, /current readings and setpoints/i);
  assert.match(COACH_CHAT_SYSTEM_PROMPT, /out of range/i);
  assert.doesNotMatch(COACH_CHAT_SYSTEM_PROMPT, /Be concise\.$/);
});

test("chat grounding passes pearl-oyster stage ranges and keeps the safe-bounds clamp", async () => {
  const calls = [];
  const ctx = privateBetaEnv({
    ENVIRONMENT: "local",
    CF_ACCOUNT_ID: "acc_test",
    WORKERS_AI_TOKEN: "tok_test",
    fetch: async (url, opts) => {
      calls.push({ url: String(url), body: opts.body });
      return {
        ok: true,
        async json() {
          return { success: true, result: { response: "Pearl Oyster fruiting sits near 16 C, warning 11 to 21 C." } };
        },
      };
    },
  });
  const { token, user } = await register(ctx, "oyster-coach@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);
  const chat = await call(ctx, "POST", "/api/coach/chat", {
    token,
    body: { message: "What temperature should fruiting be?", profile_id: "pearl-oyster" },
  });
  assert.equal(chat.status, 200, JSON.stringify(chat.data));
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.messages[0].content, COACH_CHAT_SYSTEM_PROMPT);
  const userMsg = String(sent.messages[1].content);
  const grounded = userMsg.match(/^Grounding:\n([\s\S]*)\n\nQuestion: /);
  assert.ok(grounded, userMsg.slice(0, 200));
  const grounding = JSON.parse(grounded[1]);
  assert.equal(grounding.profile.id, "pearl-oyster");
  const fruiting = grounding.profile.stages.find((s) => s.id === "fruiting");
  assert.equal(fruiting.temperature_warning_min_c, 11);
  assert.equal(fruiting.temperature_warning_max_c, 21);
  assert.equal(fruiting.temperature_target_min, 15);
  assert.equal(fruiting.temperature_target_max, 17);
  assert.deepEqual(grounding.safe_bounds.temperature_c, [11, 21]);
  assert.deepEqual(grounding.safe_bounds.humidity_percent, [70, 96]);
});

test("latest reading 22.9 C with a 24 C setpoint is above pearl fruiting's 21 C warning", () => {
  const fruiting = profileStageTargets(pearlOyster.stages.find((s) => s.id === "fruiting"));
  const now = Date.parse("2026-10-25T03:00:00Z");
  const current = latestReading(
    [
      {
        document: { humidity: 88, humidity_setpoint: 88, temperature: 22.9, temperature_setpoint: 24 },
        created_at: "2026-10-25T02:50:00Z",
      },
    ],
    now
  );
  assert.equal(current.temperature, 22.9);
  assert.equal(current.temperature_setpoint, 24);
  assert.equal(current.humidity, 88);
  assert.equal(current.humidity_setpoint, 88);
  assert.equal(current.reading_at, "2026-10-25T02:50:00Z");
  assert.equal(current.age_seconds, 600);
  const flags = compareReadingToStage(current, fruiting);
  assert.ok(flags.some((f) => f.kind === "temperature_above_warning" && f.value === 22.9 && f.limit === 21));
  assert.ok(flags.some((f) => f.kind === "temperature_setpoint_above_warning" && f.value === 24 && f.limit === 21));
  assert.match(flags.find((f) => f.kind === "temperature_above_warning").message, /above the 21/);
});

test("safe bounds follow profile warning bands so pearl 15 C and king/blue 14 C are reachable", () => {
  const pearl = profileStageTargets(pearlOyster.stages.find((s) => s.id === "fruiting"));
  assert.deepEqual(safeBoundsForStage(pearl).temperature_c, [11, 21]);
  const ignoredGap = suggestSetpoints({ humidity_droop: 0, humidity_error: 0, temperature_offset: 1.2 }, pearl);
  assert.equal(ignoredGap.temperature_c, 16);
  const pearlCal = suggestSetpoints({ humidity_droop: 0, humidity_error: 0, temperature_calibration: 1 }, pearl);
  assert.equal(pearlCal.temperature_c, 15);
  assert.equal(pearlCal.within_bounds, true);
  assert.equal(suggestSetpoints({ temperature_calibration: 8 }, pearl).temperature_c, 15);

  const kingFruit = { temperature_c: 14, temperature_warning_min_c: 11, temperature_warning_max_c: 19, humidity_percent: 88 };
  const blueFruit = { temperature_c: 14, temperature_warning_min_c: 10, temperature_warning_max_c: 20, humidity_percent: 88 };
  assert.ok(safeBoundsForStage(kingFruit).temperature_c[0] <= 14);
  assert.ok(safeBoundsForStage(blueFruit).temperature_c[0] <= 14);
  assert.equal(suggestSetpoints({ sample_count: 0 }, kingFruit).temperature_c, 14);
  assert.equal(suggestSetpoints({ sample_count: 0 }, blueFruit).temperature_c, 14);
  assert.deepEqual(safeBoundsForStage({ temperature_warning_min_c: 5, temperature_warning_max_c: 40 }).temperature_c, [10, 32]);
});

test("pearl fruiting 22.76 C vs 24 C setpoint suggests 16 C and says the chamber is running warm", () => {
  const pearl = profileStageTargets(pearlOyster.stages.find((s) => s.id === "fruiting"));
  assert.deepEqual(stageTemperatureTargetRange(pearl), [15, 17]);
  const samples = [
    {
      document: { humidity: 88, humidity_setpoint: 88, temperature: 22.76, temperature_setpoint: 24 },
      created_at: "2026-10-25T03:10:00Z",
    },
  ];
  const model = buildDeviceModel(samples);
  assert.ok(model.temperature_offset < 0);
  const suggestion = suggestSetpoints(model, pearl, { reading: latestReading(samples) });
  assert.equal(suggestion.temperature_c, 16);
  assert.ok(suggestion.temperature_c >= 15 && suggestion.temperature_c <= 17);
  assert.match(suggestion.reasons.join(" "), /running warm/i);
  assert.match(suggestion.reasons.join(" "), /Lower the setpoint/i);
  assert.match(suggestion.reasons.join(" "), /22\.8 °C/);
  assert.doesNotMatch(suggestion.reasons.join(" "), /22\.76/);
  assert.doesNotMatch(suggestion.reasons.join(" "), /runs cool/i);
  assert.doesNotMatch(suggestion.reasons.join(" "), /running cool/i);
});

test("Coach user-facing readings round temperature to 1 decimal and humidity to whole or 1 decimal", () => {
  assert.equal(formatTempC(22.75559), "22.8");
  assert.equal(formatTempC(16), "16.0");
  assert.equal(formatTempC(12.44), "12.4");
  assert.equal(formatHumidity(87.96), "88");
  assert.equal(formatHumidity(88), "88");
  assert.equal(formatHumidity(88.44), "88.4");

  const pearl = profileStageTargets(pearlOyster.stages.find((s) => s.id === "fruiting"));
  const samples = [
    {
      document: { humidity: 87.96, humidity_setpoint: 90.04, temperature: 22.75559, temperature_setpoint: 24.02 },
      created_at: "2026-10-25T03:10:00Z",
    },
  ];
  const suggestion = suggestSetpoints(buildDeviceModel(samples), pearl, { reading: latestReading(samples) });
  const reasons = suggestion.reasons.join(" ");
  assert.match(reasons, /22\.8 °C/);
  assert.doesNotMatch(reasons, /22\.75559/);

  const flags = compareReadingToStage(latestReading(samples), pearl);
  const tempFlag = flags.find((f) => f.kind === "temperature_above_warning");
  assert.match(tempFlag.message, /22\.8 °C/);
  assert.doesNotMatch(tempFlag.message, /22\.75559/);
  const rhFlag = flags.find((f) => f.kind === "humidity_setpoint_above_target");
  assert.match(rhFlag.message, /90 %/);
  assert.doesNotMatch(rhFlag.message, /90\.04/);
});

test("pearl fruiting that is too cold suggests 16 C and says the chamber is running cool", () => {
  const pearl = profileStageTargets(pearlOyster.stages.find((s) => s.id === "fruiting"));
  const samples = [
    {
      document: { humidity: 88, humidity_setpoint: 88, temperature: 12.4, temperature_setpoint: 11 },
      created_at: "2026-10-25T03:10:00Z",
    },
  ];
  const model = buildDeviceModel(samples);
  assert.ok(model.temperature_offset > 0);
  const suggestion = suggestSetpoints(model, pearl, { reading: latestReading(samples) });
  assert.equal(suggestion.temperature_c, 16);
  assert.ok(suggestion.temperature_c >= 15 && suggestion.temperature_c <= 17);
  assert.match(suggestion.reasons.join(" "), /running cool/i);
  assert.match(suggestion.reasons.join(" "), /Raise the setpoint/i);
  assert.doesNotMatch(suggestion.reasons.join(" "), /running warm/i);
  assert.doesNotMatch(suggestion.reasons.join(" "), /runs cool/i);
});

test("chat grounding includes the latest reading and flags pearl fruiting above 21 C", async () => {
  const calls = [];
  const ctx = privateBetaEnv({
    ENVIRONMENT: "local",
    CF_ACCOUNT_ID: "acc_test",
    WORKERS_AI_TOKEN: "tok_test",
    fetch: async (_url, opts) => {
      calls.push({ body: opts.body });
      return {
        ok: true,
        async json() {
          return { success: true, result: { response: "22.9 C is above Pearl Oyster's 21 C fruiting warning." } };
        },
      };
    },
  });
  const { token, user } = await register(ctx, "hot-oyster@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["dev-hot", "hw-hot", "{}", "Kitchen", "claimed", user.id, null, null, null, 1, null, nowIso()]
  );
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    "dev-hot",
    JSON.stringify({ humidity: 88, humidity_setpoint: 88, temperature: 22.9, temperature_setpoint: 24 }),
    nowIso(),
  ]);
  const chat = await call(ctx, "POST", "/api/coach/chat", {
    token,
    body: { message: "Is this too warm?", device_id: "dev-hot", profile_id: "pearl-oyster" },
  });
  assert.equal(chat.status, 200, JSON.stringify(chat.data));
  const sent = JSON.parse(calls[0].body);
  const userMsg = String(sent.messages[1].content);
  const grounded = userMsg.match(/^Grounding:\n([\s\S]*)\n\nQuestion: /);
  assert.ok(grounded);
  const grounding = JSON.parse(grounded[1]);
  assert.equal(grounding.current.temperature, 22.9);
  assert.equal(grounding.current.temperature_setpoint, 24);
  assert.equal(grounding.current.humidity, 88);
  assert.ok(grounding.current.age_seconds != null);
  assert.ok(grounding.reading_vs_targets.some((f) => f.kind === "temperature_above_warning" && f.limit === 21));
  assert.ok(grounding.reading_vs_targets.some((f) => f.kind === "temperature_setpoint_above_warning"));
});

test("subscribe stays 503 for a beta user while COACH_PUBLIC is off", async () => {
  const ctx = privateBetaEnv({
    AI: mockWorkersAi({ response: "ok" }),
  });
  const { token, user } = await register(ctx, "beta-sub@example.com");
  ctx.COACH_BETA_USER_IDS = String(user.id);
  const sub = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(sub.status, 503);
  assert.equal(sub.data.coming_soon, true);
});

test("coach cost caps: defaults stay small and env vars override them", () => {
  const caps = coachCaps({});
  assert.ok(estimateUsd(caps.monthly_neurons) < 1, "monthly per-user AI cost stays well under the plan price");
  assert.ok(estimateUsd(caps.neurons) * 31 >= estimateUsd(caps.monthly_neurons) / 4);
  assert.equal(coachCaps({ COACH_DAILY_CHATS: "5", COACH_MONTHLY_NEURONS: "nope" }).chats, 5);
  assert.equal(coachCaps({ COACH_MONTHLY_NEURONS: "nope" }).monthly_neurons, caps.monthly_neurons);
});

test("coach stops at the monthly allowance and at the global daily budget", async () => {
  const ctx = testEnv({ GROW_COACH_STUB: "1", COACH_AUTOPILOT_ENABLED: "1", COACH_DAILY_NEURONS: "1000000", COACH_GLOBAL_DAILY_NEURONS: "50000" });
  const { token } = await register(ctx, "budget@example.com");
  await subscribe(ctx, token);
  const me = await call(ctx, "GET", "/api/me", { token });
  const day = nowIso().slice(0, 10);
  const ok = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "first" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  await ctx.db.run("UPDATE coach_usage SET chats=?, photos=?, neurons=? WHERE user_id=? AND day=?", [1, 0, 20000, me.data.user.id, day]);
  const monthly = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "second" } });
  assert.equal(monthly.status, 429);
  assert.match(monthly.data.error, /this month/);

  await ctx.db.run("UPDATE coach_usage SET chats=?, photos=?, neurons=? WHERE user_id=? AND day=?", [1, 0, 0, me.data.user.id, day]);
  await ctx.db.run("INSERT INTO coach_usage (user_id, day, chats, photos, neurons) VALUES (?, ?, 0, 0, 0)", [999999, day]);
  await ctx.db.run("UPDATE coach_usage SET chats=?, photos=?, neurons=? WHERE user_id=? AND day=?", [0, 0, 50000, 999999, day]);
  const errors = [];
  const origError = console.error;
  console.error = (line) => errors.push(String(line));
  try {
    const busy = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "third" } });
    assert.equal(busy.status, 503);
    assert.match(busy.data.error, /busy today/);
  } finally {
    console.error = origError;
  }
  assert.ok(errors.some((line) => line.includes("coach.budget")));
});
