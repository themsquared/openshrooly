-- Deny-by-default ACL for /api/media. Safe to rerun.
CREATE TABLE IF NOT EXISTS uploaded_media (
    photo_key TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grow_reports_photo_key ON grow_reports(photo_key);
