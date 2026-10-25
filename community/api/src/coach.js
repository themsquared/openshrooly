/** Paid Grow Coach: gating, learning, chat, photo check, alerts. */

import { laterIso, nowIso, randomToken, sha256Hex } from "./crypto.js";
import { requireVerified, userFromRequest } from "./auth.js";
import { ValidationError, isPsilocybin } from "./profile.js";
import { createModelProvider } from "./coach-models.js";
import {
  comingSoonBody,
  capabilities,
  coachAiConfigured,
  coachPublicEnabled,
  devStubsEnabled,
  isCoachBetaUser,
  paymentsConfigured,
} from "./providers.js";
import { bytesToBase64, decodePhotoBase64, sanitizeGrowPhoto } from "./photos.js";
import { readJsonLimited } from "./http-body.js";
import { insertMedia, pendingPhotoKey } from "./media-acl.js";
import {
  COACH_ITEM,
  COACH_PERIOD_DAYS,
  COACH_PRICE_CENTS,
  buildDeviceModel,
  compareReadingToStage,
  detectAlerts,
  estimateNeurons,
  latestReading,
  refuseRestrictedPack,
  safeBoundsForStage,
  suggestSetpoints,
} from "./coach-learn.js";

export const CHAT_CAP = 40;
export const PHOTO_CAP = 8;
export const NEURON_CAP = 80000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function coachCatalog() {
  return {
    id: COACH_ITEM,
    name: "Grow Coach",
    kind: "subscription",
    amount_cents: COACH_PRICE_CENTS,
    currency: "USD",
    period: "month",
    pack: "culinary",
    summary:
      "Coaching for culinary grows that uses your device's readings and your past grows to tailor humidity and temperature advice. Photo checks come later. Not sold or marketed with off-menu varieties.",
  };
}

export function coachBetaAccess(env, user) {
  return Boolean(user && isCoachBetaUser(env, user) && coachAiConfigured(env));
}

export async function hasPaidCoach(db, user) {
  if (!user) return false;
  const sub = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  if (sub && sub.status === "active" && sub.period_end >= nowIso()) return true;
  const row = await db.one("SELECT * FROM entitlements WHERE user_id=? AND item_id=?", [user.id, COACH_ITEM]);
  return Boolean(row);
}

export async function hasGrowCoach(db, user, env = {}) {
  if (coachBetaAccess(env, user)) return true;
  return hasPaidCoach(db, user);
}

async function requireCoach(request, db, env) {
  const { user } = await userFromRequest(request, db);
  requireVerified(user);
  if (!(await hasGrowCoach(db, user, env))) {
    throw new ValidationError("Grow Coach is a $3.99/month culinary subscription.", 402);
  }
  return user;
}

function dayKey() {
  return nowIso().slice(0, 10);
}

async function usageRow(db, userId) {
  const day = dayKey();
  let row = await db.one("SELECT * FROM coach_usage WHERE user_id=? AND day=?", [userId, day]);
  if (!row) {
    await db.run("INSERT INTO coach_usage (user_id, day, chats, photos, neurons) VALUES (?, ?, 0, 0, 0)", [userId, day]);
    row = { user_id: userId, day, chats: 0, photos: 0, neurons: 0 };
  }
  return row;
}

async function bumpUsage(db, userId, field, neurons = 0) {
  const row = await usageRow(db, userId);
  const next = { ...row, [field]: Number(row[field] || 0) + 1, neurons: Number(row.neurons || 0) + neurons };
  await db.run("UPDATE coach_usage SET chats=?, photos=?, neurons=? WHERE user_id=? AND day=?", [
    next.chats,
    next.photos,
    next.neurons,
    userId,
    row.day,
  ]);
  return next;
}

async function assertCap(db, userId, field) {
  const row = await usageRow(db, userId);
  if (Number(row.neurons || 0) >= NEURON_CAP) throw new ValidationError("daily Coach neuron cap reached", 429);
  if (field === "chats" && Number(row.chats || 0) >= CHAT_CAP) throw new ValidationError("daily chat cap reached (40)", 429);
  if (field === "photos" && Number(row.photos || 0) >= PHOTO_CAP) throw new ValidationError("daily photo-check cap reached (8)", 429);
}

async function cacheGet(db, key) {
  const row = await db.one("SELECT * FROM coach_cache WHERE cache_key=?", [key]);
  if (!row || row.expires_at < nowIso()) return null;
  return JSON.parse(row.value);
}

async function cacheSet(db, key, value) {
  await db.run("INSERT OR REPLACE INTO coach_cache (cache_key, value, expires_at) VALUES (?, ?, ?)", [
    key,
    JSON.stringify(value),
    laterIso(10 * 60 * 1000),
  ]);
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Per-stage target and warning bands from the selected culinary profile. */
export function profileStageTargets(stage = {}) {
  const rh = numOrNull(stage.humidity_percent);
  const rhHyst = numOrNull(stage.humidity_hysteresis);
  const temp = numOrNull(stage.temperature_c);
  const tempHyst = numOrNull(stage.temperature_hysteresis);
  return {
    id: stage.id || null,
    name: stage.name || null,
    humidity_percent: rh,
    humidity_hysteresis: rhHyst,
    humidity_target_min: rh != null && rhHyst != null ? rh - rhHyst : rh,
    humidity_target_max: rh != null && rhHyst != null ? rh + rhHyst : rh,
    temperature_c: temp,
    temperature_hysteresis: tempHyst,
    temperature_target_min: temp != null && tempHyst != null ? temp - tempHyst : temp,
    temperature_target_max: temp != null && tempHyst != null ? temp + tempHyst : temp,
    temperature_warning_min_c: numOrNull(stage.temperature_warning_min_c),
    temperature_warning_max_c: numOrNull(stage.temperature_warning_max_c),
    duration_days: numOrNull(stage.duration_days),
  };
}

export function slimCulinaryProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    species: profile.species,
    stages: (profile.stages || []).map(profileStageTargets),
  };
}

export function pickCoachProfile(library, requestedId, journal = []) {
  if (requestedId && library.some((p) => p.id === requestedId)) {
    return library.find((p) => p.id === requestedId);
  }
  const fromJournal = journal
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((row) => row.profile_id)
    .find((id) => id && library.some((p) => p.id === id));
  if (fromJournal) return library.find((p) => p.id === fromJournal);
  return library[0] || null;
}

async function loadGrounding(db, user, deviceId, profileId) {
  let device = null;
  let model = { sample_count: 0 };
  let samples = [];
  if (deviceId) {
    device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
    if (device && Number(device.owner_id) !== Number(user.id)) {
      throw new ValidationError("not your device", 403);
    }
    samples = await db.all("SELECT * FROM device_telemetry WHERE device_id=?", [deviceId]);
  }
  const reports = await db.all("SELECT * FROM grow_reports WHERE author_id=?", [user.id]);
  const culinaryReports = reports.filter((r) => !String(r.profile_id || "").includes("psilocybin"));
  model = buildDeviceModel(samples, culinaryReports);
  const profiles = (await db.all("SELECT document FROM profiles WHERE published=1")).map((row) =>
    typeof row.document === "string" ? JSON.parse(row.document) : row.document
  );
  const culinary = profiles.filter((p) => !isPsilocybin(p)).map(slimCulinaryProfile);
  const profile = pickCoachProfile(culinary, profileId, culinaryReports);
  const stage = profile?.stages?.find((s) => s.id === "fruiting") || profile?.stages?.[0] || {};
  const alerts = detectAlerts(model, samples, stage);
  const current = latestReading(samples);
  const reading_vs_targets = compareReadingToStage(current, stage);
  const settings = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  return {
    device: device ? { id: device.id, name: device.name } : null,
    device_model: model,
    alerts,
    journal: culinaryReports.slice(0, 8).map((r) => ({
      profile_id: r.profile_id,
      outcome: r.outcome,
      notes: r.notes,
      days: r.days,
    })),
    profile,
    library: culinary.slice(0, 12),
    safe_bounds: safeBoundsForStage(stage),
    auto_tune: Boolean(Number(settings?.auto_tune)),
    samples,
    stage,
    current,
    reading_vs_targets,
  };
}

export function slimGrounding(grounding) {
  return {
    device: grounding.device,
    device_model: grounding.device_model,
    alerts: grounding.alerts,
    journal: grounding.journal,
    profile: grounding.profile,
    library: grounding.library,
    safe_bounds: grounding.safe_bounds,
    auto_tune: grounding.auto_tune,
    stage: grounding.stage,
    current: grounding.current,
    reading_vs_targets: grounding.reading_vs_targets,
  };
}

export async function handleCoach(method, path, url, request, env) {
  const { db, storage } = env;

  if (method === "GET" && path === "/api/coach") {
    const { user } = await userFromRequest(request, db);
    const beta = coachBetaAccess(env, user);
    const entitled = user ? await hasGrowCoach(db, user, env) : false;
    const sub = user ? await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]) : null;
    const publicOn = capabilities(env, request).coach;
    return json({
      product: coachCatalog(),
      entitled,
      beta,
      auto_tune: Boolean(Number(sub?.auto_tune)),
      period_end: sub?.period_end || null,
      waitlist: !entitled && !publicOn,
      preview: !entitled && !publicOn,
      marketing: publicOn || entitled
        ? "Culinary chambers only. Not sold or marketed with off-menu varieties."
        : "Coming soon. Chat and checkout open at launch. Not sold with off-menu varieties.",
    });
  }

  if (method === "POST" && path === "/api/coach/subscribe") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const body = await request.json().catch(() => ({}));
    if (body.pack === "psilocybin") {
      throw new ValidationError("Grow Coach is not sold or marketed with off-menu varieties.", 400);
    }
    if (!coachPublicEnabled(env) || (!paymentsConfigured(env) && !devStubsEnabled(env, request))) {
      return json({ error: "Grow Coach is in preview. Checkout is not open yet.", coming_soon: true, waitlist: true }, 503);
    }
    const sessionId = `cs_test_${randomToken().slice(0, 16)}`;
    await db.run(
      "INSERT INTO checkouts (id, user_id, item_id, provider, status, amount_cents, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        sessionId,
        user.id,
        COACH_ITEM,
        "stripe",
        "requires_payment",
        COACH_PRICE_CENTS,
        JSON.stringify({ item_type: "subscription", note: "Culinary Grow Coach only." }),
        nowIso(),
      ]
    );
    return json({
      id: sessionId,
      provider: "stripe",
      amount_cents: COACH_PRICE_CENTS,
      item_id: COACH_ITEM,
      checkout_url: devStubsEnabled(env, request) ? `/pay/stub/${sessionId}` : null,
    });
  }

  if (method === "POST" && path === "/api/coach/complete-entitlement") {
    return json({ error: "entitlements are granted by a signed payment webhook" }, 400);
  }

  if (method === "GET" && path === "/api/coach/model") {
    const user = await requireCoach(request, db, env);
    const grounding = await loadGrounding(db, user, url.searchParams.get("device_id"), url.searchParams.get("profile_id"));
    return json({
      device: grounding.device,
      model: grounding.device_model,
      alerts: grounding.alerts,
      profile: grounding.profile,
      library: grounding.library,
      suggestion: suggestSetpoints(grounding.device_model, grounding.stage, { auto: grounding.auto_tune }),
    });
  }

  if (method === "POST" && path === "/api/coach/suggest") {
    const user = await requireCoach(request, db, env);
    const body = await request.json().catch(() => ({}));
    if (refuseRestrictedPack(body.profile)) {
      throw new ValidationError("Grow Coach will not auto-tune off-menu varieties.", 400);
    }
    const grounding = await loadGrounding(db, user, body.device_id, body.profile_id);
    const stage = body.stage || grounding.stage;
    const suggestion = suggestSetpoints(grounding.device_model, stage, { auto: grounding.auto_tune });
    if (body.apply) {
      if (!suggestion.auto_eligible && !body.approve) {
        throw new ValidationError("Approve the change, or enable auto-tune with safe bounds.", 403);
      }
      if (!suggestion.within_bounds) throw new ValidationError("suggestion outside safe bounds", 400);
      if (body.device_id) {
        await db.run(
          "INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)",
          [
            body.device_id,
            "setpoints",
            JSON.stringify({ ...suggestion, source: "grow-coach", approved: true }),
            nowIso(),
            null,
          ]
        );
      }
    }
    return json({ suggestion, alerts: grounding.alerts, applied: Boolean(body.apply) });
  }

  if (method === "POST" && path === "/api/coach/auto-tune") {
    const user = await requireCoach(request, db, env);
    const body = await request.json().catch(() => ({}));
    await db.run("UPDATE coach_subs SET auto_tune=? WHERE user_id=?", [body.enabled ? 1 : 0, user.id]);
    return json({ auto_tune: Boolean(body.enabled) });
  }

  if (method === "POST" && path === "/api/coach/chat") {
    const user = await requireCoach(request, db, env);
    const body = await request.json().catch(() => ({}));
    if (refuseRestrictedPack({ pack: body.pack, tags: body.tags })) {
      throw new ValidationError("Grow Coach does not discuss off-menu varieties.", 400);
    }
    await assertCap(db, user.id, "chats");
    const grounding = await loadGrounding(db, user, body.device_id, body.profile_id);
    const cacheKey = await sha256Hex(`chat:${user.id}:${body.device_id || ""}:${body.profile_id || ""}:${body.message || ""}`);
    const hit = await cacheGet(db, cacheKey);
    if (hit) return json({ ...hit, cached: true });
    const provider = createModelProvider(env, request);
    const result = await provider.chat({ message: body.message, grounding: slimGrounding(grounding) });
    if (result.unavailable) return json(comingSoonBody("Grow Coach"), 503);
    const neurons = estimateNeurons({ inputTokens: result.input_tokens, outputTokens: result.output_tokens });
    await bumpUsage(db, user.id, "chats", neurons);
    const payload = {
      reply: result.text,
      provider: provider.name,
      alerts: grounding.alerts,
      neurons,
      usage: await usageRow(db, user.id),
    };
    await cacheSet(db, cacheKey, payload);
    return json(payload);
  }

  if (method === "GET" && path === "/api/coach/usage") {
    const user = await requireCoach(request, db, env);
    const row = await usageRow(db, user.id);
    return json({
      day: row.day,
      chats: Number(row.chats || 0),
      photos: Number(row.photos || 0),
      neurons: Number(row.neurons || 0),
      caps: { chats: CHAT_CAP, photos: PHOTO_CAP, neurons: NEURON_CAP },
    });
  }

  if (method === "POST" && path === "/api/coach/photo") {
    const user = await requireCoach(request, db, env);
    const body = await readJsonLimited(request);
    if (refuseRestrictedPack({ pack: body.pack, tags: body.tags })) {
      throw new ValidationError("Grow Coach does not discuss off-menu varieties.", 400);
    }
    await assertCap(db, user.id, "photos");
    if (!body.photo_base64) throw new ValidationError("photo_base64 required");
    const photo = sanitizeGrowPhoto(decodePhotoBase64(body.photo_base64));
    const caps = capabilities(env, request);
    if (!caps.photos) return json({ error: "Photo checks are coming later.", coming_soon: true }, 503);
    const key = pendingPhotoKey("coach", String(user.id), photo.ext);
    await storage.put(key, photo.bytes, photo.contentType);
    await insertMedia(db, { photo_key: key, owner_id: user.id, status: "pending", kind: "coach" });
    const provider = createModelProvider(env, request);
    const result = await provider.vision({ imageBase64: bytesToBase64(photo.bytes), hint: body.hint || body.notes || "" });
    if (result.unavailable) return json(comingSoonBody("Grow Coach"), 503);
    const neurons = estimateNeurons({
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      vision: true,
    });
    await bumpUsage(db, user.id, "photos", neurons);
    return json({
      photo_key: key,
      stage: result.stage,
      flags: result.flags,
      confidence: result.confidence,
      next_steps: result.next_steps,
      provider: provider.name,
      neurons,
    });
  }

  if (method === "GET" && path === "/api/coach/alerts") {
    const user = await requireCoach(request, db, env);
    const grounding = await loadGrounding(db, user, url.searchParams.get("device_id"));
    return json({ alerts: grounding.alerts, model: grounding.device_model });
  }

  return null;
}

export async function activateCoachSub(db, userId, { replaySafe = false } = {}) {
  const existing = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [userId]);
  if (replaySafe && existing && existing.status === "active" && existing.period_end >= nowIso()) {
    await db.run("INSERT OR IGNORE INTO entitlements (user_id, item_id, item_type, granted_at) VALUES (?, ?, ?, ?)", [
      userId,
      COACH_ITEM,
      "subscription",
      nowIso(),
    ]);
    return existing.period_end;
  }
  const periodEnd = laterIso(COACH_PERIOD_DAYS * 24 * 3600 * 1000);
  if (existing) {
    await db.run("UPDATE coach_subs SET status=?, period_end=? WHERE user_id=?", ["active", periodEnd, userId]);
  } else {
    await db.run("INSERT INTO coach_subs (user_id, status, period_end, auto_tune, created_at) VALUES (?, ?, ?, ?, ?)", [
      userId,
      "active",
      periodEnd,
      0,
      nowIso(),
    ]);
  }
  await db.run("INSERT OR IGNORE INTO entitlements (user_id, item_id, item_type, granted_at) VALUES (?, ?, ?, ?)", [
    userId,
    COACH_ITEM,
    "subscription",
    nowIso(),
  ]);
  return periodEnd;
}
