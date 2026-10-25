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

export function pendingPhotoKey(kind, _ownerToken, ext) {
  return `pending/${kind}/${randomToken()}.${ext}`;
}

export function approvedObjectKey(pendingKey) {
  const key = String(pendingKey || "");
  if (key.startsWith("pending/")) return key.slice("pending/".length);
  return key.replace("/pending/", "/approved/");
}

/** Inverse of approvedObjectKey for leftover pending objects after a retry. */
export function pendingSiblingKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.startsWith("pending/")) return value;
  if (value.includes("/approved/")) return value.replace("/approved/", "/pending/");
  return `pending/${value}`;
}

export function isPendingObjectKey(key) {
  const value = String(key || "");
  return value.startsWith("pending/") || value.includes("/pending/");
}

/**
 * Copy pending → approved. Never deletes. Safe to retry: if the approved
 * object already exists, this is a no-op. Caller updates the DB, then deletes.
 */
export async function copyApprovedObject(storage, fromKey) {
  const nextKey = approvedObjectKey(fromKey);
  if (!fromKey) return { fromKey, nextKey: fromKey, copied: false, missing: true };
  if (!storage) return { fromKey, nextKey, copied: false, missing: true };
  if (nextKey === fromKey) {
    const file = await storage.get(fromKey);
    return { fromKey, nextKey, copied: false, missing: !file };
  }
  if (await storage.get(nextKey)) return { fromKey, nextKey, copied: true, missing: false };
  const file = await storage.get(fromKey);
  if (!file) return { fromKey, nextKey, copied: false, missing: true };
  await storage.put(nextKey, file.bytes, file.contentType);
  return { fromKey, nextKey, copied: true, missing: false };
}

export async function deleteStoredObject(storage, key) {
  if (!storage?.delete || !key) return;
  try {
    await storage.delete(key);
  } catch {
    // Leftover pending objects are removed on the next approve retry.
  }
}

export async function finishApprovedObject(storage, currentKey) {
  const leftover = pendingSiblingKey(currentKey);
  if (leftover && leftover !== currentKey) await deleteStoredObject(storage, leftover);
}

/**
 * Rewrite the ACL row after a copy. Inserts the new key first so a crash
 * cannot leave the DB pointing at a key with no uploaded_media row.
 */
export async function replaceMediaKey(db, fromKey, toKey, status) {
  if (!fromKey && !toKey) return;
  if (fromKey && fromKey === toKey) {
    await setMediaStatus(db, fromKey, status);
    return;
  }
  const fromRow = fromKey ? await getMedia(db, fromKey) : null;
  const toRow = toKey ? await getMedia(db, toKey) : null;
  const row = fromRow || toRow;
  if (toKey && row && !toRow) {
    await insertMedia(db, { photo_key: toKey, owner_id: row.owner_id, status, kind: row.kind });
  } else if (toKey && toRow) {
    await setMediaStatus(db, toKey, status);
  }
  if (fromKey && fromKey !== toKey) await db.run("DELETE FROM uploaded_media WHERE photo_key=?", [fromKey]);
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
