/**
 * Community grow progress feed. A signed-in grower posts one photo and a short note
 * tied to a published culinary profile, with an optional chamber and grow day.
 *
 * - Photos go through sanitizeGrowPhoto: EXIF and location are dropped, type is sniffed.
 * - The browser resizes to FEED_MAX_EDGE before upload. Bigger photos are refused.
 * - Off-menu (psilocybin) profiles can't be posted to, and are never listed.
 * - Posts show right away. Anyone signed in can report one. Three reports hide it
 *   until a moderator looks. Moderators can hide, restore, or remove. Every
 *   moderation step goes to moderation_log against the post's profile.
 */

import { nowIso, randomToken } from "./crypto.js";
import { refuseRestrictedPack } from "./coach-learn.js";
import { FEED_SQL } from "./feed-sql.js";
import { insertMedia, mediaApiUrl, setMediaStatus } from "./media-acl.js";
import { decodePhotoBase64, sanitizeGrowPhoto } from "./photos.js";
import { reviewConfirmExtra } from "./profile-schema.js";
import { ValidationError, isPsilocybin, normalizeStoredProfileLight } from "./profile.js";
import { capabilities } from "./providers.js";
import { blocklistHits, getReview, isModerator, isPublicRow, logModeration, requireModerator } from "./review.js";
import { rateLimit } from "./security.js";
import { requireVerified, userFromRequest } from "./auth.js";
import { readJsonLimited } from "./http-body.js";

export const FEED_MAX_EDGE = 1600;
export const FEED_NOTE_MAX = 280;
export const FEED_PAGE_SIZE = 20;
export const FEED_REPORTS_TO_HIDE = 3;
export const FEED_OFF_MENU = "The grow feed is for culinary grows only.";

export function feedDailyCap(env = {}) {
  const n = Number(env.FEED_DAILY_POSTS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** Plain one-line text: no control characters, no tags, trimmed to max. */
export function cleanNote(value, max = FEED_NOTE_MAX) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function parseDoc(row) {
  if (!row) return null;
  try {
    const doc = typeof row.document === "string" ? JSON.parse(row.document) : row.document;
    return doc ? normalizeStoredProfileLight({ ...doc, id: doc.id || row.id }) : null;
  } catch {
    return null;
  }
}

/**
 * The profile a post can hang off: published, live, and culinary.
 * Returns { row, profile } or { error, status }.
 */
export async function culinaryProfile(db, profileId) {
  const id = String(profileId || "").trim();
  if (!id) return { error: "Pick the profile you are growing.", status: 400 };
  if (refuseRestrictedPack({ pack: id, tags: [] }) || id.includes("psilocybin")) return { error: FEED_OFF_MENU, status: 400 };
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [id]);
  const review = row ? await getReview(db, row.id) : null;
  if (!row || !isPublicRow(row, review)) return { error: "Pick a published profile.", status: 400 };
  const profile = parseDoc(row);
  if (!profile) return { error: "Pick a published profile.", status: 400 };
  if (isPsilocybin(profile, reviewConfirmExtra(review, profile)) || refuseRestrictedPack(profile)) {
    return { error: FEED_OFF_MENU, status: 400, offMenu: true };
  }
  return { row, profile };
}

function gradeDay(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new ValidationError("Grow day should be a whole number from 1 to 365.");
  return n;
}

export function shapePost(env, row, profile, viewer) {
  const mine = viewer && Number(viewer.id) === Number(row.user_id);
  const out = {
    id: row.id,
    profile: { id: row.profile_id, name: profile?.name || row.profile_id, species: profile?.species || null },
    author: row.author || "grower",
    note: row.note || "",
    grow_day: row.grow_day ?? null,
    chamber: Boolean(row.device_id),
    photo_url: mediaApiUrl(env, row.photo_key),
    width: row.width,
    height: row.height,
    created_at: row.created_at,
    mine: Boolean(mine),
  };
  if (isModerator(viewer)) {
    out.status = row.status;
    out.report_count = Number(row.report_count || 0);
  }
  return out;
}

/** Drop posts whose profile is no longer public or is now off-menu. */
async function visiblePosts(db, env, rows, viewer) {
  const cache = new Map();
  const out = [];
  for (const row of rows) {
    if (!cache.has(row.profile_id)) cache.set(row.profile_id, await culinaryProfile(db, row.profile_id));
    const resolved = cache.get(row.profile_id);
    if (resolved.error) continue;
    out.push(shapePost(env, row, resolved.profile, viewer));
  }
  return out;
}

export async function createPost(db, env, request, user, body = {}) {
  requireVerified(user);
  if (!capabilities(env, request).photos) throw new ValidationError("Photo posts are not turned on yet.", 503);
  const resolved = await culinaryProfile(db, body.profile_id);
  if (resolved.error) throw new ValidationError(resolved.error, resolved.status);
  const note = cleanNote(body.note);
  if (blocklistHits(note).length) throw new ValidationError("Keep the note about your grow.");
  const growDay = gradeDay(body.grow_day);
  let deviceId = null;
  if (body.device_id) {
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [String(body.device_id)]);
    if (!device || Number(device.owner_id) !== Number(user.id)) throw new ValidationError("chamber not found", 404);
    deviceId = device.id;
  }
  if (!body.photo_base64) throw new ValidationError("Add a photo first.");
  const photo = sanitizeGrowPhoto(decodePhotoBase64(body.photo_base64));
  if (photo.width > FEED_MAX_EDGE || photo.height > FEED_MAX_EDGE) {
    throw new ValidationError(`Use a photo ${FEED_MAX_EDGE} pixels or smaller on each side.`);
  }
  // Counted only once the post is valid, so a bad photo doesn't use up the day.
  const limited = await rateLimit(db, `feed-post:${user.id}`, feedDailyCap(env), 86400);
  if (!limited.ok) throw new ValidationError(`You can share ${feedDailyCap(env)} grow photos a day. Try again tomorrow.`, 429);
  const key = `feed/${randomToken()}.${photo.ext}`;
  const stored = await env.storage.put(key, photo.bytes, photo.contentType);
  if (!stored) throw new ValidationError("Photo posts are not turned on yet.", 503);
  await insertMedia(db, { photo_key: key, owner_id: user.id, status: "approved", kind: "feed" });
  const ts = nowIso();
  await db.run(FEED_SQL.insertPost, [
    user.id,
    resolved.row.id,
    deviceId,
    growDay,
    note,
    key,
    photo.contentType,
    photo.width,
    photo.height,
    ts,
    ts,
  ]);
  const saved = await db.one(FEED_SQL.postByKey, [key]);
  const row = await db.one(FEED_SQL.postById, [saved.id]);
  return shapePost(env, row, resolved.profile, user);
}

export async function listFeed(db, env, viewer, { profileId, before } = {}) {
  const cursor = Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER;
  if (profileId) {
    const resolved = await culinaryProfile(db, profileId);
    if (resolved.error) return { posts: [], next: null };
  }
  // Read a little extra so rows dropped for off-menu or unpublished profiles don't leave a short page.
  const limit = FEED_PAGE_SIZE + 10;
  const rows = profileId
    ? await db.all(FEED_SQL.profilePage, [String(profileId), cursor, limit])
    : await db.all(FEED_SQL.feedPage, [cursor, limit]);
  const shown = await visiblePosts(db, env, rows, viewer);
  const posts = shown.slice(0, FEED_PAGE_SIZE);
  let next = null;
  if (shown.length > FEED_PAGE_SIZE) next = posts[posts.length - 1].id;
  else if (rows.length === limit) next = rows[rows.length - 1].id;
  return { posts, next };
}

async function loadPost(db, id) {
  const row = await db.one(FEED_SQL.postById, [Number(id)]);
  if (!row || row.status === "removed") throw new ValidationError("not found", 404);
  return row;
}

export async function reportPost(db, user, id, reason) {
  if (!user) throw new ValidationError("Sign in to report a post.", 401);
  const row = await loadPost(db, id);
  if (row.status !== "visible") return { reported: true };
  const limited = await rateLimit(db, `feed-report:${user.id}`, 20, 86400);
  if (!limited.ok) throw new ValidationError("Too many reports today.", 429);
  const why = cleanNote(reason, 200) || "reported";
  const added = await db.run(FEED_SQL.insertReport, [row.id, user.id, why, nowIso()]);
  if (Number(added?.meta?.changes ?? added?.changes ?? 0) === 0) return { reported: true };
  await db.run(FEED_SQL.bumpReports, [nowIso(), row.id]);
  await logModeration(db, { profileId: row.profile_id, actorId: user.id, action: "post_report", reason: `post ${row.id}: ${why}` });
  if (Number(row.report_count || 0) + 1 >= FEED_REPORTS_TO_HIDE) {
    await db.run(FEED_SQL.setStatus, ["hidden", nowIso(), row.id]);
    await setMediaStatus(db, row.photo_key, "hidden");
    await logModeration(db, { profileId: row.profile_id, actorId: null, action: "post_hide", reason: `post ${row.id}: ${FEED_REPORTS_TO_HIDE} reports` });
  }
  return { reported: true };
}

async function removePost(db, env, row, actorId, action, reason) {
  await db.run(FEED_SQL.setStatus, ["removed", nowIso(), row.id]);
  await setMediaStatus(db, row.photo_key, "removed");
  try {
    await env.storage.delete?.(row.photo_key);
  } catch (err) {
    console.error(JSON.stringify({ event: "feed_photo_delete_failed", post_id: row.id, message: String(err?.message || err).slice(0, 200) }));
  }
  await logModeration(db, { profileId: row.profile_id, actorId, action, reason: `post ${row.id}${reason ? `: ${reason}` : ""}` });
}

export async function moderatePost(db, env, user, id, { action, reason } = {}) {
  requireModerator(user);
  const row = await loadPost(db, id);
  const why = cleanNote(reason, 200);
  if (action === "hide") {
    await db.run(FEED_SQL.setStatus, ["hidden", nowIso(), row.id]);
    await setMediaStatus(db, row.photo_key, "hidden");
    await logModeration(db, { profileId: row.profile_id, actorId: user.id, action: "post_hide", reason: `post ${row.id}${why ? `: ${why}` : ""}` });
  } else if (action === "restore") {
    await db.run(FEED_SQL.restore, [nowIso(), row.id]);
    await setMediaStatus(db, row.photo_key, "approved");
    await logModeration(db, { profileId: row.profile_id, actorId: user.id, action: "post_restore", reason: `post ${row.id}${why ? `: ${why}` : ""}` });
  } else if (action === "remove") {
    await removePost(db, env, row, user.id, "post_remove", why);
  } else {
    throw new ValidationError("action must be hide, restore, or remove");
  }
  const after = await db.one(FEED_SQL.postById, [row.id]);
  return { id: row.id, status: after.status };
}

export async function deleteOwnPost(db, env, user, id) {
  if (!user) throw new ValidationError("sign in required", 401);
  const row = await loadPost(db, id);
  if (Number(row.user_id) !== Number(user.id)) throw new ValidationError("not found", 404);
  await removePost(db, env, row, user.id, "post_delete_own", "");
  return { id: row.id, status: "removed" };
}

export async function moderationQueue(db, env, user) {
  requireModerator(user);
  const rows = await db.all(FEED_SQL.moderationQueue, []);
  const out = [];
  for (const row of rows) {
    const resolved = await culinaryProfile(db, row.profile_id);
    out.push(shapePost(env, row, resolved.profile || null, user));
  }
  return out;
}

/** Media rule for feed photos: removed posts are gone, hidden ones stay private. */
export async function feedMediaHeaders(db, key) {
  const row = await db.one(FEED_SQL.postByKey, [key]);
  if (!row) return { feed: false };
  if (row.status === "removed") return { feed: true, gone: true };
  return { feed: true, private: row.status !== "visible" };
}

export async function handleFeed(method, path, url, request, env) {
  if (!path.startsWith("/api/feed")) return null;
  const { db } = env;
  const viewer = (await userFromRequest(request, db)).user;
  try {
    if (method === "GET" && path === "/api/feed") {
      const page = await listFeed(db, env, viewer, {
        profileId: url.searchParams.get("profile_id") || "",
        before: url.searchParams.get("before"),
      });
      return json({ ...page, can_post: Boolean(viewer && Number(viewer.email_verified)), moderator: isModerator(viewer) }, 200, {
        "cache-control": "private, no-store",
      });
    }
    if (method === "POST" && path === "/api/feed") {
      const body = await readJsonLimited(request);
      const post = await createPost(db, env, request, viewer, body);
      return json({ post }, 201);
    }
    if (method === "GET" && path === "/api/feed/moderation") {
      return json({ posts: await moderationQueue(db, env, viewer) });
    }
    const report = path.match(/^\/api\/feed\/(\d+)\/report$/);
    if (report && method === "POST") {
      const body = await readJsonLimited(request);
      return json(await reportPost(db, viewer, report[1], body.reason));
    }
    const moderate = path.match(/^\/api\/feed\/(\d+)\/moderate$/);
    if (moderate && method === "POST") {
      const body = await readJsonLimited(request);
      return json(await moderatePost(db, env, viewer, moderate[1], body));
    }
    const one = path.match(/^\/api\/feed\/(\d+)$/);
    if (one && method === "DELETE") {
      return json(await deleteOwnPost(db, env, viewer, one[1]));
    }
  } catch (err) {
    if (err instanceof ValidationError || err?.name === "ValidationError") {
      return json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status || 400);
    }
    throw err;
  }
  return json({ error: "not found" }, 404);
}
