-- Ship 9: community profile review. Additive tables plus a one-time live-document backfill
-- for published community profiles that predate this table. Official seed rows (author_id IS NULL)
-- stay public without a review row. json_valid skips malformed documents so the migration can finish.
-- confirmed_culinary_at is set only by the moderator confirm path. Legacy rows without that marker
-- are reclassified here when the stored taxon text matches a restricted pattern.
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
    updated_at TEXT NOT NULL,
    confirmed_culinary_at TEXT,
    confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
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
CREATE TABLE IF NOT EXISTS profile_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO profile_review (
    profile_id, status, reason, title, description, live_document,
    blocklist_hit, offmenu_flag, published_live, created_at, updated_at,
    confirmed_culinary_at, confirmed_by
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
    updated_at,
    NULL,
    NULL
FROM profiles
WHERE published = 1 AND author_id IS NOT NULL AND json_valid(document);
UPDATE profiles SET document = json_set(json_set(json_set(json_set(json_set(json_set(document, '$.pack', 'psilocybin'), '$.restricted', json('true')), '$.legal_notice', 'Psilocybin mushrooms are illegal to grow, possess, or sell in most countries and under US federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.'), '$.pricing', json('{"kind":"free","amount_cents":0,"currency":"USD","creator_share_percent":70}')), '$.affiliates_allowed', json('false')), '$.affiliate_links', json('[]'))
WHERE published = 1 AND author_id IS NOT NULL AND json_valid(document)
  AND id IN (SELECT profile_id FROM profile_review WHERE confirmed_culinary_at IS NULL)
  AND lower(coalesce(json_extract(document, '$.species'), '')) NOT LIKE 'gyroporus cyanescens%'
  AND (
    lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%psilocybe%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%psylocybe%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%panaeolus%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%copelandia%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%inocybe%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%gymnopilus%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%pluteus%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%conocybe%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%amanita%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%cubensis%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%cyanescens%'
    OR lower(coalesce(json_extract(document, '$.species'), '') || ' ' || coalesce(json_extract(document, '$.name'), '') || ' ' || coalesce(json_extract(document, '$.strain'), '') || ' ' || coalesce(json_extract(document, '$.variety_group'), '') || ' ' || coalesce(id, '')) LIKE '%semilanceat%'
  );
UPDATE profile_review SET live_document = (
    SELECT document FROM profiles WHERE profiles.id = profile_review.profile_id
), offmenu_flag = 1, updated_at = updated_at
WHERE confirmed_culinary_at IS NULL
  AND profile_id IN (
    SELECT id FROM profiles
    WHERE published = 1 AND author_id IS NOT NULL AND json_valid(document)
      AND json_extract(document, '$.pack') = 'psilocybin'
  );
