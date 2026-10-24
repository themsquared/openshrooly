-- Pending grow-report photos until staff can review them. Existing rows stay
-- approved so already-public photo_key values are not hidden. Do not rewrite R2.
ALTER TABLE grow_reports ADD COLUMN photo_status TEXT NOT NULL DEFAULT 'approved';
