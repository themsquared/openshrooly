-- Community grow progress feed: a photo and a short note tied to a culinary profile.
-- Additive only. New tables and indexes, nothing existing is touched.
CREATE TABLE IF NOT EXISTS grow_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_id TEXT,
    grow_day INTEGER,
    note TEXT NOT NULL DEFAULT '',
    photo_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'visible',
    report_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grow_posts_feed ON grow_posts (status, id);
CREATE INDEX IF NOT EXISTS idx_grow_posts_profile ON grow_posts (profile_id, status, id);
CREATE INDEX IF NOT EXISTS idx_grow_posts_user ON grow_posts (user_id, id);
CREATE TABLE IF NOT EXISTS grow_post_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES grow_posts(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grow_post_reports_once ON grow_post_reports (post_id, reporter_id);
