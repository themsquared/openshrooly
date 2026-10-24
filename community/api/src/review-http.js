/** Review, photo, and moderator HTTP routes. */

import { requireVerified, userFromRequest } from "./auth.js";
import { stripCommunityAffiliates, validateProfile, ValidationError } from "./profile.js";
import {
  approveReview,
  canSeePhoto,
  getReview,
  isModerator,
  listPublicProfiles,
  logModeration,
  maybeResetOnPublicEdit,
  photoIsPublic,
  publicDocument,
  rejectReview,
  reportProfile,
  requireModerator,
  requireVisibleRow,
  takedownReview,
  reviewView,
  saveDraftReview,
  storePhoto,
  submitForReview,
} from "./review.js";
import { decodeBase64Photo } from "./photos.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function parseProfile(row, seeds) {
  if (row.author_id === null && seeds?.has(row.id)) return structuredClone(seeds.get(row.id));
  return typeof row.document === "string" ? JSON.parse(row.document) : row.document;
}

async function userOf(request, db) {
  return (await userFromRequest(request, db)).user;
}

export async function handleReview(method, path, url, request, env, { seeds, parseProfileRow, upsertProfile, requireProfile }) {
  const { db } = env;

  if (method === "GET" && path === "/api/me/profiles") {
    const user = await userOf(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    const rows = await db.all("SELECT * FROM profiles WHERE author_id=?", [user.id]);
    const out = [];
    for (const row of rows) {
      const profile = parseProfileRow(row);
      const review = await getReview(db, row.id);
      const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [row.id]);
      out.push({
        profile,
        review: reviewView(review, photos),
        published: Number(row.published) === 1,
      });
    }
    return json({ profiles: out });
  }

  if (method === "GET" && path === "/api/moderation/queue") {
    const user = await userOf(request, db);
    requireModerator(user);
    const reviews = await db.all("SELECT * FROM profile_review WHERE status IN ('pending')");
    const items = [];
    for (const review of reviews) {
      const row = await db.one("SELECT * FROM profiles WHERE id=?", [review.profile_id]);
      if (!row) continue;
      const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [review.profile_id]);
      const queued = parseProfileRow(row);
      items.push({
        id: review.profile_id,
        profile: queued,
        review: reviewView(review, photos),
        affiliate_links: (queued.affiliate_links || []).map((link) => ({
          id: link.id,
          label: link.label,
          url: link.url,
        })),
      });
    }
    return json({ items });
  }

  const photoMatch = path.match(/^\/api\/profiles\/([^/]+)\/photos\/([^/]+)$/);
  if (photoMatch && method === "GET") {
    return serveProfilePhoto(request, env, decodeURIComponent(photoMatch[1]), decodeURIComponent(photoMatch[2]), { publicOnly: false });
  }
  if (photoMatch && method === "DELETE") {
    const user = await userOf(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profileId = decodeURIComponent(photoMatch[1]);
    const photoId = decodeURIComponent(photoMatch[2]);
    const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
    if (!row) return json({ error: "not found" }, 404);
    if (Number(row.author_id) !== Number(user.id) && !isModerator(user)) return json({ error: "forbidden" }, 403);
    const photo = await db.one("SELECT * FROM profile_photos WHERE id=? AND profile_id=?", [photoId, profileId]);
    if (!photo) return json({ error: "not found" }, 404);
    await db.run("UPDATE profile_photos SET withdrawn=1, updated_at=? WHERE id=? AND profile_id=?", [
      new Date().toISOString(),
      photoId,
      profileId,
    ]);
    if (isModerator(user)) {
      await logModeration(db, {
        profileId,
        actorId: user.id,
        action: "photo_delete",
        reason: Number(row.author_id) === Number(user.id) ? "owner" : "moderator",
      });
    }
    return json({ ok: true });
  }

  const publicPhoto = path.match(/^\/api\/public-photos\/([^/]+)$/);
  if (publicPhoto && method === "GET") {
    const photo = await db.one("SELECT * FROM profile_photos WHERE id=?", [decodeURIComponent(publicPhoto[1])]);
    if (!photo || !photoIsPublic(photo)) return json({ error: "not found" }, 404);
    return serveStored(env, photo.object_key);
  }

  const photosMatch = path.match(/^\/api\/profiles\/([^/]+)\/photos$/);
  if (photosMatch && method === "POST") {
    const user = await userOf(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profile = await requireProfile(db, decodeURIComponent(photosMatch[1]));
    const row = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
    if (Number(row.author_id) !== Number(user.id)) return json({ error: "forbidden" }, 403);
    const body = await readJson(request);
    const raw = body.photo_base64 ? decodeBase64Photo(body.photo_base64) : null;
    const photo = await storePhoto(db, env, request, { profile, user, raw, contentType: body.photo_type });
    return json({ photo: { id: photo.id, status: photo.status, width: photo.width, height: photo.height } }, 201);
  }

  const publishMatch = path.match(/^\/api\/profiles\/([^/]+)\/publish$/);
  if (publishMatch && method === "POST") {
    const user = await userOf(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profile = await requireProfile(db, decodeURIComponent(publishMatch[1]));
    const row = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
    if (Number(row.author_id) !== Number(user.id)) return json({ error: "forbidden" }, 403);
    const body = await readJson(request);
    const review = await submitForReview(db, env, request, {
      profile,
      user,
      title: body.title,
      description: body.description,
    });
    return json({ review: reviewView(review) });
  }

  const reportMatch = path.match(/^\/api\/profiles\/([^/]+)\/moderation-report$/);
  if (reportMatch && method === "POST") {
    const user = await userOf(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const profileId = decodeURIComponent(reportMatch[1]);
    const row = await requireVisibleRow(db, user, profileId);
    const body = await readJson(request);
    const review = await reportProfile(db, { profileId, user, reason: body.reason || "reported" });
    return json({ review: reviewView(review) }, 201);
  }

  const approveMatch = path.match(/^\/api\/moderation\/([^/]+)\/approve$/);
  if (approveMatch && method === "POST") {
    const user = await userOf(request, db);
    requireModerator(user);
    const profile = await requireProfile(db, decodeURIComponent(approveMatch[1]));
    const row = await db.one("SELECT * FROM users WHERE id=?", [(await db.one("SELECT * FROM profiles WHERE id=?", [profile.id])).author_id]);
    const review = await approveReview(db, env, request, { profile, user, row });
    return json({ review: reviewView(review) });
  }

  const takedownMatch = path.match(/^\/api\/moderation\/([^/]+)\/takedown$/);
  if (takedownMatch && method === "POST") {
    const user = await userOf(request, db);
    requireModerator(user);
    const profile = await requireProfile(db, decodeURIComponent(takedownMatch[1]));
    const author = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
    const row = await db.one("SELECT * FROM users WHERE id=?", [author.author_id]);
    const body = await readJson(request);
    const review = await takedownReview(db, env, request, { profile, user, row, reason: body.reason });
    return json({ review: reviewView(review) });
  }

  const rejectMatch = path.match(/^\/api\/moderation\/([^/]+)\/(reject|request-changes)$/);
  if (rejectMatch && method === "POST") {
    const user = await userOf(request, db);
    requireModerator(user);
    const profile = await requireProfile(db, decodeURIComponent(rejectMatch[1]));
    const author = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
    const row = await db.one("SELECT * FROM users WHERE id=?", [author.author_id]);
    const body = await readJson(request);
    const review = await rejectReview(db, env, request, {
      profile,
      user,
      row,
      reason: body.reason,
      changes: rejectMatch[2] === "request-changes",
    });
    return json({ review: reviewView(review) });
  }

  const logMatch = path.match(/^\/api\/moderation\/([^/]+)\/log$/);
  if (logMatch && method === "GET") {
    const user = await userOf(request, db);
    requireModerator(user);
    const rows = await db.all("SELECT * FROM moderation_log WHERE profile_id=? ORDER BY id DESC", [decodeURIComponent(logMatch[1])]);
    return json({ log: rows });
  }

  const putMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
  if (putMatch && method === "PUT") {
    const user = await userOf(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    requireVerified(user);
    const id = decodeURIComponent(putMatch[1]);
    const existing = await db.one("SELECT * FROM profiles WHERE id=?", [id]);
    if (!existing) return json({ error: "profile not found" }, 404);
    if (Number(existing.author_id) !== Number(user.id)) return json({ error: "forbidden" }, 403);
    const profile = validateProfile(stripCommunityAffiliates(await readJson(request)));
    if (profile.id !== id) throw new ValidationError("profile id cannot change");
    profile.author = user.username;
    await upsertProfile(db, profile, user, { published: Number(existing.published) });
    const bodyTitle = profile.name;
    const bodyDesc = profile.summary;
    await maybeResetOnPublicEdit(db, profile, { title: bodyTitle, description: bodyDesc });
    await saveDraftReview(db, profile);
    const review = await getReview(db, id);
    const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [id]);
    return json({ profile, review: reviewView(review, photos) });
  }

  return null;
}

export async function serveProfilePhoto(request, env, profileId, photoId, { publicOnly }) {
  const { db } = env;
  const photo = await db.one("SELECT * FROM profile_photos WHERE id=?", [photoId]);
  if (!photo || photo.profile_id !== profileId) return json({ error: "not found" }, 404);
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
  if (!row) return json({ error: "not found" }, 404);
  if (publicOnly && !photoIsPublic(photo)) return json({ error: "not found" }, 404);
  const user = await userOf(request, db);
  if (!canSeePhoto(photo, user, row.author_id)) return json({ error: "not found" }, 404);
  return serveStored(env, photo.object_key);
}

async function serveStored(env, key) {
  const file = await env.storage.get(key);
  if (!file) return json({ error: "not found" }, 404);
  return new Response(file.bytes, { headers: { "content-type": file.contentType, "cache-control": "private, max-age=60" } });
}

export { listPublicProfiles, publicDocument, parseProfile };
