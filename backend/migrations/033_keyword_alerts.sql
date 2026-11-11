-- +migrate Up
-- Keyword alerts: match transcript text after Whisper finishes, then POST
-- to configured targets (Slack, ESP display, or generic JSON).
CREATE TABLE IF NOT EXISTS keyword_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    label           TEXT    NOT NULL DEFAULT '',
    patterns_json   TEXT    NOT NULL DEFAULT '[]',
    systems_json    TEXT,
    talkgroups_json TEXT,
    cooldown_sec    INTEGER NOT NULL DEFAULT 120,
    disabled        INTEGER NOT NULL DEFAULT 0,
    "order"         INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS keyword_targets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT    NOT NULL DEFAULT '',
    type        TEXT    NOT NULL DEFAULT 'generic',
    url         TEXT    NOT NULL,
    secret      TEXT,
    rules_json  TEXT,
    disabled    INTEGER NOT NULL DEFAULT 0,
    "order"     INTEGER NOT NULL DEFAULT 0,
    last_at     INTEGER,
    last_ok     INTEGER NOT NULL DEFAULT 0,
    last_status INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT    NOT NULL DEFAULT '',
    last_ok_at  INTEGER
);

-- +migrate Down
DROP TABLE IF EXISTS keyword_targets;
DROP TABLE IF EXISTS keyword_rules;
