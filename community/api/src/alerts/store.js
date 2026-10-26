/**
 * Every SQL statement the alerts feature runs. memory.js implements these exact strings for the
 * in-memory test database, and test/alerts-d1.test.js runs them against real SQLite (D1).
 */

export const SQL = {
  prefsGet: "SELECT * FROM alert_prefs WHERE user_id=?",
  prefsPut:
    "INSERT INTO alert_prefs (user_id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at",
  rulesGet: "SELECT * FROM alert_rules WHERE device_id=?",
  rulesPut:
    "INSERT INTO alert_rules (device_id, user_id, document, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET user_id=excluded.user_id, document=excluded.document, updated_at=excluded.updated_at",
  stateAll: "SELECT * FROM alert_state WHERE device_id=?",
  stateInit: "INSERT OR IGNORE INTO alert_state (device_id, rule, status, rev, updated_at) VALUES (?, ?, 'ok', 0, ?)",
  stateCas:
    "UPDATE alert_state SET status=?, episode_key=?, opened_at=?, last_open_notice_at=?, open_notified=?, rev=rev+1, updated_at=? WHERE device_id=? AND rule=? AND rev=?",
  alertInsert:
    "INSERT OR IGNORE INTO alerts (user_id, device_id, rule, kind, episode_key, dedupe_key, title, detail, status, channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  alertByDedupe: "SELECT * FROM alerts WHERE dedupe_key=?",
  alertGet: "SELECT * FROM alerts WHERE id=? AND user_id=?",
  alertClaim: "UPDATE alerts SET status='sending' WHERE id=? AND status=?",
  alertFinish: "UPDATE alerts SET status=?, delivered_at=? WHERE id=? AND status='sending'",
  alertsForUser: "SELECT * FROM alerts WHERE user_id=? ORDER BY id DESC LIMIT ?",
  alertsForDevice: "SELECT * FROM alerts WHERE user_id=? AND device_id=? ORDER BY id DESC LIMIT ?",
  alertsHeld: "SELECT * FROM alerts WHERE status='held' ORDER BY id LIMIT ?",
  sentSince: "SELECT COUNT(*) AS n FROM alerts WHERE user_id=? AND status IN ('sent', 'stub') AND delivered_at>=?",
  cronInit: "INSERT OR IGNORE INTO alert_cron (name, lease_until, cursor, runs) VALUES (?, 0, '', 0)",
  cronLease: "UPDATE alert_cron SET lease_until=?, runs=runs+1, last_run_at=? WHERE name=? AND lease_until<?",
  cronGet: "SELECT * FROM alert_cron WHERE name=?",
  cronRelease: "UPDATE alert_cron SET lease_until=0, cursor=? WHERE name=? AND lease_until=?",
  devicesPage:
    "SELECT d.id AS id, d.name AS name, d.owner_id AS owner_id, d.last_seen_at AS last_seen_at, r.document AS rules, r.user_id AS rules_user_id FROM cloud_devices d LEFT JOIN alert_rules r ON r.device_id=d.id WHERE d.status='active' AND d.owner_id IS NOT NULL AND d.id>? ORDER BY d.id LIMIT ?",
  telemetryWindow:
    "SELECT document, created_at FROM device_telemetry WHERE device_id=? AND created_at>=? ORDER BY created_at DESC LIMIT ?",
  userGet: "SELECT * FROM users WHERE id=?",
};

export function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}
