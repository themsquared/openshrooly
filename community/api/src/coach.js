/** Paid Grow Coach: gating, learning, chat, photo check, alerts. */
import { COMMAND_TTL_MS } from "./device-capabilities.js";

import { laterIso, nowIso, randomToken, sha256Hex } from "./crypto.js";
import {
  coachAutopilotAvailable,
  coachAutopilotFlagOn,
  getAutopilotStatus,
  runAutopilotForDevice,
  setDeviceAutopilotMode,
  undoAutopilotAction,
} from "./coach-autopilot.js";
import { requireVerified, userFromRequest } from "./auth.js";
import { ValidationError, isPsilocybin, normalizeStoredProfileLight } from "./profile.js";
import { createModelProvider } from "./coach-models.js";
import { startCheckout } from "./payments.js";
import { coachPriceId } from "./stripe.js";
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
  COACH_PLANS,
  COACH_PRICE_CENTS,
  COACH_YEARLY_SAVINGS_PERCENT,
  coachPlanId,
  buildDeviceModel,
  compareReadingToStage,
  detectAlerts,
  estimateNeurons,
  latestReading,
  loadRecentTelemetry,
  refuseRestrictedPack,
  safeBoundsForStage,
  suggestSetpoints,
} from "./coach-learn.js";

export const CHAT_CAP = 40;
export const PHOTO_CAP = 8;
/**
 * Cost caps in Workers AI neurons ($0.011 per 1,000). A chat is about 10 neurons and a photo check
 * about 25, so these never bite normal use. They stop a runaway client from costing real money.
 * Per user: 3,000 a day and 20,000 a month (about $0.22 a month, well under the plan price).
 * Everyone together: 100,000 a day (about $1.10). All four are overridable with env vars.
 */
export const NEURON_CAP = 3000;
export const MONTHLY_NEURON_CAP = 20000;
export const GLOBAL_DAILY_NEURON_CAP = 100000;

function envInt(env, name, fallback) {
  const n = Number.parseInt(String(env?.[name] ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function coachCaps(env = {}) {
  return {
    chats: envInt(env, "COACH_DAILY_CHATS", CHAT_CAP),
    photos: envInt(env, "COACH_DAILY_PHOTOS", PHOTO_CAP),
    neurons: envInt(env, "COACH_DAILY_NEURONS", NEURON_CAP),
    monthly_neurons: envInt(env, "COACH_MONTHLY_NEURONS", MONTHLY_NEURON_CAP),
    global_daily_neurons: envInt(env, "COACH_GLOBAL_DAILY_NEURONS", GLOBAL_DAILY_NEURON_CAP),
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Can checkout run for this plan right now: Stripe keys plus that plan's price id, or local dev stubs. */
export function coachPlanOnSale(env = {}, request, plan = "monthly") {
  if (devStubsEnabled(env, request)) return true;
  return paymentsConfigured(env) && Boolean(coachPriceId(env, plan));
}

/** Plans for the picker. `available` is false until that plan's Stripe price id is set. */
export function coachPlans(env = {}, request) {
  return Object.values(COACH_PLANS).map((plan) => ({
    id: plan.id,
    amount_cents: plan.amount_cents,
    currency: "USD",
    period: plan.period,
    savings_percent: plan.id === "yearly" ? COACH_YEARLY_SAVINGS_PERCENT : 0,
    available: coachPlanOnSale(env, request, plan.id),
  }));
}

export function coachCatalog(env = {}, request) {
  return {
    id: COACH_ITEM,
    name: "Grow Coach",
    kind: "subscription",
    amount_cents: COACH_PRICE_CENTS,
    currency: "USD",
    period: "month",
    plans: coachPlans(env, request),
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
  // The subscription row is the only source of truth, so a cancel takes access away.
  return Boolean(sub && sub.status === "active" && sub.period_end >= nowIso());
}

export async function hasGrowCoach(db, user, env = {}) {
  if (coachBetaAccess(env, user)) return true;
  return hasPaidCoach(db, user);
}

/**
 * Coach is on sale to everyone (not just beta) only when Mike turns on COACH_PUBLIC=1,
 * the Coach kill switch (COACH_AUTOPILOT_ENABLED) is on, and checkout can really run:
 * Stripe keys plus the Coach price id, or local dev stubs. With COACH_PUBLIC unset this
 * is always false, so Coach stays hidden except for beta and paying users.
 */
export function coachForSale(env = {}, request) {
  if (!coachPublicEnabled(env) || !coachAutopilotFlagOn(env)) return false;
  return coachPlanOnSale(env, request, "monthly") || coachPlanOnSale(env, request, "yearly");
}

/** Coach shows up for this visitor: beta or paying users, or anyone while it is on sale. */
export async function coachVisible(env, db, user, request) {
  if (await coachAutopilotAvailable(env, db, user)) return true;
  return coachForSale(env, request);
}

async function requireCoach(request, db, env) {
  const { user } = await userFromRequest(request, db);
  requireVerified(user);
  if (!(await coachAutopilotAvailable(env, db, user))) {
    throw new ValidationError("not found", 404);
  }
  if (!(await hasGrowCoach(db, user, env))) {
    throw new ValidationError("Grow Coach chat is not turned on for this account yet.", 402);
  }
  return user;
}

async function requireAutopilotUser(request, db, env) {
  const { user } = await userFromRequest(request, db);
  requireVerified(user);
  if (!(await coachAutopilotAvailable(env, db, user))) {
    throw new ValidationError("not found", 404);
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

async function sumNeurons(db, sql, params) {
  const row = await db.one(sql, params);
  return Number(row?.n || 0);
}

async function assertCap(db, env, userId, field) {
  const caps = coachCaps(env);
  const row = await usageRow(db, userId);
  if (Number(row.neurons || 0) >= caps.neurons) throw new ValidationError("You have used today's Grow Coach allowance. It resets at midnight UTC.", 429);
  if (field === "chats" && Number(row.chats || 0) >= caps.chats) throw new ValidationError(`You have asked ${caps.chats} questions today. Grow Coach resets at midnight UTC.`, 429);
  if (field === "photos" && Number(row.photos || 0) >= caps.photos) throw new ValidationError(`You have checked ${caps.photos} photos today. Grow Coach resets at midnight UTC.`, 429);
  const month = row.day.slice(0, 7);
  const monthly = await sumNeurons(db, "SELECT SUM(neurons) AS n FROM coach_usage WHERE user_id=? AND day>=?", [userId, `${month}-01`]);
  if (monthly >= caps.monthly_neurons) throw new ValidationError("You have used this month's Grow Coach allowance. It resets on the 1st.", 429);
  const everyone = await sumNeurons(db, "SELECT SUM(neurons) AS n FROM coach_usage WHERE day=?", [row.day]);
  if (everyone >= caps.global_daily_neurons) {
    console.error(JSON.stringify({ at: "coach.budget", day: row.day, neurons: everyone, cap: caps.global_daily_neurons }));
    throw new ValidationError("Grow Coach is very busy today. Try again tomorrow.", 503);
  }
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
    samples = await loadRecentTelemetry(db, deviceId);
  }
  const reports = await db.all("SELECT * FROM grow_reports WHERE author_id=?", [user.id]);
  const culinaryReports = reports.filter((r) => !String(r.profile_id || "").includes("psilocybin"));
  model = buildDeviceModel(samples, culinaryReports);
  const profiles = (await db.all("SELECT document FROM profiles WHERE published=1")).map((row) =>
    normalizeStoredProfileLight(typeof row.document === "string" ? JSON.parse(row.document) : row.document)
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
    const autopilot = await coachAutopilotAvailable(env, db, user);
    const forSale = coachForSale(env, request);
    // Hidden for everyone except beta and paying users, unless Mike has put Coach on sale.
    if (!autopilot && !forSale) return json({ available: false });
    const beta = coachBetaAccess(env, user);
    const entitled = user ? await hasGrowCoach(db, user, env) : false;
    const sub = user ? await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]) : null;
    return json({
      available: true,
      product: coachCatalog(env, request),
      entitled,
      beta,
      signed_in: Boolean(user),
      for_sale: forSale,
      auto_tune: Boolean(Number(sub?.auto_tune)),
      period_end: sub?.period_end || null,
      waitlist: !entitled && !forSale,
      preview: !entitled && !forSale,
      autopilot,
      marketing: forSale || entitled
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
      if (!(await coachAutopilotAvailable(env, db, user))) return json({ error: "not found" }, 404);
      return json({ error: "Grow Coach is in preview. Checkout is not open yet.", coming_soon: true, waitlist: true }, 503);
    }
    const plan = coachPlanId(body.plan);
    if (!plan) return json({ error: "Pick the monthly or yearly plan." }, 400);
    if (!coachPlanOnSale(env, request, plan)) {
      const error = plan === "yearly" ? "The yearly plan is not available yet. The monthly plan opens first." : "The monthly plan is not available yet. Check back soon.";
      return json({ error, coming_soon: true, plan }, 503);
    }
    if (await hasPaidCoach(db, user)) {
      return json({ error: "You already have Grow Coach. Manage it from your account page.", already_active: true }, 409);
    }
    const session = await startCheckout(db, env, request, {
      user,
      itemId: COACH_ITEM,
      amountCents: COACH_PLANS[plan].amount_cents,
      details: { item_type: "subscription", plan, note: "Culinary Grow Coach only." },
      mode: "subscription",
      plan,
      priceId: coachPriceId(env, plan),
      name: "Grow Coach",
      successPath: "/account?checkout=success#billing",
      cancelPath: "/coach?checkout=cancel",
    });
    if (!session.ok) return json({ error: session.error, coming_soon: session.status === 503 }, session.status || 503);
    return json(session);
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
      suggestion: suggestSetpoints(grounding.device_model, grounding.stage, {
        auto: grounding.auto_tune,
        reading: grounding.current,
      }),
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
    const suggestion = suggestSetpoints(grounding.device_model, stage, {
      auto: grounding.auto_tune,
      reading: grounding.current,
    });
    let commandId = null;
    if (body.apply) {
      if (!suggestion.auto_eligible && !body.approve) {
        throw new ValidationError("Approve the change, or enable auto-tune with safe bounds.", 403);
      }
      if (!suggestion.within_bounds) throw new ValidationError("suggestion outside safe bounds", 400);
      if (body.device_id) {
        const issued = nowIso();
        const expiresAt = new Date(Date.parse(issued) + COMMAND_TTL_MS).toISOString();
        const inserted = await db.run(
          "INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)",
          [
            body.device_id,
            "setpoints",
            JSON.stringify({ ...suggestion, source: "grow-coach", approved: true, expires_at: expiresAt }),
            issued,
            null,
          ]
        );
        commandId = inserted?.meta?.last_row_id ?? inserted?.lastRowId ?? null;
      }
    }
    // `applied` means "accepted the suggestion"; `status` is what the chamber has done (queued until it confirms).
    return json({
      suggestion,
      alerts: grounding.alerts,
      applied: Boolean(body.apply),
      status: body.apply && body.device_id ? "queued" : null,
      command_id: commandId,
    });
  }

  if (method === "POST" && path === "/api/coach/auto-tune") {
    const user = await requireCoach(request, db, env);
    const body = await request.json().catch(() => ({}));
    await db.run("UPDATE coach_subs SET auto_tune=? WHERE user_id=?", [body.enabled ? 1 : 0, user.id]);
    return json({ auto_tune: Boolean(body.enabled) });
  }

  if (method === "GET" && path === "/api/coach/autopilot") {
    const user = await requireAutopilotUser(request, db, env);
    const result = await getAutopilotStatus(db, env, user, url.searchParams.get("device_id"));
    if (result.error) return json({ error: result.error }, result.status || 404);
    return json(result);
  }

  if (method === "POST" && path === "/api/coach/autopilot/mode") {
    const user = await requireAutopilotUser(request, db, env);
    const body = await request.json().catch(() => ({}));
    if (!body.device_id) throw new ValidationError("Pick a chamber first.", 400);
    const result = await setDeviceAutopilotMode(db, env, user, {
      deviceId: body.device_id,
      mode: body.mode,
      profileId: body.profile_id,
    });
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json(result);
  }

  if (method === "POST" && path === "/api/coach/autopilot/run") {
    const user = await requireAutopilotUser(request, db, env);
    const body = await request.json().catch(() => ({}));
    if (!coachAutopilotFlagOn(env)) return json({ error: "not found" }, 404);
    if (!body.device_id) throw new ValidationError("Pick a chamber first.", 400);
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [body.device_id]);
    if (!device || Number(device.owner_id) !== Number(user.id)) return json({ error: "not found" }, 404);
    const result = await runAutopilotForDevice(db, env, { device, user });
    const status = await getAutopilotStatus(db, env, user, body.device_id);
    return json({ ok: Boolean(result.applied), ...status, ...result });
  }

  if (method === "POST" && path === "/api/coach/autopilot/undo") {
    const user = await requireAutopilotUser(request, db, env);
    const body = await request.json().catch(() => ({}));
    if (!body.action_id) throw new ValidationError("Pick an action to undo.", 400);
    const result = await undoAutopilotAction(db, env, user, body.action_id);
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json(result);
  }

  if (method === "POST" && path === "/api/coach/chat") {
    const user = await requireCoach(request, db, env);
    const body = await request.json().catch(() => ({}));
    if (refuseRestrictedPack({ pack: body.pack, tags: body.tags })) {
      throw new ValidationError("Grow Coach does not discuss off-menu varieties.", 400);
    }
    await assertCap(db, env, user.id, "chats");
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
      caps: (({ chats, photos, neurons, monthly_neurons }) => ({ chats, photos, neurons, monthly_neurons }))(coachCaps(env)),
    });
  }

  if (method === "POST" && path === "/api/coach/photo") {
    const user = await requireCoach(request, db, env);
    const body = await readJsonLimited(request);
    if (refuseRestrictedPack({ pack: body.pack, tags: body.tags })) {
      throw new ValidationError("Grow Coach does not discuss off-menu varieties.", 400);
    }
    await assertCap(db, env, user.id, "photos");
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

/**
 * Turn Grow Coach on until periodEnd (default: one period from now). replaySafe keeps an
 * active plan as is, so a repeated checkout event never moves the end date.
 */
export async function activateCoachSub(db, userId, { replaySafe = false, periodEnd: explicitEnd = "", periodDays = COACH_PERIOD_DAYS } = {}) {
  const existing = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [userId]);
  if (replaySafe && existing && existing.status === "active" && existing.period_end >= nowIso()) {
    return existing.period_end;
  }
  const periodEnd = explicitEnd || laterIso(periodDays * 24 * 3600 * 1000);
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
  return periodEnd;
}
