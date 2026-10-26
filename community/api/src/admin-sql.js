/** Every statement the admin page runs. Read only. admin-memory.js mirrors them for tests and the local server. */

export const ADMIN_SQL = Object.freeze({
  users: "SELECT id, username, email, email_verified, role, created_at FROM users ORDER BY id",
  lastSessions: "SELECT user_id, MAX(created_at) AS last_at FROM sessions GROUP BY user_id",
  devices: "SELECT * FROM cloud_devices ORDER BY created_at",
  deviceModes: "SELECT device_id, user_id, mode, paused FROM coach_device_mode",
  linkEvents:
    "SELECT id, user_id, kind, detail, created_at FROM security_events WHERE kind IN ('device_claim', 'device_enroll', 'device_relink_enroll', 'device_reclaim', 'device_revoke', 'device_self_revoke') ORDER BY id DESC LIMIT 500",
  coachSubs: "SELECT user_id, status, period_end, created_at FROM coach_subs",
  checkouts: "SELECT id, user_id, item_id, status, amount_cents, details, created_at FROM checkouts ORDER BY created_at DESC",
  entitlements: "SELECT user_id, item_id, item_type, granted_at FROM entitlements",
  autopilotLog: "SELECT id, device_id, user_id, readings, created_at FROM coach_autopilot_log WHERE created_at>=?",
  jevCounters: "SELECT cache_key, value FROM coach_cache WHERE cache_key LIKE 'jev:%'",
  visionCounters: "SELECT cache_key, value FROM coach_cache WHERE cache_key LIKE 'vision:%'",
  coachUsage: "SELECT user_id, day, chats, photos, neurons FROM coach_usage WHERE day>=?",
  alertEmails: "SELECT user_id, created_at FROM alerts WHERE channel='email' AND status='sent' AND created_at>=?",
  magicLinks: "SELECT email, purpose, created_at FROM magic_links WHERE created_at>=?",
  emailCaps: "SELECT key, count FROM rate_limits WHERE key LIKE 'email-cap:%'",
});
