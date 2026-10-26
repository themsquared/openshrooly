/** In-memory versions of the statements in admin-sql.js, for tests and the local server. */

import { ADMIN_SQL } from "./admin-sql.js";

const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const BY_SQL = new Map(Object.entries(ADMIN_SQL).map(([name, sql]) => [norm(sql), name]));
const LINK_KINDS = new Set(["device_claim", "device_enroll", "device_relink_enroll", "device_reclaim", "device_revoke", "device_self_revoke"]);
const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
const since = (rows, field, cutoff) => rows.filter((r) => String(r[field] || "") >= String(cutoff));

/** Returns undefined when the statement is not an admin statement. */
export function dispatchAdmin(tables, q) {
  const name = BY_SQL.get(q);
  if (!name) return undefined;
  return (params) => run(tables, name, params);
}

function run(t, name, params) {
  switch (name) {
    case "users":
      return [...t.users].sort((a, b) => a.id - b.id).map((r) => pick(r, ["id", "username", "email", "email_verified", "role", "created_at"]));
    case "lastSessions": {
      const last = new Map();
      for (const s of t.sessions) if (!last.has(s.user_id) || s.created_at > last.get(s.user_id)) last.set(s.user_id, s.created_at);
      return [...last].map(([user_id, last_at]) => ({ user_id, last_at }));
    }
    case "devices":
      return [...t.cloud_devices].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    case "deviceModes":
      return t.coach_device_mode.map((r) => pick(r, ["device_id", "user_id", "mode", "paused"]));
    case "linkEvents":
      return t.security_events
        .filter((r) => LINK_KINDS.has(r.kind))
        .sort((a, b) => b.id - a.id)
        .slice(0, 500)
        .map((r) => pick(r, ["id", "user_id", "kind", "detail", "created_at"]));
    case "coachSubs":
      return t.coach_subs.map((r) => pick(r, ["user_id", "status", "period_end", "created_at"]));
    case "checkouts":
      return [...t.checkouts]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((r) => pick(r, ["id", "user_id", "item_id", "status", "amount_cents", "details", "created_at"]));
    case "entitlements":
      return t.entitlements.map((r) => pick(r, ["user_id", "item_id", "item_type", "granted_at"]));
    case "autopilotLog":
      return since(t.coach_autopilot_log, "created_at", params[0]).map((r) => pick(r, ["id", "device_id", "user_id", "readings", "created_at"]));
    case "jevCounters":
      return t.coach_cache.filter((r) => String(r.cache_key).startsWith("jev:")).map((r) => pick(r, ["cache_key", "value"]));
    case "visionCounters":
      return t.coach_cache.filter((r) => String(r.cache_key).startsWith("vision:")).map((r) => pick(r, ["cache_key", "value"]));
    case "coachUsage":
      return since(t.coach_usage, "day", params[0]).map((r) => pick(r, ["user_id", "day", "chats", "photos", "neurons"]));
    case "alertEmails":
      return since(
        (t.alerts || []).filter((r) => (r.channel || "email") === "email" && r.status === "sent"),
        "created_at",
        params[0]
      ).map((r) => pick(r, ["user_id", "created_at"]));
    case "magicLinks":
      return since(t.magic_links, "created_at", params[0]).map((r) => pick(r, ["email", "purpose", "created_at"]));
    case "emailCaps":
      return t.rate_limits.filter((r) => String(r.key).startsWith("email-cap:")).map((r) => pick(r, ["key", "count"]));
    default:
      throw new Error(`admin-memory: unhandled ${name}`);
  }
}
