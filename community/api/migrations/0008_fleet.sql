-- Cloud chamber groups and fleet change log. Additive only. owner_id is ready for later shared fleets.
CREATE TABLE IF NOT EXISTS device_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_groups_owner ON device_groups(owner_id);
CREATE TABLE IF NOT EXISTS device_group_members (
    group_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (group_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_device_group_members_device ON device_group_members(device_id);
CREATE TABLE IF NOT EXISTS fleet_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    scope TEXT NOT NULL,
    target TEXT,
    preview TEXT,
    results TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_audit_owner ON fleet_audit(owner_id, id);
