/** Deny-by-default ACL for /api/media. User uploads are never served from CDN_BASE_URL. */

import { nowIso, randomToken } from "./crypto.js";

export function isStaff(user) {
  const role = user?.role || "";
  return role === "admin" || role === "moderator" || role === "staff";
}

export function mediaApproved(row) {
  return (row?.status || "") === "approved";
}

export function canSeeMedia(user, row) {
  if (!row) return false;
  if (mediaApproved(row)) return true;
  if (!user) return false;
  if (isStaff(user)) return true;
  return Number(user.id) === Number(row.owner_id);
}

export function mediaApiUrl(env, key) {
  if (!key) return null;
  const origin = String(env?.API_ORIGIN || "").replace(/\/$/, "");
  const path = `/api/media/${encodeURIComponent(key)}`;
  return origin ? `${origin}${path}` : path;
}

export function pendingPhotoKey(kind, ownerToken, ext) {
  return `pending/${kind}/${ownerToken}/${randomToken()}.${ext}`;
}

export async function insertMedia(db, { photo_key, owner_id, status, kind }) {
  await db.run("INSERT INTO uploaded_media (photo_key, owner_id, status, kind, created_at) VALUES (?, ?, ?, ?, ?)", [
    photo_key,
    owner_id,
    status,
    kind,
    nowIso(),
  ]);
}

export async function getMedia(db, photoKey) {
  return db.one("SELECT * FROM uploaded_media WHERE photo_key=?", [photoKey]);
}

export async function setMediaStatus(db, photoKey, status) {
  if (!photoKey) return;
  await db.run("UPDATE uploaded_media SET status=? WHERE photo_key=?", [status, photoKey]);
}
