/** Framework-free fetch handlers. Used by the Worker and the local Node server. */

import {
  affiliateLinksFor,
  assertAffiliateAllowed,
  isFree,
  isPsilocybin,
  validateProfile,
  ValidationError,
} from "./profile.js";
import { nowIso, randomToken, sha256Hex } from "./crypto.js";
import { handleAuth, requireVerified, userFromRequest } from "./auth.js";
import { handleDevices } from "./devices.js";
import { handleCoach, hasGrowCoach } from "./coach.js";
import { COACH_ITEM, COACH_PRICE_CENTS } from "./coach-learn.js";
import { applyStripeEvent, parseStripeEvent, startCheckout } from "./payments.js";
import { capabilities } from "./providers.js";
import { corsAllowlist, originAllowed, securityHeaders, verifyPaymentWebhook } from "./security.js";
import { isOffMenu, packLabel, PSI_LEGAL_NOTICE, PSI_RESOURCE_DISCLAIMER, PSI_RESOURCES, PSI_SPORE_LAW } from "./pack.js";
import { seedMissing } from "./seed.js";
import seeds from "./seeds.json" with { type: "json" };
import { handleAlerts } from "./alerts/http.js";

const DISCLOSURE =
  "Some links are affiliate links. We may earn a commission if you buy through them, at no extra cost to you.";

export const DEFAULT_CORS_ORIGINS = "https://shroomlabs.io,https://www.shroomlabs.io";

export function allowedOrigins(env, request) {
  return corsAllowlist(env, request);
}

export function pickCorsOrigin(env, request) {
  const allowed = allowedOrigins(env, request);
  const requestOrigin = request?.headers?.get?.("origin") || "";
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return allowed[0] || "*";
}

export function corsHeaders(env, request, extra = {}) {
  const origin = pickCorsOrigin(env, request);
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": origin === "*" ? "false" : "true",
    "access-control-allow-headers": "authorization, content-type, x-csrf-token",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
    ...extra,
  };
}

export function withCors(response, env, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries({ ...securityHeaders(), ...corsHeaders(env, request) })) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export function mediaUrl(env, key) {
  if (!key) return null;
  const cdn = String(env.CDN_BASE_URL || "").replace(/\/$/, "");
  if (cdn) return `${cdn}/${key}`;
  return `/api/media/${encodeURIComponent(key)}`;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function redirect(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json();
  if (type.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function userFromAuth(request, db) {
  return (await userFromRequest(request, db)).user;
}

const SEED_DOCS = new Map(seeds.map((profile) => [profile.id, profile]));

/**
 * Built-in profiles (seeded rows, no author) are served from the bundled seeds, so copy
 * fixes in data/profiles ship with the Worker. D1 rows are never rewritten for that.
 */
function parseProfile(row) {
  if (row.author_id === null && SEED_DOCS.has(row.id)) return structuredClone(SEED_DOCS.get(row.id));
  return typeof row.document === "string" ? JSON.parse(row.document) : row.document;
}

function showPsi(env) {
  return String(env.SHOW_PSILOCYBIN ?? "1") !== "0";
}

async function canRead(db, user, profile) {
  if (isFree(profile)) return true;
  if (!user) return false;
  const row = await db.one("SELECT 1 FROM entitlements WHERE user_id=? AND item_id=?", [user.id, profile.id]);
  return Boolean(row);
}

async function listProfiles(db, env, pack, q) {
  const rows = await db.all("SELECT * FROM profiles WHERE published=1");
  const query = (q || "").toLowerCase();
  return rows
    .map((row) => parseProfile(row))
    .filter((profile) => {
      if (pack === "culinary" && isPsilocybin(profile)) return false;
      if (pack === "psilocybin" && !isPsilocybin(profile)) return false;
      if (isPsilocybin(profile) && !showPsi(env)) return false;
      if (!query) return true;
      const blob = `${profile.name} ${profile.species} ${profile.strain} ${profile.summary} ${(profile.tags || []).join(" ")}`.toLowerCase();
      return blob.includes(query);
    });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env, request) });

  try {
    if (!env._seeded) {
      // Insert-if-missing in one batch. Do not row-loop: D1 would hit the Worker subrequest cap
      // (~10/26) and the old empty-table guard would never finish the catalog or the guide stub.
      await seedMissing(env.db, seeds);
      env._seeded = true;
    }
    return await route(method, path, url, request, env);
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, err.status || 400);
    if (String(err?.message) === "UNIQUE") return json({ error: "username taken" }, 409);
    return internalError(err, method, path);
  }
}

export const INTERNAL_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";

const REDACTIONS = [
  [/-----BEGIN [^-]+-----[\s\S]*?(?:-----END [^-]+-----|$)/g, "[pem]"],
  [/\b(bearer|basic)\s+\S+/gi, "$1 [redacted]"],
  [/\b(token|secret|password|passwd|api[_-]?key|authorization|cookie|session|sig(?:nature)?)(["']?\s*[:=]\s*)\S+/gi, "$1$2[redacted]"],
  [/[A-Za-z0-9+/_=-]{24,}/g, "[redacted]"],
];

/** Strip anything that looks like a credential before it reaches the log. */
export function redactForLog(value, max = 2000) {
  let text = String(value ?? "");
  for (const [re, replacement] of REDACTIONS) text = text.replace(re, replacement);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function newRequestId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generic 500 for clients; the detail goes to the server log under the same request id. */
export function internalError(err, method, path) {
  const requestId = newRequestId();
  console.error(
    JSON.stringify({
      level: "error",
      request_id: requestId,
      method,
      path: redactForLog(path, 200),
      name: redactForLog(err?.name || typeof err, 100),
      message: redactForLog(err?.message ?? err),
      stack: redactForLog(err?.stack || "", 4000),
    })
  );
  return json({ error: INTERNAL_ERROR_MESSAGE, request_id: requestId }, 500, { "x-request-id": requestId });
}

async function route(method, path, url, request, env) {
  const { db, storage } = env;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !originAllowed(env, request)) {
    if (request.headers.get("origin")) return json({ error: "origin not allowed" }, 403);
  }
  const authResponse = await handleAuth(method, path, url, request, env);
  if (authResponse) return authResponse;
  const deviceResponse = await handleDevices(method, path, url, request, env);
  if (deviceResponse) return deviceResponse;
  const coachResponse = await handleCoach(method, path, url, request, env);
  if (coachResponse) return coachResponse;
  const alertsResponse = await handleAlerts(method, path, url, request, env);
  if (alertsResponse) return alertsResponse;

  if (method === "GET" && path === "/health") {
    return json({ ok: true, site: env.SITE_NAME || "Shroom Labs", driver: db.driver, capabilities: capabilities(env, request) });
  }

  if (method === "GET" && path === "/api/capabilities") {
    return json(capabilities(env, request));
  }

  if (method === "GET" && path === "/api/me") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    const tokens = await db.all("SELECT id, name, created_at FROM api_tokens WHERE user_id=?", [user.id]);
    const entitlements = await db.all("SELECT * FROM entitlements WHERE user_id=?", [user.id]);
    const sessions = await db.all(
      "SELECT id, created_at, expires_at, revoked_at, user_agent FROM sessions WHERE user_id=?",
      [user.id]
    );
    const coachSub = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
    const recoveryLeft = await db.one(
      "SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id=? AND used_at IS NULL",
      [user.id]
    );
    return json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email || null,
        email_verified: Boolean(Number(user.email_verified)),
        role: user.role || "user",
        totp_enabled: Boolean(Number(user.totp_enabled)),
        totp_recovery_remaining: Number(recoveryLeft?.n || 0),
      },
      tokens,
      entitlements,
      sessions,
      grow_coach: {
        entitled: await hasGrowCoach(db, user),
        period_end: coachSub?.period_end || null,
        auto_tune: Boolean(Number(coachSub?.auto_tune)),
        product: { id: COACH_ITEM, amount_cents: COACH_PRICE_CENTS, pack: "culinary" },
      },
      disclosure: DISCLOSURE,
    });
  }

  if (method === "POST" && path === "/api/me/tokens") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    const body = await readJson(request);
    const token = await mintToken(db, user.id, body.name || "hub");
    return json({ token, name: body.name || "hub" });
  }

  if (method === "GET" && path === "/api/profiles") {
    const pack = url.searchParams.get("pack") || "culinary";
    const q = url.searchParams.get("q") || "";
    const profiles = await listProfiles(db, env, pack, q);
    return json(
      profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        species: profile.species,
        strain: profile.strain,
        pack: profile.pack,
        pack_label: packLabel(profile.pack),
        restricted: profile.restricted,
        summary: profile.summary,
        tags: profile.tags,
        pricing: profile.pricing,
        stages: profile.stages?.length || 0,
        stage_list: (profile.stages || []).map((s) => ({
          id: s.id,
          name: s.name,
          duration_days: s.duration_days,
        })),
      }))
    );
  }

  if (method === "GET" && path === "/api/search") {
    const pack = url.searchParams.get("pack") || "culinary";
    const q = url.searchParams.get("q") || "";
    const profiles = await listProfiles(db, env, pack, q);
    return json(profiles.map((p) => ({ id: p.id, name: p.name, species: p.species, pack: p.pack, tags: p.tags })));
  }

  const profileJson = path.match(/^\/api\/profiles\/([^/]+)\.json$/);
  if (profileJson && method === "GET") {
    return exportProfile(request, db, env, decodeURIComponent(profileJson[1]));
  }

  const profileMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch && method === "GET") {
    return showProfile(request, db, env, decodeURIComponent(profileMatch[1]));
  }

  if (method === "POST" && path === "/api/profiles") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profile = validateProfile(await readJson(request));
    profile.author = user.username;
    await upsertProfile(db, profile, user.id);
    return json(profile, 201);
  }

  const rateMatch = path.match(/^\/api\/profiles\/([^/]+)\/rate$/);
  if (rateMatch && method === "POST") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const body = await readJson(request);
    const stars = Number(body.stars);
    if (stars < 1 || stars > 5) throw new ValidationError("stars must be 1-5");
    await requireProfile(db, decodeURIComponent(rateMatch[1]));
    await db.run("INSERT OR REPLACE INTO ratings (user_id, profile_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?)", [
      user.id,
      decodeURIComponent(rateMatch[1]),
      stars,
      String(body.comment || ""),
      nowIso(),
    ]);
    return json({ ok: true });
  }

  const forkMatch = path.match(/^\/api\/profiles\/([^/]+)\/fork$/);
  if (forkMatch && method === "POST") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const source = await requireProfile(db, decodeURIComponent(forkMatch[1]));
    if (!(await canRead(db, user, source))) return json({ error: "purchase required" }, 402);
    const forked = structuredClone(source);
    forked.id = `${source.id}-fork-${user.username}`;
    forked.name = `${source.name} (fork)`;
    forked.fork_of = source.id;
    forked.author = user.username;
    forked.pricing = { kind: "free", amount_cents: 0, currency: "USD", creator_share_percent: 70 };
    forked.allowed_payment_providers = [];
    if (isPsilocybin(forked)) {
      forked.affiliates_allowed = false;
      forked.affiliate_links = [];
    }
    validateProfile(forked);
    await upsertProfile(db, forked, user.id);
    return json(forked, 201);
  }

  const reportMatch = path.match(/^\/api\/profiles\/([^/]+)\/reports$/);
  if (reportMatch && method === "POST") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profileId = decodeURIComponent(reportMatch[1]);
    await requireProfile(db, profileId);
    const body = await readJson(request);
    if (!["success", "partial", "fail"].includes(body.outcome)) throw new ValidationError("bad outcome");
    let photoKey = null;
    if (body.photo_base64) {
      const raw = Uint8Array.from(atob(body.photo_base64), (c) => c.charCodeAt(0));
      const caps = capabilities(env, request);
      if (!caps.photos) {
        photoKey = null;
      } else {
        photoKey = `reports/${profileId}/${randomToken()}.${body.photo_ext || "jpg"}`;
        await storage.put(photoKey, raw, body.photo_type || "image/jpeg");
      }
    }
    await db.run(
      "INSERT INTO grow_reports (profile_id, author_id, outcome, notes, days, flushes, device_name, photo_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        profileId,
        user.id,
        body.outcome,
        body.notes || "",
        body.days ? Number(body.days) : null,
        body.flushes ? Number(body.flushes) : null,
        body.device_name || null,
        photoKey,
        nowIso(),
      ]
    );
    return json({ ok: true, photo_key: photoKey }, 201);
  }

  const checkoutMatch = path.match(/^\/api\/profiles\/([^/]+)\/checkout$/);
  if (checkoutMatch && method === "POST") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profile = await requireProfile(db, decodeURIComponent(checkoutMatch[1]));
    if (isPsilocybin(profile)) {
      throw new ValidationError("Psilocybin pack is free-only. Card processors cannot be attached.");
    }
    if (isFree(profile)) throw new ValidationError("free items do not go through checkout");
    const allowed = profile.allowed_payment_providers || [];
    if (!allowed.includes("stripe")) throw new ValidationError("no configured payment provider in " + allowed);
    const session = await startCheckout(db, env, request, {
      userId: user.id,
      itemId: profile.id,
      amountCents: profile.pricing.amount_cents,
      details: { note: "Culinary checkout." },
    });
    if (!session.ok) return json({ error: session.error, coming_soon: true }, session.status || 503);
    return json(session);
  }

  if (method === "POST" && path === "/api/payments/webhook") {
    const raw = await request.text();
    const signature = request.headers.get("stripe-signature") || request.headers.get("x-webhook-signature") || "";
    const verified = await verifyPaymentWebhook(env, raw, signature);
    if (!verified.ok) return json({ error: "invalid webhook signature" }, 401);
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      throw new ValidationError("webhook body must be JSON");
    }
    const event = parseStripeEvent(body);
    if (!event) throw new ValidationError("Stripe event object required");
    const result = await applyStripeEvent(db, event);
    return json({ ok: true, provider: "stripe", ...result });
  }

  if (method === "GET" && path === "/api/guides") {
    const rows = await db.all("SELECT * FROM guides");
    return json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        pricing: typeof row.pricing === "string" ? JSON.parse(row.pricing) : row.pricing,
      }))
    );
  }

  const goMatch = path.match(/^\/api\/go\/([^/]+)\/([^/]+)$/);
  if (goMatch && method === "GET") {
    const profile = await requireProfile(db, decodeURIComponent(goMatch[1]));
    const link = affiliateLinksFor(profile).find((item) => item.id === decodeURIComponent(goMatch[2]));
    if (!link) return json({ error: "no affiliate link" }, 404);
    assertAffiliateAllowed(profile, link);
    const user = await userFromAuth(request, db);
    await db.run(
      "INSERT INTO affiliate_clicks (link_id, profile_id, user_id, destination, created_at) VALUES (?, ?, ?, ?, ?)",
      [link.id, profile.id, user?.id || null, link.url, nowIso()]
    );
    return redirect(link.url);
  }

  const mediaMatch = path.match(/^\/api\/media\/(.+)$/);
  if (mediaMatch && method === "GET") {
    const file = await storage.get(decodeURIComponent(mediaMatch[1]));
    if (!file) return json({ error: "not found" }, 404);
    return new Response(file.bytes, { headers: { "content-type": file.contentType } });
  }

  if (method === "GET" && path === "/api/hub/pull") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "hub token required" }, 401);
    const culinary = await listProfiles(db, env, "culinary", url.searchParams.get("q") || "");
    const extra = showPsi(env) ? await listProfiles(db, env, "psilocybin", url.searchParams.get("q") || "") : [];
    const exported = [];
    for (const profile of [...culinary, ...extra]) {
      if (isPsilocybin(profile) || (await canRead(db, user, profile))) exported.push(profile);
    }
    return json({ profiles: exported, hub_user: user.username });
  }

  if (method === "POST" && path === "/api/hub/push") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "hub token required" }, 401);
    const payload = await readJson(request);
    let imported = 0;
    for (const item of payload.profiles || []) {
      const profile = validateProfile(item);
      if (isPsilocybin(profile)) {
        profile.affiliates_allowed = false;
        profile.affiliate_links = [];
        profile.pricing = { kind: "free", amount_cents: 0, currency: "USD", creator_share_percent: 70 };
        profile.allowed_payment_providers = [];
      }
      await upsertProfile(db, profile, user.id);
      imported += 1;
    }
    for (const report of payload.grow_reports || []) {
      const exists = await db.one("SELECT * FROM profiles WHERE id=?", [report.profile_id]);
      if (!exists) continue;
      await db.run(
        "INSERT INTO grow_reports (profile_id, author_id, outcome, notes, days, flushes, device_name, photo_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          report.profile_id,
          user.id,
          report.outcome,
          report.notes || "",
          report.days ?? null,
          report.flushes ?? null,
          report.device_name || null,
          null,
          nowIso(),
        ]
      );
    }
    return json({ imported, reports: (payload.grow_reports || []).length });
  }

  if (method === "GET" && path === "/api/supplies") {
    return json({
      disclosure: DISCLOSURE,
      items: [
        {
          id: "hardwood-pellets",
          name: "Hardwood fuel pellets",
          url: "https://example.com/affiliate/hardwood-pellets",
        },
        {
          id: "master-spawn-bag",
          name: "Filter-patch grow bags",
          url: "https://example.com/affiliate/grow-bags",
        },
      ],
    });
  }

  return json({ error: "not found" }, 404);
}

async function mintToken(db, userId, name) {
  const token = randomToken();
  await db.run("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)", [
    userId,
    name,
    await sha256Hex(token),
    nowIso(),
  ]);
  return token;
}

async function upsertProfile(db, profile, authorId) {
  const ts = nowIso();
  await db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    [profile.id, JSON.stringify(profile), authorId, ts, ts]
  );
}

async function requireProfile(db, profileId) {
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
  if (!row) throw new ValidationError("profile not found", 404);
  return validateProfile(parseProfile(row));
}

async function showProfile(request, db, env, profileId) {
  const profile = await requireProfile(db, profileId);
  if (isPsilocybin(profile) && !showPsi(env)) return json({ error: "not found" }, 404);
  const user = await userFromAuth(request, db);
  const unlocked = await canRead(db, user, profile);
  const ratings = await db.all(
    "SELECT ratings.*, users.username FROM ratings JOIN users ON users.id = ratings.user_id WHERE profile_id=?",
    [profileId]
  );
  const avgRow = await db.one("SELECT AVG(stars) AS a FROM ratings WHERE profile_id=?", [profileId]);
  const reports = (await db.all("SELECT * FROM grow_reports WHERE profile_id=? ORDER BY id DESC LIMIT 20", [profileId])).map(
    (report) => ({ ...report, photo_url: mediaUrl(env, report.photo_key) })
  );
  const publicDoc = unlocked
    ? profile
    : {
        id: profile.id,
        name: profile.name,
        species: profile.species,
        summary: profile.summary,
        pricing: profile.pricing,
        pack: profile.pack,
        stages: profile.stages.map((s) => ({ id: s.id, name: s.name, duration_days: s.duration_days })),
      };
  const offMenu = isOffMenu(profile) || isPsilocybin(profile);
  return json({
    profile: {
      ...publicDoc,
      pack_label: packLabel(profile.pack),
      legal_notice: offMenu ? PSI_LEGAL_NOTICE : publicDoc.legal_notice,
    },
    unlocked,
    ratings,
    avg: avgRow?.a ?? null,
    reports,
    links: offMenu ? [] : unlocked ? affiliateLinksFor(profile) : [],
    disclosure: offMenu ? "" : DISCLOSURE,
    resources: offMenu
      ? { disclaimer: PSI_RESOURCE_DISCLAIMER, spore_law: PSI_SPORE_LAW, links: PSI_RESOURCES }
      : null,
  });
}

async function exportProfile(request, db, env, profileId) {
  const profile = await requireProfile(db, profileId);
  if (isPsilocybin(profile) && !showPsi(env)) return json({ error: "not found" }, 404);
  const user = await userFromAuth(request, db);
  if (!(await canRead(db, user, profile))) return json({ error: "purchase required" }, 402);
  await db.run("UPDATE profiles SET downloads=downloads+1 WHERE id=?", [profileId]);
  return json(profile);
}
