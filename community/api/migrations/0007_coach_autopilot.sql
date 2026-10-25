-- Grow Coach Advisor / Autopilot per-device mode and audit log. Additive only.
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
