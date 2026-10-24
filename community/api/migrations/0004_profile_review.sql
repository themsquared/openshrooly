-- Ship 9: community profile review. Additive only: new tables and indexes, no ALTER, no data rewrites.
-- Existing seed rows stay public (published=1 and no profile_review row).
-- Deploy note: enable the PHOTOS R2 binding before photo uploads work in production.
--   npx wrangler r2 bucket create shroomlabs-media
-- Then uncomment [[r2_buckets]] binding PHOTOS in wrangler.toml.
CREATE TABLE IF NOT EXISTS profile_review (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    live_document TEXT,
    blocklist_hit INTEGER NOT NULL DEFAULT 0,
    offmenu_flag INTEGER NOT NULL DEFAULT 0,
    published_live INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_review_status ON profile_review(status, updated_at);
CREATE TABLE IF NOT EXISTS profile_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    status TEXT NOT NULL,
    prescreen TEXT NOT NULL DEFAULT '{}',
    withdrawn INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_photos_profile ON profile_photos(profile_id, status);
CREATE TABLE IF NOT EXISTS moderation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_log_profile ON moderation_log(profile_id, id);
INSERT OR IGNORE INTO profile_review (
    profile_id, status, reason, title, description, live_document,
    blocklist_hit, offmenu_flag, published_live, created_at, updated_at
)
SELECT
    id,
    'published',
    '',
    COALESCE(json_extract(document, '$.name'), ''),
    COALESCE(json_extract(document, '$.summary'), ''),
    document,
    0,
    0,
    1,
    created_at,
    updated_at
FROM profiles
WHERE published = 1 AND author_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS profile_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
