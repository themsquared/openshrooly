import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import { parseModelJson, plain, preparePhotoCheck, shapeRecommendation, visionNeurons } from "../src/coach-photo.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";
import { buildJpeg, concat, jpegExifGps, toBase64 } from "./image-fixtures.js";

const pearlOyster = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/profiles/culinary/pearl-oyster.json"), "utf8")
);
const PSI = { id: "psi-cube", pack: "psilocybin", restricted: true, tags: ["psilocybin"], stages: [] };

function env(extra = {}) {
  return testEnv({ GROW_COACH_STUB: "1", COACH_AUTOPILOT_ENABLED: "1", ...extra });
}

async function subscribe(ctx, token) {
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  const me = await call(ctx, "GET", "/api/me", { token });
  const paid = await signedWebhook(ctx, stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id }));
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
}

async function addDevice(ctx, userId, id, { status = "active", name = "Kitchen" } = {}) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", name, status, userId, null, null, null, 1, nowIso(), nowIso()]
  );
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

async function setChamberProfile(ctx, deviceId, userId, profileId) {
  await ctx.db.run(
    "INSERT INTO coach_device_mode (device_id, user_id, mode, paused, pause_reason, pause_until, profile_id, last_change_at, changes_day, changes_count, last_setpoints, last_manual_at, pending_command_id, delivery, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [deviceId, userId, "suggest", 0, null, null, profileId, null, null, 0, null, null, null, null, nowIso()]
  );
}

const photo = () => toBase64(buildJpeg({ width: 64, height: 48 }));

test("signed out gets 401 and a user without Coach gets 402", async () => {
  const ctx = env();
  const anon = await call(ctx, "POST", "/api/coach/photo", { body: { photo_base64: photo() } });
  assert.equal(anon.status, 401);
  const { token } = await register(ctx, "nocoach@example.com");
  const denied = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: photo() } });
  assert.equal(denied.status, 402);
});

test("photo check with a chamber uses its readings and stores nothing", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "photo-chamber@example.com");
  await subscribe(ctx, token);
  await addDevice(ctx, user.id, "dev-photo", { name: "Shelf" });
  await addProfile(ctx, user.id, pearlOyster);
  await setChamberProfile(ctx, "dev-photo", user.id, pearlOyster.id);
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    "dev-photo",
    JSON.stringify({ humidity: 81, temperature: 21, humidity_setpoint: 90, temperature_setpoint: 21 }),
    nowIso(),
  ]);
  const puts = [];
  const put = ctx.storage.put.bind(ctx.storage);
  ctx.storage.put = async (key, ...rest) => {
    puts.push(key);
    return put(key, ...rest);
  };
  const options = await call(ctx, "GET", "/api/coach/photo", { token });
  assert.equal(options.status, 200, JSON.stringify(options.data));
  assert.equal(options.data.available, true);
  assert.deepEqual(options.data.chambers.map((c) => c.id), ["dev-photo"]);
  assert.ok(options.data.profiles.some((p) => p.id === pearlOyster.id));
  assert.equal(options.data.usage.cap, 8);

  const res = await call(ctx, "POST", "/api/coach/photo", {
    token,
    body: { photo_base64: toBase64(concat(buildJpeg({ width: 64, height: 48 }))), device_id: "dev-photo", note: "green mold on the block" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.context.source, "chamber");
  assert.equal(res.data.context.label, "Shelf");
  assert.match(res.data.recommendation.summary, /81% humidity/);
  assert.ok(res.data.recommendation.issues.some((i) => /mold/i.test(i.label)));
  assert.ok(res.data.recommendation.next_steps.length >= 2);
  assert.equal(res.data.neurons, 34);
  assert.equal(res.data.usage.photos, 1);
  assert.equal(JSON.stringify(res.data).includes("photo_key"), false);
  // Nothing was written to photo storage or the media table.
  assert.deepEqual(puts, []);
  assert.equal((await ctx.db.all("SELECT * FROM uploaded_media WHERE owner_id=?", [user.id])).length, 0);
  // Vision spend counter for /admin spend.
  const day = nowIso().slice(0, 10);
  const counter = await ctx.db.one("SELECT * FROM coach_cache WHERE cache_key=?", [`vision:user:${user.id}:${day}`]);
  assert.deepEqual(JSON.parse(counter.value), { calls: 1, neurons: 34 });
});

test("photo check with only a profile works, and EXIF GPS is stripped before the model sees it", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "photo-profile@example.com");
  await subscribe(ctx, token);
  await addProfile(ctx, user.id, pearlOyster);
  const raw = buildJpeg({ width: 32, height: 32, apps: [jpegExifGps()] });
  assert.ok(Buffer.from(raw).includes("Exif"));
  const me = await call(ctx, "GET", "/api/me", { token });
  const prepared = await preparePhotoCheck(ctx.db, ctx, me.data.user, { photo_base64: toBase64(raw), profile_id: pearlOyster.id });
  assert.equal(Buffer.from(prepared.photo.bytes).includes("Exif"), false);
  assert.equal(prepared.context.source, "profile");
  assert.ok(prepared.context.profile.stages.some((s) => s && s.humidity_percent));
  const res = await call(ctx, "POST", "/api/coach/photo", {
    token,
    body: { photo_base64: toBase64(raw), profile_id: pearlOyster.id },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.context.source, "profile");
  assert.equal(res.data.context.label, pearlOyster.name);
});

test("off-menu: psilocybin profile, pack, and chamber are refused before any model call", async () => {
  const ctx = env();
  const { token, user } = await register(ctx, "photo-psi@example.com");
  await subscribe(ctx, token);
  await addProfile(ctx, user.id, PSI);
  await addDevice(ctx, user.id, "dev-psi");
  await setChamberProfile(ctx, "dev-psi", user.id, PSI.id);
  for (const body of [
    { photo_base64: photo(), profile_id: "psi-cube" },
    { photo_base64: photo(), pack: "psilocybin" },
    { photo_base64: photo(), device_id: "dev-psi" },
  ]) {
    const res = await call(ctx, "POST", "/api/coach/photo", { token, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.data.error, /culinary grows only/);
  }
  const options = await call(ctx, "GET", "/api/coach/photo", { token });
  assert.equal(options.data.chambers.length, 0);
  assert.equal(options.data.profiles.some((p) => p.id === "psi-cube"), false);
  const usage = await call(ctx, "GET", "/api/coach/usage", { token });
  assert.equal(usage.data.photos, 0);
});

test("someone else's chamber is a 404 and does not use a check", async () => {
  const ctx = env();
  const owner = await register(ctx, "owner-photo@example.com");
  await addDevice(ctx, owner.user.id, "dev-theirs");
  const { token } = await register(ctx, "other-photo@example.com");
  await subscribe(ctx, token);
  const res = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: photo(), device_id: "dev-theirs" } });
  assert.equal(res.status, 404);
  const usage = await call(ctx, "GET", "/api/coach/usage", { token });
  assert.equal(usage.data.photos, 0);
});

test("daily photo cap stops the ninth check", async () => {
  const ctx = env({ COACH_DAILY_PHOTOS: "2" });
  const { token } = await register(ctx, "cap-photo@example.com");
  await subscribe(ctx, token);
  for (let i = 0; i < 2; i += 1) {
    const ok = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: photo() } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
  }
  const capped = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: photo() } });
  assert.equal(capped.status, 429);
});

test("oversized photos and non-images are refused", async () => {
  const ctx = env();
  const { token } = await register(ctx, "big-photo@example.com");
  await subscribe(ctx, token);
  const big = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: toBase64(buildJpeg({ width: 4000, height: 3000 })) } });
  assert.equal(big.status, 400);
  assert.match(big.data.error, /2048 pixels/);
  const svg = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: btoa("<svg xmlns='http://www.w3.org/2000/svg'></svg>") } });
  assert.equal(svg.status, 400);
});

test("no AI provider means 503, not a stub answer", async () => {
  const ctx = env();
  const { token } = await register(ctx, "noai-photo@example.com");
  await subscribe(ctx, token);
  ctx.DEV_STUBS = "0";
  const options = await call(ctx, "GET", "/api/coach/photo", { token });
  assert.equal(options.data.available, false);
  const res = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: photo() } });
  assert.equal(res.status, 503);
});

test("model replies are shaped into plain copy and drug talk is refused", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Sure: {"a":2} hope that helps'), { a: 2 });
  const shaped = shapeRecommendation({ summary: "Pins look healthy \u2014 nice work", stage: "Pinning", issues: ["Dry edge"], next_steps: "Mist the walls", confidence: 3 });
  assert.equal(shaped.summary, "Pins look healthy, nice work");
  assert.equal(shaped.stage, "pinning");
  assert.equal(shaped.issues[0].label, "Dry edge");
  assert.deepEqual(shaped.next_steps, ["Mist the walls"]);
  assert.equal(shaped.confidence, 1);
  assert.equal(shapeRecommendation({ summary: "Looks like cubensis pins" }).off_topic, true);
  assert.equal(shapeRecommendation({ off_topic: true }).off_topic, true);
  assert.equal(plain("a \u2013 b"), "a, b");
});

test("vision neurons use the reported count, else the Llama 4 Scout rate", () => {
  assert.equal(visionNeurons("@cf/meta/llama-4-scout-17b-16e-instruct", { neurons: 33.99 }), 34);
  assert.equal(visionNeurons("@cf/meta/llama-4-scout-17b-16e-instruct", { prompt_tokens: 1070, completion_tokens: 100 }), 34);
});

test("admin spend shows photo checks and their AI cost per user", async () => {
  const ctx = env({ ADMIN_USER_IDS: "1" });
  const boss = await register(ctx, "boss-photo@example.com");
  const { token, user } = await register(ctx, "spend-photo@example.com");
  await subscribe(ctx, token);
  const ok = await call(ctx, "POST", "/api/coach/photo", { token, body: { photo_base64: photo() } });
  assert.equal(ok.status, 200);
  const spend = await call(ctx, "GET", "/api/admin/spend", { token: boss.token });
  assert.equal(spend.status, 200);
  const row = spend.data.users.find((r) => r.user_id === user.id);
  assert.equal(row.photo_checks.today, 1);
  assert.ok(row.photo_ai_cost.today > 0);
  assert.equal(spend.data.totals.photo_checks.today, 1);
});
