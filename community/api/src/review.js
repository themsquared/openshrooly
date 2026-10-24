/** Profile review, photos, reports, and moderator actions. Additive tables only. */

import { nowIso } from "./crypto.js";
import { sendEmail } from "./email.js";
import { layout, button, escapeHtml } from "./email-layout.js";
import { isPsilocybin, ValidationError } from "./profile-schema.js";
import { PHOTO_MAX_COUNT, photoObjectKey, prescreenImage, processPhoto } from "./photos.js";
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

export async function upsertReview(db, row) {
  const ts = nowIso();
  await db.run(
    "INSERT INTO profile_review (profile_id, status, reason, title, description, live_document, blocklist_hit, offmenu_flag, published_live, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, title=excluded.title, description=excluded.description, live_document=excluded.live_document, blocklist_hit=excluded.blocklist_hit, offmenu_flag=excluded.offmenu_flag, published_live=excluded.published_live, updated_at=excluded.updated_at",
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

export async function saveDraftReview(db, profile, { title = "", description = "" } = {}) {
  const existing = await getReview(db, profile.id);
  await upsertReview(db, {
    profile_id: profile.id,
    status: existing?.status && existing.status !== REVIEW_PUBLISHED ? existing.status : REVIEW_DRAFT,
    reason: existing?.reason || "",
    title: title || existing?.title || profile.name || "",
    description: description || existing?.description || profile.summary || "",
    live_document: existing?.live_document || null,
    blocklist_hit: Boolean(Number(existing?.blocklist_hit)),
    offmenu_flag: isPsilocybin(profile),
    published_live: Number(existing?.published_live) === 1,
    created_at: existing?.created_at,
  });
}

export async function submitForReview(db, env, request, { profile, user, title, description }) {
  if (!String(title || "").trim()) throw new ValidationError("Add a title before you send this to the library.");
  if (!String(description || "").trim()) throw new ValidationError("Add a short description before you send this to the library.");
  const photos = await db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", [profile.id]);
  if (photos.length < 1) throw new ValidationError("Add at least one photo before you send this to the library.");
  const hits = [...blocklistHits(title), ...blocklistHits(description)];
  const existing = await getReview(db, profile.id);
  await upsertReview(db, {
    profile_id: profile.id,
    status: REVIEW_PENDING,
    reason: "",
    title: String(title).trim(),
    description: String(description).trim(),
    live_document: existing?.live_document || null,
    blocklist_hit: hits.length > 0,
    offmenu_flag: isPsilocybin(profile, { title, description }),
    published_live: Number(existing?.published_live) === 1,
    created_at: existing?.created_at,
  });
  await logModeration(db, {
    profileId: profile.id,
    actorId: user.id,
    action: "submit",
    reason: hits.length ? `blocklist:${hits.join(",")}` : "",
  });
  return getReview(db, profile.id);
}

export async function approveReview(db, env, request, { profile, user, row }) {
  const review = await getReview(db, profile.id);
  if (!review || review.status !== REVIEW_PENDING) throw new ValidationError("This profile is not waiting for review.");
  await db.run("UPDATE profiles SET published=1, updated_at=? WHERE id=?", [nowIso(), profile.id]);
  await upsertReview(db, {
    ...review,
    status: REVIEW_PUBLISHED,
    reason: "",
    live_document: JSON.stringify(profile),
    published_live: 1,
  });
  await db.run("UPDATE profile_photos SET status='approved', updated_at=? WHERE profile_id=? AND withdrawn=0", [
    nowIso(),
    profile.id,
  ]);
  await logModeration(db, { profileId: profile.id, actorId: user.id, action: "approve", reason: "" });
  await notifyOwner(db, env, request, row, "approved", "");
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
    offmenu_flag: isPsilocybin(profile) ? 1 : 0,
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
    offmenu_flag: isPsilocybin(profile, { title, description }),
    reason: "Waiting for review of an edit.",
  });
  await logModeration(db, { profileId: profile.id, actorId: null, action: "edit_resubmit", reason: "body" });
  return getReview(db, profile.id);
}

export async function stashReportPhoto(db, env, { profileId, raw }) {
  if (!raw || !raw.byteLength) throw new ValidationError("Add a photo file.");
  const processed = processPhoto(raw);
  const pendingKey = photoObjectKey("pending");
  const stored = await env.storage.put(pendingKey, processed.bytes, processed.contentType);
  if (!stored) throw new ValidationError("Photo storage is not enabled yet. See the deploy note for the media bucket.", 503);
  const ts = nowIso();
  await db.run(
    "INSERT INTO profile_photos (profile_id, object_key, content_type, width, height, status, prescreen, withdrawn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [
      profileId,
      pendingKey,
      processed.contentType,
      processed.width,
      processed.height,
      "pending",
      JSON.stringify({ provider: "stub", flagged: false, labels: [], kind: "grow_report" }),
      ts,
      ts,
    ]
  );
  const review = await getReview(db, profileId);
  if (review && Number(review.published_live) === 1) {
    await upsertReview(db, {
      ...review,
      status: REVIEW_PENDING,
      reason: "Waiting for review of a grow report photo.",
    });
    await logModeration(db, { profileId, actorId: null, action: "edit_resubmit", reason: "grow_report_photo" });
  }
  return pendingKey;
}

export async function storePhoto(db, env, request, { profile, user, raw, contentType }) {
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
