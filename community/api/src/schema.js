export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    totp_secret_enc TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL,
    comment TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, profile_id)
);
CREATE TABLE IF NOT EXISTS grow_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    outcome TEXT NOT NULL,
    notes TEXT DEFAULT '',
    days REAL,
    flushes INTEGER,
    device_name TEXT,
    photo_key TEXT,
    photo_status TEXT NOT NULL DEFAULT 'approved',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grow_reports_photo_key ON grow_reports(photo_key);
CREATE TABLE IF NOT EXISTS uploaded_media (
    photo_key TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entitlements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item_id, item_type)
);
CREATE TABLE IF NOT EXISTS checkouts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT NOT NULL,
    profile_id TEXT,
    user_id INTEGER,
    destination TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guides (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    pricing TEXT NOT NULL,
    allowed_payment_providers TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(provider, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    family TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE TABLE IF NOT EXISTS oauth_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state TEXT NOT NULL UNIQUE,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    provider TEXT NOT NULL,
    redirect_to TEXT,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    kind TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_devices (
    id TEXT PRIMARY KEY,
    hardware_id TEXT NOT NULL UNIQUE,
    public_jwk TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    owner_id INTEGER,
    enroll_hash TEXT,
    claim_code_hash TEXT,
    claim_expires_at TEXT,
    cloud_enabled INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    device_type TEXT NOT NULL DEFAULT 'shrooly_chamber',
    last_inbox_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_certs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    serial TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    pem TEXT NOT NULL,
    issuer TEXT NOT NULL,
    status TEXT NOT NULL,
    cf_id TEXT,
    not_before TEXT,
    not_after TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS device_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    document TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_nonces (
    nonce_hash TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_nonces_device ON device_nonces(device_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_device_nonces_expires ON device_nonces(expires_at);
CREATE TABLE IF NOT EXISTS coach_subs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    period_end TEXT NOT NULL,
    auto_tune INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_usage (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    chats INTEGER NOT NULL DEFAULT 0,
    photos INTEGER NOT NULL DEFAULT 0,
    neurons INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS coach_cache (
    cache_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_device_mode (
    device_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'advisor',
    paused INTEGER NOT NULL DEFAULT 0,
    pause_reason TEXT,
    pause_until TEXT,
    profile_id TEXT,
    last_change_at TEXT,
    changes_day TEXT,
    changes_count INTEGER NOT NULL DEFAULT 0,
    last_setpoints TEXT,
    last_manual_at TEXT,
    pending_command_id INTEGER,
    delivery TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_autopilot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT NOT NULL,
    readings TEXT,
    undone_at TEXT,
    command_id INTEGER,
    apply_status TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_autopilot_log_device ON coach_autopilot_log(device_id, id);
CREATE INDEX IF NOT EXISTS idx_coach_autopilot_log_command ON coach_autopilot_log(command_id);
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
CREATE TABLE IF NOT EXISTS totp_pending (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_events (
    event_id TEXT PRIMARY KEY,
    checkout_id TEXT,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_telemetry_device ON device_telemetry(device_id, created_at);
CREATE TABLE IF NOT EXISTS alert_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    document TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_rules (
    device_id TEXT PRIMARY KEY REFERENCES cloud_devices(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_state (
    device_id TEXT NOT NULL REFERENCES cloud_devices(id) ON DELETE CASCADE,
    rule TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    episode_key TEXT,
    opened_at TEXT,
    last_open_notice_at TEXT,
    open_notified INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (device_id, rule)
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES cloud_devices(id) ON DELETE CASCADE,
    rule TEXT NOT NULL,
    kind TEXT NOT NULL,
    episode_key TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    status TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'email',
    created_at TEXT NOT NULL,
    delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, id);
CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id, id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, id);
CREATE TABLE IF NOT EXISTS alert_cron (
    name TEXT PRIMARY KEY,
    lease_until INTEGER NOT NULL DEFAULT 0,
    cursor TEXT NOT NULL DEFAULT '',
    runs INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_telemetry_device ON device_telemetry(device_id, created_at);
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
CREATE TABLE IF NOT EXISTS maintenance_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
`;
