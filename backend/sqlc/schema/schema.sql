CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT    UNIQUE NOT NULL,
    password_hash        TEXT    NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'listener',
    disabled             INTEGER NOT NULL DEFAULT 0,
    systems_json         TEXT,
    expiration           INTEGER,
    "limit"              INTEGER,
    password_need_change INTEGER NOT NULL DEFAULT 0,
    tg_selection_json    TEXT,
    preferences_json     TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
    id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    setup_complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT    UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT    UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS systems (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    system_id       INTEGER UNIQUE NOT NULL,
    label           TEXT    NOT NULL,
    auto_populate_talkgroups INTEGER NOT NULL DEFAULT 1,
    blacklists_json TEXT,
    led             TEXT,
    "order"         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS talkgroups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    talkgroup_id INTEGER NOT NULL,
    label        TEXT,
    name         TEXT,
    frequency    INTEGER,
    led          TEXT,
    group_id     INTEGER REFERENCES groups(id),
    tag_id       INTEGER REFERENCES tags(id),
    "order"      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (system_id, talkgroup_id)
);

CREATE TABLE IF NOT EXISTS units (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    unit_id   INTEGER NOT NULL,
    label     TEXT,
    "order"   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calls (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_path       TEXT    NOT NULL,
    audio_name       TEXT    NOT NULL,
    audio_type       TEXT    NOT NULL,
    date_time        INTEGER NOT NULL,
    frequency        INTEGER,
    duration         INTEGER,
    source           INTEGER,
    sources_json     TEXT,
    frequencies_json TEXT,
    patches_json     TEXT,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    talkgroup_id     INTEGER REFERENCES talkgroups(id) ON DELETE SET NULL,
    site             TEXT,
    channel          TEXT,
    decoder          TEXT,
    error_count      INTEGER,
    spike_count      INTEGER,
    talker_alias     TEXT,
    api_key_id       INTEGER REFERENCES api_keys(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_datetime_system_tg ON calls(date_time, system_id, talkgroup_id);
CREATE INDEX IF NOT EXISTS idx_calls_system_tg ON calls(system_id, talkgroup_id);
CREATE INDEX IF NOT EXISTS idx_calls_api_key_datetime ON calls(api_key_id, date_time);

CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    key          TEXT    UNIQUE NOT NULL,
    ident        TEXT,
    disabled     INTEGER NOT NULL DEFAULT 0,
    systems_json TEXT,
    call_rate_limit INTEGER,
    "order"      INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    last_used_ip TEXT,
    previous_key TEXT,
    previous_key_expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS dirmonitors (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    directory    TEXT    NOT NULL,
    type         TEXT    NOT NULL,
    mask         TEXT,
    extension    TEXT,
    frequency    INTEGER,
    delay        INTEGER,
    delete_after INTEGER NOT NULL DEFAULT 0,
    use_polling  INTEGER NOT NULL DEFAULT 0,
    disabled     INTEGER NOT NULL DEFAULT 0,
    system_id    INTEGER REFERENCES systems(id),
    talkgroup_id INTEGER REFERENCES talkgroups(id),
    "order"      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS downstreams (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    url          TEXT    NOT NULL,
    api_key      TEXT    NOT NULL,
    systems_json TEXT,
    disabled     INTEGER NOT NULL DEFAULT 0,
    "order"      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date_time INTEGER NOT NULL,
    level     TEXT    NOT NULL,
    message   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id    INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT,
    created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_call ON bookmarks(user_id, call_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhooks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    url          TEXT    NOT NULL,
    type         TEXT    NOT NULL DEFAULT 'generic',
    secret       TEXT,
    systems_json TEXT,
    disabled     INTEGER NOT NULL DEFAULT 0,
    "order"      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id   TEXT,
    endpoint     TEXT    NOT NULL,
    keys_json    TEXT    NOT NULL,
    systems_json TEXT,
    created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transcriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id     INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
    text        TEXT    NOT NULL,
    segments    TEXT,
    language    TEXT,
    model       TEXT,
    duration_ms INTEGER,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_text ON transcriptions(text);

CREATE TABLE IF NOT EXISTS shared_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id    INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    opens          INTEGER NOT NULL DEFAULT 0,
    last_opened_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_shared_links_token ON shared_links(token);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT    NOT NULL UNIQUE,
    family_id       TEXT    NOT NULL,
    expires_at      INTEGER NOT NULL,
    revoked         INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    ip              TEXT,
    user_agent      TEXT,
    native          INTEGER NOT NULL DEFAULT 0,
    signed_in_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS connection_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kind              TEXT    NOT NULL,
    user_id           INTEGER,
    username          TEXT,
    ip                TEXT    NOT NULL,
    country_code      TEXT,
    user_agent        TEXT,
    native            INTEGER NOT NULL DEFAULT 0,
    family_id         TEXT,
    connected_at      INTEGER NOT NULL,
    disconnected_at   INTEGER,
    disconnect_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_connection_log_connected_at ON connection_log(connected_at);
CREATE INDEX IF NOT EXISTS idx_connection_log_ip ON connection_log(ip, connected_at);
CREATE INDEX IF NOT EXISTS idx_connection_log_user ON connection_log(user_id, connected_at);

CREATE TABLE IF NOT EXISTS tr_instances (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT    NOT NULL UNIQUE,
    instance_id     TEXT    NOT NULL,
    broker_url      TEXT    NOT NULL,
    base_topic      TEXT    NOT NULL,
    unit_topic      TEXT,
    message_topic   TEXT,
    username        TEXT,
    password_enc    TEXT,
    tls_skip_verify INTEGER NOT NULL DEFAULT 0,
    qos             INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_seen_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tr_instances_enabled ON tr_instances(enabled);

CREATE TABLE IF NOT EXISTS ip_blocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cidr       TEXT    NOT NULL UNIQUE,
    reason     TEXT    NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
);
