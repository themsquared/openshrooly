-- One-shot: D1 has no ADD COLUMN IF NOT EXISTS. Apply once before deploy.
-- Existing rows stay approved so already-public photo_key values are not hidden.
-- Do not rewrite R2. The Worker no longer ALTERs this column at boot.
ALTER TABLE grow_reports ADD COLUMN photo_status TEXT NOT NULL DEFAULT 'approved';
CREATE INDEX IF NOT EXISTS idx_grow_reports_photo_key ON grow_reports(photo_key);
