-- Grow Coach subscription + usage. Safe on existing D1.
CREATE TABLE IF NOT EXISTS coach_subs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    period_end TEXT NOT NULL,
    auto_tune INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_usage (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    chats INTEGER NOT NULL DEFAULT 0,
    photos INTEGER NOT NULL DEFAULT 0,
    neurons INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS coach_cache (
    cache_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_device_mode (
    device_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'advisor',
    paused INTEGER NOT NULL DEFAULT 0,
    pause_reason TEXT,
    pause_until TEXT,
    profile_id TEXT,
    last_change_at TEXT,
    changes_day TEXT,
    changes_count INTEGER NOT NULL DEFAULT 0,
    last_setpoints TEXT,
    last_manual_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_autopilot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT NOT NULL,
    readings TEXT,
    undone_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_autopilot_log_device ON coach_autopilot_log(device_id, id);
