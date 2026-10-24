-- Device identity / mTLS tables. Safe to run on existing D1.
CREATE TABLE IF NOT EXISTS cloud_devices (
    id TEXT PRIMARY KEY,
    hardware_id TEXT NOT NULL UNIQUE,
    public_jwk TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    owner_id INTEGER,
    enroll_hash TEXT,
    claim_code_hash TEXT,
    claim_expires_at TEXT,
    cloud_enabled INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_certs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    serial TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    pem TEXT NOT NULL,
    issuer TEXT NOT NULL,
    status TEXT NOT NULL,
    cf_id TEXT,
    not_before TEXT,
    not_after TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS device_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    document TEXT NOT NULL,
    created_at TEXT NOT NULL
);
