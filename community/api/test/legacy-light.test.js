import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../src/crypto.js";
import { resolveAllowedProfile } from "../src/coach-autopilot.js";
import {
  normalizeStoredProfileLight,
  syncStageLightFromRecipe,
  validateProfile,
  validateStoredProfile,
  whiteLuxToPercent,
  whitePercentToLux,
} from "../src/profile-schema.js";
import { call, register, testEnv } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const pearl = JSON.parse(readFileSync(join(root, "data/profiles/culinary/pearl-oyster.json"), "utf8"));

/** A profile saved before every stage needed a full light mix. */
function legacyProfile(id = "legacy-oyster") {
  const doc = structuredClone(pearl);
  doc.id = id;
  doc.name = "Legacy Oyster";
  const byId = Object.fromEntries(doc.stages.map((s) => [s.id, s]));
  delete byId.colonization.light;
  byId.pinning.light = { sunrise_hour: 8, duration_hours: 0, white_led_lux: 92, blue_percent: 80 };
  byId.fruiting.light = { sunrise_hour: null, duration_hours: null, white_led_lux: 150, red_percent: 0, green_percent: 0, blue_percent: 80 };
  delete doc.light_recipe.phases.pinning;
  doc.light_recipe.phases.fruiting = { ...doc.light_recipe.phases.fruiting, photoperiod_hours: 0 };
  return doc;
}

async function addLegacy(ctx, userId, doc) {
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [doc.id, JSON.stringify(doc), userId, 1, nowIso(), nowIso()]
  );
}

function stage(doc, id) {
  return doc.stages.find((s) => s.id === id);
}

test("white percent to lux follows the firmware curve, same as mapping.py", () => {
  const points = { 0: 0, 10: 46, 20: 92, 26: 190, 37: 506, 51: 1229, 78: 3984, 79: 4000, 100: 4000 };
  for (const [pct, lux] of Object.entries(points)) assert.equal(whitePercentToLux(Number(pct)), lux, `${pct}%`);
  assert.equal(whiteLuxToPercent(92), 20);
  assert.equal(Math.round(whiteLuxToPercent(whitePercentToLux(37))), 37);
  assert.ok(whiteLuxToPercent(4000) > 78 && whiteLuxToPercent(4000) < 78.5);
  const synced = syncStageLightFromRecipe(structuredClone(pearl));
  assert.equal(stage(synced, "fruiting").light.white_led_lux, 92);
  assert.equal(stage(synced, "fruiting").light.white_led_lux, stage(pearl, "fruiting").light.white_led_lux);
});

test("stored legacy light reads as dark or 12 h, and saves stay strict", () => {
  const legacy = legacyProfile();
  assert.throws(() => validateProfile(legacy));
  const read = normalizeStoredProfileLight(legacy);
  assert.deepEqual(stage(read, "colonization").light, {
    sunrise_hour: 8,
    duration_hours: 0,
    white_led_lux: 0,
    red_percent: 0,
    green_percent: 0,
    blue_percent: 0,
  });
  assert.equal(stage(read, "pinning").light.duration_hours, 12);
  assert.equal(stage(read, "pinning").light.red_percent, 0);
  assert.equal(stage(read, "fruiting").light.duration_hours, 12);
  assert.equal(stage(read, "fruiting").light.sunrise_hour, 8);
  assert.equal(read.light_recipe.phases.fruiting.photoperiod_hours, 12);
  assert.deepEqual(read.light_recipe.phases.pinning, {
    photoperiod_hours: 12,
    white_brightness_percent: 20,
    red_percent: 0,
    green_percent: 0,
    blue_percent: 80,
  });
  assert.ok(validateStoredProfile(legacy));
  assert.deepEqual(normalizeStoredProfileLight(read), read);
  assert.ok(stage(legacy, "colonization").light === undefined, "input is not mutated");
});

test("a legacy profile still starts a grow, forks, rates, and exports with sensible light", async () => {
  const ctx = testEnv({ GROW_COACH_STUB: "1", FLEET_UI_ENABLED: "1", COACH_AUTOPILOT_ENABLED: "1" });
  const owner = await register(ctx, "legacy-owner@example.com");
  const grower = await register(ctx, "legacy-grower@example.com");
  await addLegacy(ctx, owner.user.id, legacyProfile());
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["dev-legacy", "hw-legacy", "{}", "Kitchen", "active", grower.user.id, null, null, null, 1, nowIso(), nowIso()]
  );

  const shown = await call(ctx, "GET", "/api/profiles/legacy-oyster", { token: grower.token });
  assert.equal(shown.status, 200, JSON.stringify(shown.data));
  assert.equal(stage(shown.data.profile, "colonization").light.duration_hours, 0);
  assert.equal(stage(shown.data.profile, "fruiting").light.duration_hours, 12);

  const exported = await call(ctx, "GET", "/api/profiles/legacy-oyster.json", { token: grower.token });
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assert.equal(stage(exported.data, "pinning").light.duration_hours, 12);

  const profileAction = await call(ctx, "POST", "/api/fleet/preview", {
    token: grower.token,
    body: { action: "profile", device_ids: ["dev-legacy"], payload: { profile_id: "legacy-oyster" } },
  });
  assert.equal(profileAction.data.results[0].status, "ok", JSON.stringify(profileAction.data));
  const lightAction = await call(ctx, "POST", "/api/fleet/preview", {
    token: grower.token,
    body: { action: "light", device_ids: ["dev-legacy"], payload: { profile_id: "legacy-oyster", stage: "fruiting" } },
  });
  assert.equal(lightAction.data.results[0].status, "ok", JSON.stringify(lightAction.data));
  assert.equal(lightAction.data.results[0].preview.light.duration_hours, 12);

  const autopilot = await resolveAllowedProfile(ctx.db, "legacy-oyster");
  assert.equal(autopilot.error, undefined);
  assert.equal(stage(autopilot.profile, "fruiting").light.duration_hours, 12);

  const rate = await call(ctx, "POST", "/api/profiles/legacy-oyster/rate", { token: grower.token, body: { stars: 5 } });
  assert.ok(rate.status < 300, JSON.stringify(rate.data));

  const fork = await call(ctx, "POST", "/api/profiles/legacy-oyster/fork", { token: grower.token, body: {} });
  assert.equal(fork.status, 201, JSON.stringify(fork.data));
  assert.equal(stage(fork.data, "colonization").light.duration_hours, 0);
  assert.equal(stage(fork.data, "fruiting").light.duration_hours, 12);

  const strictSave = await call(ctx, "POST", "/api/profiles", { token: owner.token, body: legacyProfile("legacy-new") });
  assert.equal(strictSave.status, 400);
});
