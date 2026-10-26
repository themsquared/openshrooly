/** Account export (GET /api/me/export) and delete (POST /api/me/delete). Both need a browser session. */

import { nowIso, sha256Hex } from "./crypto.js";

/** Name issueSession gives the website and app access token. Hub tokens can never take it. */
export const WEB_TOKEN_NAME = "mobile-access";
import { audit, clearSessionCookie, userFromRequest } from "./auth.js";
import { revokeDeviceCerts } from "./devices.js";
import { rateLimit } from "./security.js";
import { notifyDevice } from "./live.js";
import { ACCOUNT_SQL } from "./account-sql.js";
import { ValidationError } from "./profile-schema.js";

const S = ACCOUNT_SQL;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, status === 200 && headers["content-disposition"] ? 2 : 0), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function parse(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pick(row, keys) {
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
}

/** The website sign-in (cookie or its own access token) only. A hub connection token must never export or delete the account. */
async function sessionUser(request, db) {
  const { user, via } = await userFromRequest(request, db);
  if (!user) throw new ValidationError("sign in required", 401);
  if (via === "cookie") return user;
  if (via === "bearer") {
    const raw = (request.headers.get("authorization") || "").slice(7).trim();
    const row = await db.one(S.tokenByHash, [await sha256Hex(raw)]);
    if (row && row.name === WEB_TOKEN_NAME) return user;
  }
  throw new ValidationError("Sign in on the website to do this.", 403);
}

export async function buildExport(db, user) {
  const all = (sql, id = user.id) => db.all(sql, [id]);
  const devices = await all(S.devices);
  const groups = await all(S.groups);
  const groupRows = [];
  for (const g of groups) {
    const members = await db.all(S.groupMembers, [g.id]);
    groupRows.push({ id: g.id, name: g.name, created_at: g.created_at, devices: members.map((m) => m.device_id) });
  }
  return {
    exported_at: nowIso(),
    note: "Everything Shroom Labs keeps that is tied to your account. Passwords, keys, and session secrets are left out on purpose.",
    account: pick(user, ["id", "username", "email", "email_verified", "display_name", "role", "totp_enabled", "created_at"]),
    sign_in: {
      providers: (await all(S.identities)).map((r) => pick(r, ["provider", "created_at"])),
      passkeys: (await all(S.passkeys)).map((r) => pick(r, ["created_at"])),
      sessions: (await all(S.sessions)).map((r) => pick(r, ["created_at", "expires_at", "revoked_at", "user_agent", "ip"])),
      hub_connections: (await all(S.tokens)).map((r) => pick(r, ["name", "created_at"])),
    },
    profiles: (await all(S.profiles)).map((r) => ({
      id: r.id,
      published: Boolean(Number(r.published)),
      created_at: r.created_at,
      updated_at: r.updated_at,
      downloads: r.downloads,
      document: parse(r.document),
    })),
    ratings: (await all(S.ratings)).map((r) => pick(r, ["profile_id", "stars", "comment", "created_at"])),
    grow_reports: (await all(S.reports)).map((r) =>
      pick(r, ["profile_id", "outcome", "notes", "days", "flushes", "device_name", "photo_key", "created_at"])
    ),
    uploads: (await all(S.media)).map((r) => pick(r, ["photo_key", "kind", "status", "created_at"])),
    purchases: {
      entitlements: (await all(S.entitlements)).map((r) => pick(r, ["item_id", "item_type", "granted_at"])),
      checkouts: (await all(S.checkouts)).map((r) => pick(r, ["id", "item_id", "provider", "status", "amount_cents", "created_at"])),
    },
    grow_coach: {
      plan: (await all(S.coachSub)).map((r) => pick(r, ["status", "period_end", "auto_tune", "created_at"]))[0] || null,
      usage_by_day: (await all(S.coachUsage)).map((r) => pick(r, ["day", "chats", "photos"])),
      chamber_modes: (await all(S.coachModes)).map((r) => pick(r, ["device_id", "mode", "paused", "profile_id", "updated_at"])),
      changes: (await all(S.coachLog)).map((r) =>
        pick(r, ["device_id", "action", "old_value", "new_value", "reason", "undone_at", "created_at"])
      ),
    },
    chambers: devices.map((d) => ({
      id: d.id,
      hardware_id: String(d.hardware_id || "").split(/[#~]/)[0],
      name: d.name,
      status: d.status,
      device_type: d.device_type,
      last_seen_at: d.last_seen_at,
      created_at: d.created_at,
    })),
    chamber_groups: groupRows,
    bulk_changes: (await all(S.fleetAudit)).map((r) => ({ ...pick(r, ["action", "scope", "target", "created_at"]), results: parse(r.results) })),
    alerts: {
      settings: (await all(S.alertPrefs)).map((r) => parse(r.document))[0] || null,
      chamber_rules: (await all(S.alertRules)).map((r) => ({ device_id: r.device_id, rules: parse(r.document) })),
      sent: (await all(S.alerts)).map((r) => pick(r, ["device_id", "kind", "title", "detail", "status", "created_at", "delivered_at"])),
    },
    security_log: (await all(S.events)).map((r) => pick(r, ["kind", "detail", "ip", "created_at"])),
  };
}

async function deleteObject(storage, key) {
  if (!key || !storage?.delete) return;
  try {
    await storage.delete(key);
  } catch {
    // A missing photo must not stop the account delete.
  }
}

/** Removes the account and everything tied to it. Chambers are unlinked and keep growing. */
export async function deleteAccount(env, db, user) {
  const run = (sql, id) => db.run(sql, [id]);
  const devices = await db.all(S.devices, [user.id]);
  for (const device of devices) {
    await revokeDeviceCerts(env, db, device.id, "revoked");
    await run(S.releaseDevice, device.id);
    for (const sql of [
      S.delTelemetry,
      S.delCommands,
      S.delNonces,
      S.delAlertRulesDevice,
      S.delAlertStateDevice,
      S.delAlertsDevice,
      S.delCoachModeDevice,
      S.delCoachLogDevice,
      S.delGroupMembersDevice,
    ]) {
      await run(sql, device.id);
    }
  }
  for (const group of await db.all(S.groups, [user.id])) await run(S.delGroupMembers, group.id);

  for (const profile of await db.all(S.profiles, [user.id])) {
    for (const photo of await db.all(S.profilePhotos, [profile.id])) await deleteObject(env.storage, photo.object_key);
    for (const report of await db.all("SELECT * FROM grow_reports WHERE profile_id=?", [profile.id])) {
      await deleteObject(env.storage, report.photo_key);
    }
    for (const sql of [
      S.delProfilePhotos,
      S.delProfileReview,
      S.delProfileRatings,
      S.delProfileReports,
      S.delModerationLog,
      S.delProfileFlags,
      S.delProfile,
    ]) {
      await run(sql, profile.id);
    }
  }
  for (const report of await db.all(S.reports, [user.id])) await deleteObject(env.storage, report.photo_key);
  for (const media of await db.all(S.media, [user.id])) await deleteObject(env.storage, media.photo_key);

  for (const sql of [
    S.delGroups,
    S.delFleetAudit,
    S.delRatings,
    S.delReports,
    S.delMedia,
    S.delEntitlements,
    S.delCheckouts,
    S.delCoachSub,
    S.delCoachUsage,
    S.delCoachModes,
    S.delCoachLog,
    S.delAlertPrefs,
    S.delAlertRules,
    S.delAlerts,
    S.delIdentities,
    S.delPasskeys,
    S.delRefresh,
    S.delTokens,
    S.delTotpPending,
    S.delEvents,
    S.clearClicks,
    S.clearConfirmedBy,
    S.clearModerationActor,
    S.clearReporter,
    S.delSessions,
    S.delUser,
  ]) {
    await run(sql, user.id);
  }
  // Open device pages drop the chamber right away instead of on the next reading.
  if (env.DEVICE_LIVE) {
    await Promise.all(devices.map((d) => notifyDevice(env, d.id, "unlink").catch(() => {})));
  }
}

async function paidCoachActive(db, user) {
  const sub = await db.one(S.coachSub, [user.id]);
  if (!sub || sub.status !== "active" || !(sub.period_end > nowIso())) return false;
  const checkouts = await db.all(S.checkouts, [user.id]);
  return checkouts.some((c) => c.provider === "stripe" && c.status !== "failed");
}

export async function handleAccount(method, path, url, request, env) {
  const { db } = env;
  if (method === "GET" && path === "/api/me/export") {
    const user = await sessionUser(request, db);
    const limited = await rateLimit(db, `account-export:${user.id}`, 10, 3600);
    if (!limited.ok) return json({ error: "Too many exports. Try again in an hour." }, 429);
    const day = nowIso().slice(0, 10);
    return json(await buildExport(db, user), 200, {
      "content-disposition": `attachment; filename="shroomlabs-${user.username}-${day}.json"`,
    });
  }

  if (method === "POST" && path === "/api/me/delete") {
    const user = await sessionUser(request, db);
    const limited = await rateLimit(db, `account-delete:${user.id}`, 5, 3600);
    if (!limited.ok) return json({ error: "Too many tries. Try again in an hour." }, 429);
    const body = await request.json().catch(() => ({}));
    const typed = String(body.confirm || "").trim().toLowerCase();
    if (!typed || typed !== String(user.username).toLowerCase()) {
      throw new ValidationError("Type your username exactly to delete your account.", 400);
    }
    if (user.role === "admin") throw new ValidationError("Admin accounts cannot be deleted here.", 403);
    if (await paidCoachActive(db, user)) {
      throw new ValidationError("Cancel your Grow Coach plan first. Then you can delete your account.", 409);
    }
    await deleteAccount(env, db, user);
    // Kept without a user id so abuse can still be traced to an address for a while.
    await audit(db, null, "account_deleted", `user ${user.id}`, request);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  return null;
}
