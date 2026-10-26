-- When each chamber last pulled its command inbox, so the site can say "delivered"
-- instead of guessing. Additive; existing rows start NULL.
ALTER TABLE cloud_devices ADD COLUMN last_inbox_at TEXT;
