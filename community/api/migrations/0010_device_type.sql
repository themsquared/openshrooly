-- Hardware type on claimed chambers. Additive. Existing rows become shrooly_chamber.
ALTER TABLE cloud_devices ADD COLUMN device_type TEXT NOT NULL DEFAULT 'shrooly_chamber';
