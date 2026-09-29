-- +migrate Up
-- Addresses and ranges refused on every route. Read whole into memory by
-- package ipblock; no index beyond the UNIQUE on cidr, which also backs the
-- duplicate check on create.
CREATE TABLE IF NOT EXISTS ip_blocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cidr       TEXT    NOT NULL UNIQUE,
    reason     TEXT    NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
);

-- +migrate Down
DROP TABLE ip_blocks;
