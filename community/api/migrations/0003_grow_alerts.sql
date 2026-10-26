-- Ship 8: grow alerts by email. Additive only: new tables and indexes, no ALTER, no data rewrites.
CREATE TABLE IF NOT EXISTS alert_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    document TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_rules (
    device_id TEXT PRIMARY KEY REFERENCES cloud_devices(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_state (
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    rule TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    episode_key TEXT,
    opened_at TEXT,
    last_open_notice_at TEXT,
    open_notified INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (device_id, rule)
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES cloud_devices(id) ON DELETE CASCADE,
    rule TEXT NOT NULL,
    kind TEXT NOT NULL,
    episode_key TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    status TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'email',
    created_at TEXT NOT NULL,
    delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, id);
CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id, id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, id);
CREATE TABLE IF NOT EXISTS alert_cron (
    name TEXT PRIMARY KEY,
    lease_until INTEGER NOT NULL DEFAULT 0,
    cursor TEXT NOT NULL DEFAULT '',
    runs INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_telemetry_device ON device_telemetry(device_id, created_at);
