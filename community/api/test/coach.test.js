import { test } from "node:test";
import assert from "node:assert/strict";
import { nowIso } from "../src/crypto.js";
import {
  buildDeviceModel,
  detectAlerts,
  estimateNeurons,
  estimateUsd,
  refuseRestrictedPack,
  suggestSetpoints,
} from "../src/coach-learn.js";
import { call, callRaw, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";
import { buildJpeg, toBase64 } from "./image-fixtures.js";

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
