-- +migrate Up
-- One row per connection to the server — listener and admin WebSockets and
-- background audio streams — so an admin can see who was connected after
-- they have gone. username is copied rather than joined so the row survives
-- the account being deleted; user_id is deliberately not a foreign key for
-- the same reason. user_id NULL is an anonymous (public access) listener.
-- country_code is resolved once, at connect, from the operator's GeoIP
-- database; NULL when there is none or the address is not in it.
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

-- Date-range listing and the retention prune.
CREATE INDEX IF NOT EXISTS idx_connection_log_connected_at ON connection_log(connected_at);
-- "Everything from this address."
CREATE INDEX IF NOT EXISTS idx_connection_log_ip ON connection_log(ip, connected_at);
-- "Everything by this account."
CREATE INDEX IF NOT EXISTS idx_connection_log_user ON connection_log(user_id, connected_at);

-- +migrate Down
DROP INDEX IF EXISTS idx_connection_log_user;
DROP INDEX IF EXISTS idx_connection_log_ip;
DROP INDEX IF EXISTS idx_connection_log_connected_at;
DROP TABLE IF EXISTS connection_log;
