/** Profile review, photos, reports, and moderator actions. Additive tables only. */

import { nowIso } from "./crypto.js";
import { sendEmail } from "./email.js";
import { layout, button, escapeHtml } from "./email-layout.js";
import {
  applyPackRules,
  canConfirmCulinary,
  classifyTaxon,
  isPsilocybin,
  needsOffmenuFlag,
  reviewConfirmExtra,
  ValidationError,
} from "./profile-schema.js";
import { PHOTO_MAX_COUNT, extForContentType, photoObjectKey, prescreenImage, processPhoto } from "./photos.js";
import {
  copyApprovedObject,
  deleteStoredObject,
  finishApprovedObject,
  insertMedia,
  isPendingObjectKey,
  pendingPhotoKey,
  replaceMediaKey,
  setMediaStatus,
} from "./media-acl.js";
import { capabilities } from "./providers.js";
import { rateLimit, rateLimitClient } from "./security.js";

export const REVIEW_DRAFT = "draft";
export const REVIEW_PENDING = "pending";
export const REVIEW_PUBLISHED = "published";
export const REVIEW_REJECTED = "rejected";
export const REVIEW_CHANGES = "changes_requested";

export const BLOCKLIST = [
  "dick",
  "cock",
  "penis",
  "pussy",
  "porn",
  "xxx",
  "nudes",
  "nude",
  "onlyfans",
  "sex tape",
];

export function blocklistHits(text) {
  const hay = String(text || "").toLowerCase();
  return BLOCKLIST.filter((word) => hay.includes(word));
}

export function isModerator(user) {
  return user?.role === "moderator" || user?.role === "admin";
}

export function requireModerator(user) {
  if (!user) throw new ValidationError("sign in required", 401);
  if (!isModerator(user)) throw new ValidationError("moderator access required", 403);
}

export function reviewPublic(review) {
  return review && review.status === REVIEW_PUBLISHED && Number(review.published_live) === 1;
}

export async function getReview(db, profileId) {
  return db.one("SELECT * FROM profile_review WHERE profile_id=?", [profileId]);
}

function confirmFields(existing, profile, { confirm = false, actorId = null, at = null } = {}) {
  if (confirm) return { confirmed_culinary_at: at || nowIso(), confirmed_by: actorId };
  if (!existing?.confirmed_culinary_at) return { confirmed_culinary_at: null, confirmed_by: null };
  if (profile && !reviewConfirmExtra(existing, profile).confirmedCulinary) {
    return { confirmed_culinary_at: null, confirmed_by: null };
  }
  return { confirmed_culinary_at: existing.confirmed_culinary_at, confirmed_by: existing.confirmed_by ?? null };
}

export async function upsertReview(db, row) {
  const ts = nowIso();
  await db.run(
    "INSERT INTO profile_review (profile_id, status, reason, title, description, live_document, blocklist_hit, offmenu_flag, published_live, created_at, updated_at, confirmed_culinary_at, confirmed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, title=excluded.title, description=excluded.description, live_document=excluded.live_document, blocklist_hit=excluded.blocklist_hit, offmenu_flag=excluded.offmenu_flag, published_live=excluded.published_live, updated_at=excluded.updated_at, confirmed_culinary_at=excluded.confirmed_culinary_at, confirmed_by=excluded.confirmed_by",
    [
      row.profile_id,
      row.status,
      row.reason || "",
      row.title || "",
      row.description || "",
      row.live_document || null,
      row.blocklist_hit ? 1 : 0,
      row.offmenu_flag ? 1 : 0,
      row.published_live ? 1 : 0,
      row.created_at || ts,
      ts,
      row.confirmed_culinary_at ?? null,
      row.confirmed_by ?? null,
    ]
  );
}

export async function logModeration(db, { profileId, actorId, action, reason }) {
  await db.run(
    "INSERT INTO moderation_log (profile_id, actor_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    [profileId, actorId || null, action, reason || "", nowIso()]
  );
}

export function publicDocument(row, review, profile) {
  if (review?.live_document && Number(review.published_live) === 1) {
    try {
      return JSON.parse(review.live_document);
    } catch {
      return profile;
    }
  }
  if (Number(row.published) === 1 && (!review || review.status === REVIEW_PUBLISHED)) return profile;
  return null;
}

export async function isPublicProfile(db, row) {
  if (!row || Number(row.published) !== 1) return false;
  const review = await getReview(db, row.id);
  if (!review) return true;
  return Number(review.published_live) === 1;
}

export async function canSeeProfile(db, user, row) {
  if (!row) return false;
  if (isModerator(user)) return true;
  if (user && Number(user.id) === Number(row.author_id)) return true;
  return isPublicProfile(db, row);
}

export async function requireVisibleRow(db, user, profileId) {
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
  if (!row || !(await canSeeProfile(db, user, row))) throw new ValidationError("not found", 404);
  return row;
}

export async function listPublicProfiles(db) {
  const rows = await db.all("SELECT * FROM profiles");
  const out = [];
  for (const row of rows) {
    if (await isPublicProfile(db, row)) out.push(row);
  }
  return out;
}

export async function saveDraftReview(db, profile, { title = "", description = "", priorRow = null } = {}) {
  const existing = await getReview(db, profile.id);
  const legacyLive = !existing && priorRow && Number(priorRow.published) === 1;
  await upsertReview(db, {
    profile_id: profile.id,
    status: legacyLive
      ? REVIEW_PENDING
      : existing?.status && existing.status !== REVIEW_PUBLISHED
        ? existing.status
        : REVIEW_DRAFT,
    reason: legacyLive ? "Waiting for review of an edit." : existing?.reason || "",
    title: title || existing?.title || profile.name || "",
    description: description || existing?.description || profile.summary || "",
    live_document: existing?.live_document || (legacyLive ? priorRow.document : null),
    blocklist_hit: Boolean(Number(existing?.blocklist_hit)),
    offmenu_flag: needsOffmenuFlag(profile, { title, description }),
    published_live: Number(existing?.published_live) === 1 || legacyLive,
    created_at: existing?.created_at,
    ...confirmFields(existing, profile),
  });
}

export async function submitForReview(db, env, request, { profile, user, title, description }) {
  if (!String(title || "").trim()) throw new ValidationError("Add a title before you send this to the library.");
  if (!String(description || "").trim()) throw new ValidationError("Add a short description before you send this to the library.");
  const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [profile.id]);
  if (photos.length < 1) throw new ValidationError("Add at least one photo before you send this to the library.");
  const hits = [...blocklistHits(title), ...blocklistHits(description)];
  const existing = await getReview(db, profile.id);
  const extra = { title, description };
  const normalized = applyPackRules(profile, extra);
  await db.run("UPDATE profiles SET document=?, updated_at=? WHERE id=?", [
    JSON.stringify(normalized),
    nowIso(),
    profile.id,
  ]);
  await upsertReview(db, {
    profile_id: profile.id,
    status: REVIEW_PENDING,
    reason: "",
    title: String(title).trim(),
    description: String(description).trim(),
    live_document: existing?.live_document || null,
    blocklist_hit: hits.length > 0,
    offmenu_flag: needsOffmenuFlag(normalized, extra),
    published_live: Number(existing?.published_live) === 1,
    created_at: existing?.created_at,
    ...confirmFields(existing, normalized),
  });
  await logModeration(db, {
    profileId: profile.id,
    actorId: user.id,
    action: "submit",
    reason: hits.length ? `blocklist:${hits.join(",")}` : "",
  });
  return getReview(db, profile.id);
}

export async function approveReview(db, env, request, { profile, user, row, pack } = {}) {
  const review = await getReview(db, profile.id);
  if (!review) throw new ValidationError("This profile is not waiting for review.");
  const already = review.status === REVIEW_PUBLISHED && Number(review.published_live) === 1;
  if (!already && review.status !== REVIEW_PENDING) throw new ValidationError("This profile is not waiting for review.");
  const extra = { title: review.title, description: review.description };
  if (pack === "culinary" || pack === "psilocybin") extra.moderatorPack = pack;
  if (!already && extra.moderatorPack === "culinary" && !canConfirmCulinary(profile, extra)) {
    throw new ValidationError("This taxon cannot be confirmed as culinary.", 400);
  }
  const normalized = already ? profile : applyPackRules(profile, extra);
  const ts = nowIso();
  if (!already) {
    await db.run("UPDATE profiles SET document=?, updated_at=? WHERE id=?", [JSON.stringify(normalized), ts, profile.id]);
  }
  await promoteProfilePhotos(db, env, profile.id);
  if (!already) {
    await db.run("UPDATE profiles SET published=1, updated_at=? WHERE id=?", [ts, profile.id]);
    await upsertReview(db, {
      ...review,
      status: REVIEW_PUBLISHED,
      reason: "",
      live_document: JSON.stringify(normalized),
      offmenu_flag: extra.moderatorPack === "culinary" ? false : needsOffmenuFlag(normalized, extra),
      published_live: 1,
      ...confirmFields(review, normalized, { confirm: extra.moderatorPack === "culinary", actorId: user.id, at: ts }),
    });
    await logModeration(db, { profileId: profile.id, actorId: user.id, action: "approve", reason: "" });
    await notifyOwner(db, env, request, row, "approved", "");
  }
  return getReview(db, profile.id);
}

export async function rejectReview(db, env, request, { profile, user, row, reason, changes = false }) {
  if (!String(reason || "").trim()) throw new ValidationError("Add a reason for the owner.");
  const review = await getReview(db, profile.id);
  if (!review) throw new ValidationError("This profile is not waiting for review.");
  await upsertReview(db, {
    ...review,
    status: changes ? REVIEW_CHANGES : REVIEW_REJECTED,
    reason: String(reason).trim(),
  });
  await logModeration(db, {
    profileId: profile.id,
    actorId: user.id,
    action: changes ? "request_changes" : "reject",
    reason: String(reason).trim(),
  });
  await notifyOwner(db, env, request, row, changes ? "changes" : "rejected", String(reason).trim());
  return getReview(db, profile.id);
}

export async function takedownReview(db, env, request, { profile, user, row, reason }) {
  if (!String(reason || "").trim()) throw new ValidationError("Add a reason for the owner.");
  const existing = await getReview(db, profile.id);
  const review = existing || {
    profile_id: profile.id,
    status: REVIEW_PUBLISHED,
    reason: "",
    title: profile.name || "",
    description: profile.summary || "",
    live_document: JSON.stringify(profile),
    blocklist_hit: 0,
    offmenu_flag: needsOffmenuFlag(profile) ? 1 : 0,
    published_live: 1,
  };
  const ts = nowIso();
  await db.run("UPDATE profiles SET published=0, updated_at=? WHERE id=?", [ts, profile.id]);
  await upsertReview(db, {
    ...review,
    status: REVIEW_REJECTED,
    reason: String(reason).trim(),
    published_live: 0,
  });
  await db.run("UPDATE profile_photos SET status='pending', withdrawn=1, updated_at=? WHERE profile_id=?", [
    ts,
    profile.id,
  ]);
  const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=?", [profile.id]);
  for (const photo of photos) {
    if (photo.object_key) await setMediaStatus(db, photo.object_key, "rejected");
  }
  const reports = await db.all("SELECT * FROM grow_reports WHERE profile_id=?", [profile.id]);
  for (const report of reports) {
    if (!report.photo_key || report.photo_status !== "approved") continue;
    if (env?.storage?.delete) await env.storage.delete(report.photo_key);
    await db.run("UPDATE grow_reports SET photo_status=? WHERE id=?", ["rejected", report.id]);
    await setMediaStatus(db, report.photo_key, "rejected");
  }
  await logModeration(db, {
    profileId: profile.id,
    actorId: user.id,
    action: "takedown",
    reason: String(reason).trim(),
  });
  await notifyOwner(db, env, request, row, "rejected", String(reason).trim());
  return getReview(db, profile.id);
}

export async function reportProfile(db, { profileId, user, reason }) {
  const review = await getReview(db, profileId);
  if (!review || Number(review.published_live) !== 1) throw new ValidationError("Only published profiles can be reported.");
  await db.run(
    "INSERT INTO profile_reports (profile_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)",
    [profileId, user.id, String(reason || "reported"), nowIso()]
  );
  await upsertReview(db, { ...review, status: REVIEW_PENDING, reason: String(reason || "reported") });
  await logModeration(db, { profileId, actorId: user.id, action: "report", reason: String(reason || "reported") });
  return getReview(db, profileId);
}

export async function maybeResetOnPublicEdit(db, profile, { title, description }) {
  const review = await getReview(db, profile.id);
  if (!review || Number(review.published_live) !== 1) return review;
  await upsertReview(db, {
    ...review,
    status: REVIEW_PENDING,
    title: title != null ? String(title) : review.title,
    description: description != null ? String(description) : review.description,
    offmenu_flag: needsOffmenuFlag(profile, { title, description }),
    reason: "Waiting for review of an edit.",
    ...confirmFields(review, profile),
  });
  await logModeration(db, { profileId: profile.id, actorId: null, action: "edit_resubmit", reason: "body" });
  return getReview(db, profile.id);
}

export function reportPhotoApproved(report) {
  return (report?.photo_status || "approved") === "approved";
}

export function canSeePendingReportPhoto(user, report) {
  if (!user || !report) return false;
  if (isModerator(user)) return true;
  return Number(user.id) === Number(report.author_id);
}

export function showPsilocybin(env) {
  return String(env?.SHOW_PSILOCYBIN ?? "1") !== "0";
}

function parseRowDocument(row) {
  try {
    return typeof row?.document === "string" ? JSON.parse(row.document) : row?.document || null;
  } catch {
    return null;
  }
}

/** Site flag plus owner / pending-uploader / staff exceptions, matching profile pages. */
export async function offmenuVisible(db, env, user, row, { uploaderId, pending } = {}) {
  if (!row) return false;
  const profile = parseRowDocument(row);
  if (!profile) return false;
  const extra = reviewConfirmExtra(await getReview(db, row.id), profile);
  if (!isPsilocybin(profile, extra)) return true;
  if (isModerator(user)) return true;
  if (user && Number(user.id) === Number(row.author_id)) return true;
  if (pending && user && uploaderId != null && Number(user.id) === Number(uploaderId)) return true;
  return showPsilocybin(env);
}

export async function canServeReportPhoto(db, env, user, report) {
  if (!report?.photo_key) return false;
  if (report.photo_status === "rejected") return false;
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [report.profile_id]);
  if (!row) return false;
  const pending = report.photo_status !== "approved";
  if (!(await offmenuVisible(db, env, user, row, { uploaderId: report.author_id, pending }))) return false;
  const publicOk = await isPublicProfile(db, row);
  if (report.photo_status === "approved" && publicOk) return true;
  return canSeePendingReportPhoto(user, report);
}

export async function storeReportPhoto(db, env, request, { profileId, user, raw }) {
  if (!capabilities(env, request).photos) {
    throw new ValidationError("Photo storage is not enabled yet. See the deploy note for the media bucket.", 503);
  }
  if (!raw || !raw.byteLength) throw new ValidationError("Add a photo file.");
  const limited = await rateLimit(db, `report-photo:${user.id}:${rateLimitClient(request)}`, 10, 3600);
  if (!limited.ok) throw new ValidationError("Too many photo uploads this hour.", 429);
  const processed = processPhoto(raw);
  const pendingKey = pendingPhotoKey("reports", profileId, extForContentType(processed.contentType));
  const stored = await env.storage.put(pendingKey, processed.bytes, processed.contentType);
  if (!stored) throw new ValidationError("Photo storage is not enabled yet. See the deploy note for the media bucket.", 503);
  await insertMedia(db, { photo_key: pendingKey, owner_id: user.id, status: "pending", kind: "report" });
  return { photoKey: pendingKey, photoStatus: "pending" };
}

export async function listPendingReportPhotos(db) {
  const rows = await db.all("SELECT * FROM grow_reports WHERE photo_status=? ORDER BY id DESC", ["pending"]);
  const out = [];
  for (const report of rows) {
    const profile = await db.one("SELECT * FROM profiles WHERE id=?", [report.profile_id]);
    if (!profile) continue;
    out.push(report);
  }
  return out;
}

export const RECLASS_STATE_KEY = "legacy_reclassify_v3";
export const RECLASS_BATCH_LIMIT = 10;

function shouldReclassifyLive(profile) {
  const classified = classifyTaxon(profile);
  return classified.force || classified.hold || classified.proseFlag;
}

function classSignature(doc) {
  return JSON.stringify({
    pack: doc?.pack || "",
    restricted: Boolean(doc?.restricted),
    notice: Boolean(doc?.legal_notice),
    psi: Array.isArray(doc?.tags) && doc.tags.includes("psilocybin"),
  });
}

function parseLegacyDocument(row) {
  try {
    return JSON.parse(row.document);
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "warn",
        event: "malformed_legacy_document",
        id: row.id,
        message: String(err?.message || err).slice(0, 200),
      })
    );
    return null;
  }
}

export async function reclassifyUnconfirmedLegacyBatch(db, { limit = RECLASS_BATCH_LIMIT, afterId = "" } = {}) {
  const done = await db.one("SELECT * FROM maintenance_state WHERE key=?", [RECLASS_STATE_KEY]);
  if (done?.value === "done") return { scanned: 0, rewritten: 0, lastId: afterId, done: true };
  const cursor = afterId || (done?.value && done.value !== "done" ? done.value : "");
  const rows = await db.all(
    "SELECT * FROM profiles WHERE published = 1 AND author_id IS NOT NULL AND id > ? ORDER BY id LIMIT ?",
    [cursor, limit]
  );
  let scanned = 0;
  let rewritten = 0;
  let lastId = cursor;
  for (const row of rows) {
    scanned += 1;
    lastId = row.id;
    const doc = parseLegacyDocument(row);
    if (!doc) continue;
    const existing = await getReview(db, row.id);
    if (existing?.confirmed_culinary_at) continue;
    if (!shouldReclassifyLive(doc) && existing) continue;
    const normalized = applyPackRules(doc);
    const nextDoc = JSON.stringify(normalized);
    const classChanged = classSignature(normalized) !== classSignature(doc);
    if (classChanged && nextDoc !== row.document) {
      await db.run("UPDATE profiles SET document=?, updated_at=? WHERE id=?", [nextDoc, nowIso(), row.id]);
      rewritten += 1;
    }
    if (!existing) {
      await upsertReview(db, {
        profile_id: row.id,
        status: REVIEW_PUBLISHED,
        reason: "",
        title: normalized.name || "",
        description: normalized.summary || "",
        live_document: nextDoc,
        offmenu_flag: needsOffmenuFlag(normalized),
        published_live: 1,
        created_at: row.created_at,
      });
      continue;
    }
    let live = doc;
    if (existing.live_document) {
      try {
        live = JSON.parse(existing.live_document);
      } catch {
        live = doc;
      }
    }
    const nextLive = shouldReclassifyLive(live) ? applyPackRules(live) : live;
    const liveJson = JSON.stringify(nextLive);
    const flag = needsOffmenuFlag(nextLive) ? 1 : 0;
    const liveClassChanged = classSignature(nextLive) !== classSignature(live);
    if (!liveClassChanged && Number(existing.offmenu_flag) === flag) continue;
    if (liveJson === existing.live_document && Number(existing.offmenu_flag) === flag) continue;
    await upsertReview(db, {
      ...existing,
      live_document: liveJson,
      offmenu_flag: flag,
      ...confirmFields(existing, nextLive),
    });
  }
  const finished = rows.length < limit;
  const value = finished ? "done" : lastId;
  const ts = nowIso();
  if (done) await db.run("UPDATE maintenance_state SET value=?, updated_at=? WHERE key=?", [value, ts, RECLASS_STATE_KEY]);
  else await db.run("INSERT INTO maintenance_state (key, value, updated_at) VALUES (?, ?, ?)", [RECLASS_STATE_KEY, value, ts]);
  return { scanned, rewritten, lastId, done: finished };
}

async function promotePhoto(db, storage, { fromKey, update }) {
  if (!fromKey) return fromKey;
  const { nextKey, missing } = await copyApprovedObject(storage, fromKey);
  if (missing) throw new ValidationError("That photo is missing from storage.", 500);
  await update(nextKey);
  await replaceMediaKey(db, fromKey, nextKey, "approved");
  if (fromKey !== nextKey) await deleteStoredObject(storage, fromKey);
  return nextKey;
}

async function promoteProfilePhotos(db, env, profileId) {
  const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [profileId]);
  const approvedAt = nowIso();
  for (const photo of photos) {
    const fromKey = photo.object_key;
    if (photo.status === "approved" && fromKey && !isPendingObjectKey(fromKey)) {
      await finishApprovedObject(env?.storage, fromKey);
      continue;
    }
    await promotePhoto(db, env?.storage, {
      fromKey,
      update: async (key) => {
        await db.run("UPDATE profile_photos SET object_key=?, status='approved', updated_at=? WHERE id=?", [
          key,
          approvedAt,
          photo.id,
        ]);
      },
    });
  }
}

export async function approveReportPhoto(db, env, { report, user }) {
  if (!report?.photo_key) throw new ValidationError("This report photo is not waiting for review.");
  if (report.photo_status === "approved") {
    await finishApprovedObject(env?.storage, report.photo_key);
    return { ...report, photo_status: "approved" };
  }
  if (report.photo_status !== "pending") throw new ValidationError("This report photo is not waiting for review.");
  const fromKey = report.photo_key;
  const nextKey = await promotePhoto(db, env?.storage, {
    fromKey,
    update: async (key) => {
      await db.run("UPDATE grow_reports SET photo_key=?, photo_status=? WHERE id=?", [key, "approved", report.id]);
    },
  });
  await logModeration(db, {
    profileId: report.profile_id,
    actorId: user.id,
    action: "report_photo_approve",
    reason: `uploader:${report.author_id}`,
  });
  return { ...report, photo_key: nextKey, photo_status: "approved" };
}

export async function rejectReportPhoto(db, env, { report, user, reason }) {
  if (!report || (report.photo_status !== "pending" && report.photo_status !== "approved")) {
    throw new ValidationError("This report photo cannot be removed.");
  }
  if (!String(reason || "").trim()) throw new ValidationError("Add a reason for the owner.");
  if (report.photo_key && env?.storage?.delete) await env.storage.delete(report.photo_key);
  await db.run("UPDATE grow_reports SET photo_status=? WHERE id=?", ["rejected", report.id]);
  if (report.photo_key) await setMediaStatus(db, report.photo_key, "rejected");
  await logModeration(db, {
    profileId: report.profile_id,
    actorId: user.id,
    action: "report_photo_reject",
    reason: String(reason || `uploader:${report.author_id}`),
  });
  return { ...report, photo_status: "rejected" };
}

export async function storePhoto(db, env, request, { profile, user, raw, contentType }) {
  if (!capabilities(env, request).photos) {
    throw new ValidationError("Photo storage is not enabled yet. See the deploy note for the media bucket.", 503);
  }
  const limited = await rateLimit(db, `photo:${user.id}:${rateLimitClient(request)}`, 10, 3600);
  if (!limited.ok) throw new ValidationError("Too many photo uploads this hour.", 429);
  const existing = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [profile.id]);
  if (existing.length >= PHOTO_MAX_COUNT) throw new ValidationError("Use at most four photos.");
  if (!raw || !raw.byteLength) throw new ValidationError("Add a photo file.");
  const processed = processPhoto(raw);
  const screen = await prescreenImage(processed.bytes);
  const pendingKey = photoObjectKey("pending");
  const stored = await env.storage.put(pendingKey, processed.bytes, processed.contentType || contentType || "image/jpeg");
  if (!stored) throw new ValidationError("Photo storage is not enabled yet. See the deploy note for the media bucket.", 503);
  await insertMedia(db, { photo_key: pendingKey, owner_id: user.id, status: "pending", kind: "profile" });
  const ts = nowIso();
  await db.run(
    "INSERT INTO profile_photos (profile_id, object_key, content_type, width, height, status, prescreen, withdrawn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [
      profile.id,
      pendingKey,
      processed.contentType,
      processed.width,
      processed.height,
      "pending",
      JSON.stringify(screen),
      ts,
      ts,
    ]
  );
  const review = await getReview(db, profile.id);
  if (review && Number(review.published_live) === 1) {
    await upsertReview(db, {
      ...review,
      status: REVIEW_PENDING,
      reason: "Waiting for review of a new photo.",
    });
    await logModeration(db, { profileId: profile.id, actorId: user.id, action: "edit_resubmit", reason: "photo" });
  }
  const row = await db.one("SELECT * FROM profile_photos WHERE object_key=?", [pendingKey]);
  return row;
}

export function photoIsPublic(photo) {
  return photo && photo.status === "approved" && Number(photo.withdrawn) === 0;
}

export function canSeePhoto(photo, user, authorId) {
  if (photoIsPublic(photo)) return true;
  if (!user) return false;
  if (isModerator(user)) return true;
  return Number(user.id) === Number(authorId);
}

async function notifyOwner(db, env, request, authorRow, kind, reason) {
  const email = authorRow?.email;
  if (!email) return { ok: false, skipped: "no-email" };
  const approved = kind === "approved";
  const subject = approved ? "Your Shroom Labs profile is published" : "An update on your Shroom Labs profile";
  const line = approved
    ? "A moderator published your profile to the library."
    : kind === "changes"
      ? `A moderator asked for changes: ${reason}`
      : `A moderator did not approve your profile: ${reason}`;
  const html = layout({
    title: subject,
    bodyHtml: `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;">${escapeHtml(line)}</p>${button("https://shroomlabs.io/account.html", "Open your account")}`,
    footerHtml: "<p style=\"margin:0;\">You got this because you sent a profile to the Shroom Labs library.</p>",
  });
  try {
    return await sendEmail(env, { to: email, subject, text: line, html }, request);
  } catch {
    return { ok: false, skipped: "send-failed" };
  }
}

export function reviewView(review, photos = []) {
  if (!review) {
    return { status: REVIEW_DRAFT, reason: "", title: "", description: "", photos: [], blocklist_hit: false, offmenu_flag: false };
  }
  return {
    status: review.status,
    reason: review.reason || "",
    title: review.title || "",
    description: review.description || "",
    blocklist_hit: Boolean(Number(review.blocklist_hit)),
    offmenu_flag: Boolean(Number(review.offmenu_flag)),
    published_live: Boolean(Number(review.published_live)),
    photos: photos.map((p) => ({
      id: p.id,
      status: p.status,
      width: p.width,
      height: p.height,
      content_type: p.content_type,
    })),
  };
}
