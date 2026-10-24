-- Additive recovery codes for sign-in. Safe to run twice.
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_user ON totp_recovery_codes(user_id, used_at);
