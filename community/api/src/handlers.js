/** Framework-free fetch handlers. Used by the Worker and the local Node server. */

import {
  affiliateLinksFor,
  assertAffiliateAllowed,
  isFree,
  isPsilocybin,
  serveProfileDocument,
  stripCommunityAffiliates,
  normalizeStoredProfileLight,
  validateProfile,
  validateStoredProfile,
  ValidationError,
} from "./profile.js";
import { reviewConfirmExtra, slugify } from "./profile-schema.js";
import { decodePhotoBase64, mediaFilename, processPhoto, sniffImage, PHOTO_TYPES } from "./photos.js";
import { nowIso, randomToken, sha256Hex } from "./crypto.js";
import { handleAuth, requireVerified, userFromRequest } from "./auth.js";
import { handleDevices } from "./devices.js";
import { handleFleet } from "./fleet.js";
import { handleAccount } from "./account.js";
import { handleAdmin } from "./admin.js";
import { coachPlans, coachVisible, handleCoach } from "./coach.js";
import { coachAccess } from "./coach-access.js";
import { coachAutopilotFlagOn } from "./coach-autopilot.js";
import { COACH_ITEM, COACH_PRICE_CENTS } from "./coach-learn.js";
import { applyStripeEvent, coachCustomerFor, openBillingPortal, parseStripeEvent, startCheckout } from "./payments.js";
import { capabilities, paymentsConfigured } from "./providers.js";
import { profilePriceFor } from "./stripe.js";
import { corsAllowlist, originAllowed, rateLimit, rateLimitClient, securityHeaders, verifyPaymentWebhook } from "./security.js";
import { isOffMenu, packLabel, PSI_LEGAL_NOTICE, PSI_RESOURCE_DISCLAIMER, PSI_RESOURCES, PSI_SPORE_LAW } from "./pack.js";
import { seedMissing } from "./seed.js";
import seeds from "./seeds.json" with { type: "json" };
import { handleAlerts } from "./alerts/http.js";
import { handleLive } from "./live.js";
import { handleReview } from "./review-http.js";
import { readJsonLimited } from "./http-body.js";
import { canSeeMedia, getMedia, mediaApiUrl, mediaApproved } from "./media-acl.js";
import { feedMediaHeaders, handleFeed } from "./feed.js";
import {
  canSeeProfile,
  getReview,
  isModerator,
  isPublicProfile,
  isPublicRow,
  canSeePhoto,
  canServeReportPhoto,
  offmenuVisible,
  photoIsPublic,
  publicDocument,
  reportPhotoApproved,
  requireVisibleRow,
  reviewView,
  saveDraftReview,
  storeReportPhoto,
} from "./review.js";

const DISCLOSURE =
  "Some links are affiliate links. We may earn a commission if you buy through them, at no extra cost to you.";

/** The affiliate note shows only next to links that are actually affiliate links. */
export function disclosureFor(links) {
  return Array.isArray(links) && links.length ? DISCLOSURE : "";
}

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
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
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
  return mediaApiUrl(env, key);
}

function reportPhotoPayload(env, report, viewer) {
  if (!report.photo_key) return { photo_key: null, photo_url: null, photo_status: null };
  const status = report.photo_status || "approved";
  const acl = { owner_id: report.author_id, status };
  if (!canSeeMedia(viewer, acl)) {
    return { photo_key: null, photo_url: null, photo_status: null };
  }
  return {
    photo_key: report.photo_key,
    photo_url: mediaApiUrl(env, report.photo_key),
    photo_status: status,
  };
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
  return readJsonLimited(request);
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
  try {
    if (row.author_id === null && SEED_DOCS.has(row.id)) return structuredClone(SEED_DOCS.get(row.id));
    return typeof row.document === "string" ? JSON.parse(row.document) : row.document;
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "warn",
        event: "malformed_profile_document",
        id: row?.id,
        message: String(err?.message || err).slice(0, 200),
      })
    );
    return null;
  }
}

function serveExtra(review, profile) {
  return {
    ...reviewConfirmExtra(review, profile),
    title: review?.title,
    description: review?.description,
  };
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
  // Two queries for the whole library. One review lookup per profile made this
  // endpoint 50+ serial D1 round trips (1.2-2.2 s on prod).
  const [rows, reviewRows] = await Promise.all([
    db.all("SELECT * FROM profiles"),
    db.all("SELECT * FROM profile_review"),
  ]);
  const reviews = new Map((reviewRows || []).map((r) => [r.profile_id, r]));
  const query = (q || "").toLowerCase();
  const out = [];
  for (const row of rows) {
    const review = reviews.get(row.id) || null;
    if (!isPublicRow(row, review)) continue;
    const working = parseProfile(row);
    if (!working) continue;
    const extra = serveExtra(review, working);
    const profile = serveProfileDocument(publicDocument(row, review, working), extra);
    if (!profile) continue;
    if (pack === "culinary" && isPsilocybin(profile, extra)) continue;
    if (pack === "psilocybin" && !isPsilocybin(profile, extra)) continue;
    if (isPsilocybin(profile, extra) && !showPsi(env)) continue;
    if (query) {
      const blob = `${profile.name} ${profile.species} ${profile.strain} ${profile.summary} ${(profile.tags || []).join(" ")}`.toLowerCase();
      if (!blob.includes(query)) continue;
    }
    out.push(profile);
  }
  return out;
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env, request) });

  try {
    if (!env._seeded) {
      // Insert-if-missing in one batch. Share one in-flight seed so concurrent first
      // requests (and Miniflare D1) do not overlap batch + first() calls.
      env._seeding ||= seedMissing(env.db, seeds)
        .then(() => {
          env._seeded = true;
        })
        .catch((err) => {
          env._seeding = null;
          throw err;
        });
      await env._seeding;
    }
    return await route(method, path, url, request, env);
  } catch (err) {
    if (err instanceof ValidationError) {
      const body = { error: err.message };
      if (err.code) {
        body.code = err.code;
        if (err.code === "revoked") body.status = "revoked";
      }
      return json(body, err.status || 400);
    }
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

function allowAppleFormPost(path, request) {
  return (
    path === "/api/auth/oidc/apple/callback" &&
    request.method.toUpperCase() === "POST" &&
    request.headers.get("origin") === "https://appleid.apple.com"
  );
}

async function route(method, path, url, request, env) {
  const { db, storage } = env;
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS" &&
    !originAllowed(env, request) &&
    !allowAppleFormPost(path, request)
  ) {
    if (request.headers.get("origin")) return json({ error: "origin not allowed" }, 403);
  }
  const authResponse = await handleAuth(method, path, url, request, env);
  if (authResponse) return authResponse;
  const adminResponse = await handleAdmin(method, path, url, request, env);
  if (adminResponse) return adminResponse;
  const liveResponse = await handleLive(method, path, url, request, env);
  if (liveResponse) return liveResponse;
  const deviceResponse = await handleDevices(method, path, url, request, env);
  if (deviceResponse) return deviceResponse;
  const fleetResponse = await handleFleet(method, path, url, request, env);
  if (fleetResponse) return fleetResponse;
  const coachResponse = await handleCoach(method, path, url, request, env);
  if (coachResponse) return coachResponse;
  const alertsResponse = await handleAlerts(method, path, url, request, env);
  if (alertsResponse) return alertsResponse;
  const accountResponse = await handleAccount(method, path, url, request, env);
  if (accountResponse) return accountResponse;
  const feedResponse = await handleFeed(method, path, url, request, env);
  if (feedResponse) return feedResponse;
  const reviewResponse = await handleReview(method, path, url, request, env, {
    seeds: SEED_DOCS,
    parseProfileRow: parseProfile,
    upsertProfile,
    requireProfile,
  });
  if (reviewResponse) return reviewResponse;

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
    return json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email || null,
        email_verified: Boolean(Number(user.email_verified)),
        role: user.role || "user",
      },
      tokens,
      entitlements,
      sessions,
      // Grow Coach shows when this user has access (paid, beta or comp) or Coach is open to the
      // public (COACH_PUBLIC). Everyone else gets no Coach details.
      grow_coach: (await coachVisible(env, db, user, request))
        ? await (async () => {
            const access = await coachAccess(env, db, user);
            const entitled = coachAutopilotFlagOn(env) && access.entitled;
            return {
            available: true,
            entitled,
            beta: entitled && access.via !== "paid",
            access: entitled ? access.via : null,
            period_end: coachSub?.period_end || null,
            auto_tune: Boolean(Number(coachSub?.auto_tune)),
            product: { id: COACH_ITEM, amount_cents: COACH_PRICE_CENTS, plans: coachPlans(env, request), pack: "culinary" },
            };
          })()
        : { available: false },
      // Show "Manage billing" only to people Stripe knows about.
      billing_portal: paymentsConfigured(env) && Boolean(await coachCustomerFor(db, user.id)),
    });
  }

  if (method === "POST" && path === "/api/me/tokens") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    const body = await readJson(request);
    // "mobile-access" is the website sign-in token name; a hub token must never pass as one.
    const requested = String(body.name || "hub").trim().slice(0, 80) || "hub";
    const name = requested.toLowerCase() === "mobile-access" ? "hub" : requested;
    const token = await mintToken(db, user.id, name);
    return json({ token, name });
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
    const profile = validateProfile(stripCommunityAffiliates(await readJson(request)));
    profile.author = user.username;
    const reserved = reservedProfileIdReason(profile.id);
    if (reserved) throw new ValidationError(reserved, 409);
    const existing = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
    if (existing) throw new ValidationError("That profile id is already used.", 409);
    await upsertProfile(db, profile, user, { published: 0 });
    await saveDraftReview(db, profile);
    const review = await getReview(db, profile.id);
    return json({ ...profile, review: reviewView(review) }, 201);
  }

  const rateMatch = path.match(/^\/api\/profiles\/([^/]+)\/rate$/);
  if (rateMatch && method === "POST") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const body = await readJson(request);
    const stars = Number(body.stars);
    if (stars < 1 || stars > 5) throw new ValidationError("stars must be 1-5");
    const rateRow = await requireVisibleRow(db, user, decodeURIComponent(rateMatch[1]));
    await requireProfile(db, rateRow.id);
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
    const forkRow = await requireVisibleRow(db, user, decodeURIComponent(forkMatch[1]));
    const forkReview = await getReview(db, forkRow.id);
    const forkWorking = parseProfile(forkRow);
    if (!forkWorking) throw new ValidationError("not found", 404);
    const staff = isModerator(user) || Number(user.id) === Number(forkRow.author_id);
    const source = staff ? forkWorking : publicDocument(forkRow, forkReview, forkWorking);
    if (!source) throw new ValidationError("not found", 404);
    if (!(await canRead(db, user, source))) return json({ error: "purchase required" }, 402);
    const forked = normalizeStoredProfileLight(source);
    forked.id = await nextForkId(db, source.id, user.username);
    forked.name = `${source.name} (fork)`;
    forked.fork_of = source.id;
    forked.author = user.username;
    forked.pricing = { kind: "free", amount_cents: 0, currency: "USD", creator_share_percent: 70 };
    forked.allowed_payment_providers = [];
    if (isPsilocybin(forked)) {
      forked.affiliates_allowed = false;
      forked.affiliate_links = [];
    }
    const cleaned = validateProfile(stripCommunityAffiliates(forked));
    Object.assign(forked, cleaned);
    await upsertProfile(db, forked, user, { published: 0 });
    await saveDraftReview(db, forked);
    return json(forked, 201);
  }

  const reportMatch = path.match(/^\/api\/profiles\/([^/]+)\/reports$/);
  if (reportMatch && method === "POST") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profileId = decodeURIComponent(reportMatch[1]);
    await requireVisibleRow(db, user, profileId);
    const body = await readJson(request);
    if (!["success", "partial", "fail"].includes(body.outcome)) throw new ValidationError("bad outcome");
    const reportLimit = await rateLimit(db, `report:${user.id}:${rateLimitClient(request)}`, 20, 3600);
    if (!reportLimit.ok) throw new ValidationError("Too many grow reports this hour.", 429);
    let photoKey = null;
    let photoStatus = "approved";
    if (body.photo_base64) {
      const raw = decodePhotoBase64(body.photo_base64);
      const caps = capabilities(env, request);
      if (caps.photos) {
        const stored = await storeReportPhoto(db, env, request, { profileId, user, raw });
        photoKey = stored.photoKey;
        photoStatus = stored.photoStatus;
      } else {
        processPhoto(raw);
      }
    }
    await db.run(
      "INSERT INTO grow_reports (profile_id, author_id, outcome, notes, days, flushes, device_name, photo_key, photo_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        profileId,
        user.id,
        body.outcome,
        body.notes || "",
        body.days ? Number(body.days) : null,
        body.flushes ? Number(body.flushes) : null,
        body.device_name || null,
        photoKey,
        photoKey ? photoStatus : "approved",
        nowIso(),
      ]
    );
    return json({ ok: true, photo_key: photoKey, photo_status: photoKey ? photoStatus : null }, 201);
  }

  const checkoutMatch = path.match(/^\/api\/profiles\/([^/]+)\/checkout$/);
  if (checkoutMatch && method === "POST") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const checkoutRow = await requireVisibleRow(db, user, decodeURIComponent(checkoutMatch[1]));
    const profile = await profileForAction(db, user, checkoutRow);
    const checkoutReview = await getReview(db, checkoutRow.id);
    if (isPsilocybin(profile, serveExtra(checkoutReview, profile))) {
      throw new ValidationError("Psilocybin pack is free-only. Card processors cannot be attached.");
    }
    if (isFree(profile)) throw new ValidationError("free items do not go through checkout");
    // A purchase is for good, so a second checkout would only charge twice.
    if (await canRead(db, user, profile)) return json({ error: "already owned" }, 409);
    const allowed = profile.allowed_payment_providers || [];
    if (!allowed.includes("stripe")) throw new ValidationError("no configured payment provider in " + allowed);
    const session = await startCheckout(db, env, request, {
      user,
      itemId: profile.id,
      amountCents: profile.pricing.amount_cents,
      // Built-in paid profiles sell through their own synced Stripe Price. No price, no sale.
      priceId: profilePriceFor(env, profile)?.price || "",
      requirePrice: true,
      details: { note: "Culinary checkout." },
      name: profile.name || "Grow profile",
      // Stripe fills in {CHECKOUT_SESSION_ID}. The site uses it only as the analytics transaction id.
      successPath: `/profile?id=${encodeURIComponent(checkoutRow.id)}&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelPath: `/profile?id=${encodeURIComponent(checkoutRow.id)}&checkout=cancel`,
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

  if (method === "POST" && path === "/api/billing/portal") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    const portal = await openBillingPortal(db, env, user);
    if (!portal.ok) return json({ error: portal.error }, portal.status || 503);
    return json({ url: portal.url });
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
    const user = await userFromAuth(request, db);
    const goRow = await requireVisibleRow(db, user, decodeURIComponent(goMatch[1]));
    const profile = await profileForAction(db, user, goRow);
    const goReview = await getReview(db, goRow.id);
    const goExtra = serveExtra(goReview, profile);
    const link = affiliateLinksFor(profile, goExtra).find((item) => item.id === decodeURIComponent(goMatch[2]));
    if (!link) return json({ error: "no affiliate link" }, 404);
    assertAffiliateAllowed(profile, link);
    await db.run(
      "INSERT INTO affiliate_clicks (link_id, profile_id, user_id, destination, created_at) VALUES (?, ?, ?, ?, ?)",
      [link.id, profile.id, user?.id || null, link.url, nowIso()]
    );
    return redirect(link.url);
  }

  const mediaMatch = path.match(/^\/api\/media\/(.+)$/);
  if (mediaMatch && method === "GET") {
    const key = decodeURIComponent(mediaMatch[1]);
    if (!key || key.includes("..") || key.includes("\\") || key.includes("\0")) {
      return json({ error: "not found" }, 404);
    }
    const row = await getMedia(db, key);
    const viewer = await userFromAuth(request, db);
    if (!canSeeMedia(viewer, row)) return json({ error: "not found" }, 404);
    const file = await storage.get(key);
    if (!file) return json({ error: "not found" }, 404);
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const kind = sniffImage(bytes);
    if (!kind) return json({ error: "not found" }, 404);
    const gallery = await db.one("SELECT * FROM profile_photos WHERE object_key=?", [key]);
    if (gallery) {
      const ownerRow = await db.one("SELECT * FROM profiles WHERE id=?", [gallery.profile_id]);
      if (!canSeePhoto(gallery, viewer, ownerRow?.author_id)) return json({ error: "not found" }, 404);
      if (!(await offmenuVisible(db, env, viewer, ownerRow, { pending: !photoIsPublic(gallery) }))) {
        return json({ error: "not found" }, 404);
      }
    }
    const report = await db.one("SELECT * FROM grow_reports WHERE photo_key=?", [key]);
    if (report && !(await canServeReportPhoto(db, env, viewer, report))) return json({ error: "not found" }, 404);
    const feedPost = await feedMediaHeaders(db, key);
    if (feedPost.gone) return json({ error: "not found" }, 404);
    const headers = {
      "content-type": PHOTO_TYPES[kind],
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="${mediaFilename(kind)}"`,
      "content-security-policy": "default-src 'none'",
    };
    if (!mediaApproved(row) || (report && !reportPhotoApproved(report)) || (gallery && !photoIsPublic(gallery)) || feedPost.private) {
      headers["cache-control"] = "private, no-store";
    }
    return new Response(bytes, { headers });
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
    const mine = await db.all("SELECT * FROM profiles WHERE author_id=?", [user.id]);
    for (const row of mine) {
      const stored = parseProfile(row);
      if (!stored) continue;
      const profile = normalizeStoredProfileLight(stored);
      if (!exported.some((p) => p.id === profile.id)) exported.push(profile);
    }
    return json({ profiles: exported, hub_user: user.username });
  }

  if (method === "POST" && path === "/api/hub/push") {
    const user = await userFromAuth(request, db);
    if (!user) return json({ error: "hub token required" }, 401);
    const payload = await readJson(request);
    const results = [];
    for (const item of payload.profiles || []) {
      results.push(await pushOneProfile(db, item, user));
    }
    for (const report of payload.grow_reports || []) {
      const exists = await db.one("SELECT * FROM profiles WHERE id=?", [report.profile_id]);
      if (!exists || !(await canSeeProfile(db, user, exists))) continue;
      await db.run(
        "INSERT INTO grow_reports (profile_id, author_id, outcome, notes, days, flushes, device_name, photo_key, photo_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          report.profile_id,
          user.id,
          report.outcome,
          report.notes || "",
          report.days ?? null,
          report.flushes ?? null,
          report.device_name || null,
          null,
          "approved",
          nowIso(),
        ]
      );
    }
    const imported = results.filter((row) => row.status === "created" || row.status === "updated").length;
    return json({ imported, results, reports: (payload.grow_reports || []).length });
  }

  if (method === "GET" && path === "/api/supplies") {
    // No partner links yet. The page hides the supplies block when this list is empty.
    const items = [];
    return json({ disclosure: disclosureFor(items), items });
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

function reservedProfileIdReason(id) {
  if (typeof id !== "string" || !id) return "Give this profile an id, like pearl-oyster.";
  if (id.includes("-fork-")) return "That id is reserved for profile forks.";
  if (SEED_DOCS.has(id)) return "That profile id is reserved for the official catalog.";
  return null;
}

async function nextForkId(db, sourceId, username) {
  const handle = slugify(username) || "grower";
  let id = `${sourceId}-fork-${handle}`;
  let n = 2;
  while (await db.one("SELECT * FROM profiles WHERE id=?", [id])) {
    id = `${sourceId}-fork-${handle}-${n}`;
    n += 1;
  }
  return id;
}

async function pushOneProfile(db, item, user) {
  const id = item?.id || "";
  try {
    const reserved = reservedProfileIdReason(id);
    if (reserved) return { id, status: "skipped", reason: SEED_DOCS.has(id) ? "official" : "reserved_fork_id" };
    const profile = validateProfile(stripCommunityAffiliates(item));
    if (isPsilocybin(profile)) {
      profile.affiliates_allowed = false;
      profile.affiliate_links = [];
      profile.pricing = { kind: "free", amount_cents: 0, currency: "USD", creator_share_percent: 70 };
      profile.allowed_payment_providers = [];
    }
    const existing = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
    if (existing && existing.author_id == null) {
      return { id: profile.id, status: "skipped", reason: "official" };
    }
    if (existing && Number(existing.author_id) !== Number(user.id)) {
      return { id: profile.id, status: "skipped", reason: "owned_by_other" };
    }
    const priorRow = existing ? { ...existing, document: existing.document } : null;
    await upsertProfile(db, profile, user, { published: 0 });
    await saveDraftReview(db, profile, { priorRow });
    return { id: profile.id, status: existing ? "updated" : "created" };
  } catch (err) {
    return { id, status: "skipped", reason: err?.message || "invalid" };
  }
}

async function upsertProfile(db, profile, user, { published = 0 } = {}) {
  const ts = nowIso();
  const authorId = user?.id ?? user;
  const existing = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
  if (existing) {
    if (existing.author_id == null) {
      throw new ValidationError("That profile id is already used.", 409);
    }
    if (Number(existing.author_id) !== Number(authorId)) {
      throw new ValidationError("That profile id is already used.", 409);
    }
    await db.run("UPDATE profiles SET document=?, updated_at=? WHERE id=?", [JSON.stringify(profile), ts, profile.id]);
    return;
  }
  await db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [profile.id, JSON.stringify(profile), authorId, published, ts, ts]
  );
}

async function profileForAction(db, user, row) {
  const working = parseProfile(row);
  if (!working) throw new ValidationError("not found", 404);
  const review = await getReview(db, row.id);
  const staff = isModerator(user) || (user && Number(user.id) === Number(row.author_id));
  const doc = staff ? working : publicDocument(row, review, working);
  if (!doc) throw new ValidationError("not found", 404);
  return validateStoredProfile(doc, serveExtra(review, working));
}

async function requireProfile(db, profileId) {
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
  if (!row) throw new ValidationError("profile not found", 404);
  const working = parseProfile(row);
  if (!working) throw new ValidationError("profile not found", 404);
  const review = await getReview(db, profileId);
  return validateStoredProfile(working, serveExtra(review, working));
}

async function showProfile(request, db, env, profileId) {
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
  if (!row) throw new ValidationError("profile not found", 404);
  const working = parseProfile(row);
  if (!working) throw new ValidationError("profile not found", 404);
  const review = await getReview(db, profileId);
  const user = await userFromAuth(request, db);
  const owner = user && Number(user.id) === Number(row.author_id);
  const publicDoc = publicDocument(row, review, working);
  if (!publicDoc && !owner && !(user && (user.role === "moderator" || user.role === "admin"))) {
    return json({ error: "not found" }, 404);
  }
  const raw = owner || (user && (user.role === "moderator" || user.role === "admin")) ? working : publicDoc;
  const extra = serveExtra(review, raw);
  const profile = serveProfileDocument(raw, extra);
  if (isPsilocybin(profile, extra) && !showPsi(env) && !owner) return json({ error: "not found" }, 404);
  const unlocked = await canRead(db, user, profile);
  const ratings = await db.all(
    "SELECT ratings.*, users.username FROM ratings JOIN users ON users.id = ratings.user_id WHERE profile_id=?",
    [profileId]
  );
  const avgRow = await db.one("SELECT AVG(stars) AS a FROM ratings WHERE profile_id=?", [profileId]);
  const staff = owner || (user && (user.role === "moderator" || user.role === "admin"));
  const reportRows = await db.all("SELECT * FROM grow_reports WHERE profile_id=? ORDER BY id DESC LIMIT 20", [profileId]);
  const reports = [];
  for (const report of reportRows) {
    reports.push({ ...report, ...reportPhotoPayload(env, report, user) });
  }
  const lockedDoc = unlocked
    ? profile
    : {
        id: profile.id,
        name: profile.name,
        species: profile.species,
        summary: profile.summary,
        pricing: profile.pricing,
        pack: profile.pack,
        stages: (Array.isArray(profile.stages) ? profile.stages : []).map((s) => ({ id: s.id, name: s.name, duration_days: s.duration_days })),
        locked: true,
      };
  const offMenu = isOffMenu(profile) || isPsilocybin(profile, extra);
  const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [profileId]);
  const links = offMenu ? [] : unlocked ? affiliateLinksFor(profile, extra) : [];
  return json({
    profile: {
      ...lockedDoc,
      pack_label: packLabel(profile.pack),
      legal_notice: offMenu ? PSI_LEGAL_NOTICE : lockedDoc.legal_notice,
    },
    review: staff ? reviewView(review, photos) : review ? { status: review.status } : { status: "published" },
    unlocked,
    ratings,
    avg: avgRow?.a ?? null,
    reports,
    links,
    disclosure: disclosureFor(links),
    resources: offMenu
      ? { disclaimer: PSI_RESOURCE_DISCLAIMER, spore_law: PSI_SPORE_LAW, links: PSI_RESOURCES }
      : null,
  });
}

async function exportProfile(request, db, env, profileId) {
  const user = await userFromAuth(request, db);
  const row = await requireVisibleRow(db, user, profileId);
  const owner = user && Number(user.id) === Number(row.author_id);
  const review = await getReview(db, profileId);
  const working = parseProfile(row);
  if (!working) return json({ error: "not found" }, 404);
  const staff = owner || isModerator(user);
  const raw = staff ? working : publicDocument(row, review, working);
  if (!raw) return json({ error: "not found" }, 404);
  const extra = serveExtra(review, raw);
  const profile = serveProfileDocument(raw, extra);
  if (isPsilocybin(profile, extra) && !showPsi(env) && !owner) return json({ error: "not found" }, 404);
  if (!staff && !(await canRead(db, user, profile))) return json({ error: "purchase required" }, 402);
  await db.run("UPDATE profiles SET downloads=downloads+1 WHERE id=?", [profileId]);
  return json(profile);
}
