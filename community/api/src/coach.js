/** Paid Grow Coach: gating, learning, chat, photo check, alerts. */

import { laterIso, nowIso, randomToken, sha256Hex } from "./crypto.js";
import { requireVerified, userFromRequest } from "./auth.js";
import { ValidationError, isPsilocybin } from "./profile.js";
import { createModelProvider } from "./coach-models.js";
import {
  COACH_ITEM,
  COACH_PERIOD_DAYS,
  COACH_PRICE_CENTS,
  SAFE_BOUNDS,
  buildDeviceModel,
  detectAlerts,
  estimateNeurons,
  refuseRestrictedPack,
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
      "Per-chamber coaching for culinary grows: learned setpoints, photo checks, and alerts. Not sold or marketed with off-menu varieties.",
  };
}

export async function hasGrowCoach(db, user) {
  if (!user) return false;
  const sub = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  if (sub && sub.status === "active" && sub.period_end >= nowIso()) return true;
  const row = await db.one("SELECT * FROM entitlements WHERE user_id=? AND item_id=?", [user.id, COACH_ITEM]);
  return Boolean(row);
}

async function requireCoach(request, db) {
  const { user } = await userFromRequest(request, db);
  requireVerified(user);
  if (!(await hasGrowCoach(db, user))) {
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

async function loadGrounding(db, user, deviceId) {
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
  const culinary = profiles.filter((p) => !isPsilocybin(p)).map((p) => ({
    id: p.id,
    name: p.name,
    species: p.species,
    stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name, humidity_percent: s.humidity_percent, temperature_c: s.temperature_c })),
  }));
  const stage = culinary[0]?.stages?.[0] || {};
  const alerts = detectAlerts(model, samples, stage);
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
    library: culinary.slice(0, 12),
    safe_bounds: SAFE_BOUNDS,
    auto_tune: Boolean(Number(settings?.auto_tune)),
    samples,
    stage,
  };
}

function slimGrounding(grounding) {
  return {
    device: grounding.device,
    device_model: grounding.device_model,
    alerts: grounding.alerts,
    journal: grounding.journal,
    library: grounding.library,
    safe_bounds: grounding.safe_bounds,
    auto_tune: grounding.auto_tune,
    stage: grounding.stage,
  };
}

export async function handleCoach(method, path, url, request, env) {
  const { db, storage } = env;

  if (method === "GET" && path === "/api/coach") {
    const { user } = await userFromRequest(request, db);
    const entitled = user ? await hasGrowCoach(db, user) : false;
    const sub = user ? await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]) : null;
    return json({
      product: coachCatalog(),
      entitled,
      auto_tune: Boolean(Number(sub?.auto_tune)),
      period_end: sub?.period_end || null,
      marketing:
        "Grow Coach learns each culinary chamber and suggests safer humidity and temperature. It is not sold with off-menu varieties.",
    });
  }

  if (method === "POST" && path === "/api/coach/subscribe") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const body = await request.json().catch(() => ({}));
    if (body.pack === "psilocybin") {
      throw new ValidationError("Grow Coach is not sold or marketed with off-menu varieties.", 400);
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
        JSON.stringify({ item_type: "subscription", note: "Stripe stub. Culinary Grow Coach only." }),
        nowIso(),
      ]
    );
    return json({
      id: sessionId,
      provider: "stripe",
      amount_cents: COACH_PRICE_CENTS,
      item_id: COACH_ITEM,
      checkout_url: `/pay/stub/${sessionId}`,
    });
  }

  if (method === "POST" && path === "/api/coach/complete-entitlement") {
    return json({ error: "use /api/pay/{id}/complete" }, 400);
  }

  if (method === "GET" && path === "/api/coach/model") {
    const user = await requireCoach(request, db);
    const grounding = await loadGrounding(db, user, url.searchParams.get("device_id"));
    return json({
      device: grounding.device,
      model: grounding.device_model,
      alerts: grounding.alerts,
      suggestion: suggestSetpoints(grounding.device_model, grounding.stage, { auto: grounding.auto_tune }),
    });
  }

  if (method === "POST" && path === "/api/coach/suggest") {
    const user = await requireCoach(request, db);
    const body = await request.json().catch(() => ({}));
    if (refuseRestrictedPack(body.profile)) {
      throw new ValidationError("Grow Coach will not auto-tune off-menu varieties.", 400);
    }
    const grounding = await loadGrounding(db, user, body.device_id);
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
    const user = await requireCoach(request, db);
    const body = await request.json().catch(() => ({}));
    await db.run("UPDATE coach_subs SET auto_tune=? WHERE user_id=?", [body.enabled ? 1 : 0, user.id]);
    return json({ auto_tune: Boolean(body.enabled) });
  }

  if (method === "POST" && path === "/api/coach/chat") {
    const user = await requireCoach(request, db);
    const body = await request.json().catch(() => ({}));
    if (refuseRestrictedPack({ pack: body.pack, tags: body.tags })) {
      throw new ValidationError("Grow Coach does not discuss off-menu varieties.", 400);
    }
    await assertCap(db, user.id, "chats");
    const grounding = await loadGrounding(db, user, body.device_id);
    const cacheKey = await sha256Hex(`chat:${user.id}:${body.device_id || ""}:${body.message || ""}`);
    const hit = await cacheGet(db, cacheKey);
    if (hit) return json({ ...hit, cached: true });
    const provider = createModelProvider(env);
    const result = await provider.chat({ message: body.message, grounding: slimGrounding(grounding) });
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
    const user = await requireCoach(request, db);
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
    const user = await requireCoach(request, db);
    const body = await request.json().catch(() => ({}));
    if (refuseRestrictedPack({ pack: body.pack, tags: body.tags })) {
      throw new ValidationError("Grow Coach does not discuss off-menu varieties.", 400);
    }
    await assertCap(db, user.id, "photos");
    if (!body.photo_base64) throw new ValidationError("photo_base64 required");
    const raw = Uint8Array.from(atob(body.photo_base64), (c) => c.charCodeAt(0));
    const key = `coach/${user.id}/${randomToken()}.${body.photo_ext || "jpg"}`;
    await storage.put(key, raw, body.photo_type || "image/jpeg");
    const provider = createModelProvider(env);
    const result = await provider.vision({ imageBase64: body.photo_base64, hint: body.hint || body.notes || "" });
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
    const user = await requireCoach(request, db);
    const grounding = await loadGrounding(db, user, url.searchParams.get("device_id"));
    return json({ alerts: grounding.alerts, model: grounding.device_model });
  }

  return null;
}

export async function activateCoachSub(db, userId) {
  const periodEnd = laterIso(COACH_PERIOD_DAYS * 24 * 3600 * 1000);
  const existing = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [userId]);
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
