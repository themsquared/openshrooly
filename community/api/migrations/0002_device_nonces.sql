-- Ship 4: single-use, short-lived server nonces for device proof of possession.
-- Additive only: creates a new table and indexes, touches no existing data.
CREATE TABLE IF NOT EXISTS device_nonces (
    nonce_hash TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_nonces_device ON device_nonces(device_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_device_nonces_expires ON device_nonces(expires_at);
