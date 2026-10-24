-- Pending grow-report photos until staff can review them. Existing rows stay
-- approved so already-public photo_key values are not hidden. Do not rewrite R2.
-- Numbered 0005 to follow 0004_profile_review on this branch. After PR #42
-- merges, its 0004_grow_report_photo_status keeps the same ALTER.
ALTER TABLE grow_reports ADD COLUMN photo_status TEXT NOT NULL DEFAULT 'approved';
