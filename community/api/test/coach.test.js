import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import {
  buildDeviceModel,
  detectAlerts,
  estimateNeurons,
  estimateUsd,
  refuseRestrictedPack,
  SAFE_BOUNDS,
  suggestSetpoints,
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
import { pickCoachProfile, profileStageTargets, slimCulinaryProfile } from "../src/coach.js";
import { call, callRaw, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";
import { buildJpeg, toBase64 } from "./image-fixtures.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);

function env() {
  return testEnv({ GROW_COACH_STUB: "1" });
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
  assert.ok(suggestion.temperature_c < 20);
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
  assert.ok(suggestion.temperature_c > 20);
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

test("neuron estimate stays cheap versus the $3.99 price", () => {
  const chat = estimateNeurons({ inputTokens: 800, outputTokens: 200 });
  const photo = estimateNeurons({ inputTokens: 2000, outputTokens: 250, vision: true });
  const monthly = 1200 * chat + 240 * photo;
  assert.ok(estimateUsd(monthly) < 1, `cap-month AI $${estimateUsd(monthly)} should stay well under $3.99`);
});

test("chat and photo check are gated until Grow Coach is paid", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const denied = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(denied.status, 402);
  const catalog = await call(ctx, "GET", "/api/coach", { token });
  assert.equal(catalog.data.entitled, false);
  assert.equal(catalog.data.product.amount_cents, 399);
  assert.match(catalog.data.marketing, /not sold/i);
  await subscribe(ctx, token);
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
    "2026-10-01T00:00:00Z",
  ]);
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    "dev-auto",
    JSON.stringify({ humidity: 83, humidity_setpoint: 90, temperature: 21.6, temperature_setpoint: 20 }),
    "2026-10-01T01:00:00Z",
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

test("non-beta user stays on preview; subscribe stays 503; public coach stays off", async () => {
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
  assert.equal(catalog.data.beta, false);
  assert.equal(catalog.data.entitled, false);
  assert.equal(catalog.data.preview, true);
  assert.equal(catalog.data.waitlist, true);
  assert.match(catalog.data.marketing, /coming soon/i);

  const denied = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "why is humidity low?" } });
  assert.equal(denied.status, 402);

  const sub = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  assert.equal(sub.status, 503);
  assert.equal(sub.data.coming_soon, true);
  assert.equal(sub.data.waitlist, true);
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
  assert.equal(catalog.data.beta, false);
  const chat = await call(ctx, "POST", "/api/coach/chat", { token, body: { message: "hi" } });
  assert.equal(chat.status, 402);
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
  assert.deepEqual(SAFE_BOUNDS.temperature_c, [16, 28]);
  assert.deepEqual(SAFE_BOUNDS.humidity_percent, [70, 96]);

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
  assert.deepEqual(grounding.safe_bounds.temperature_c, [16, 28]);
  assert.deepEqual(grounding.safe_bounds.humidity_percent, [70, 96]);
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
