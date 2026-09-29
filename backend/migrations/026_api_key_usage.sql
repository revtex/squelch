-- +migrate Up
-- What the admin needs to know about an API key beyond its hash: when it was
-- made, when and from where it last authenticated, and, while a rotation's
-- grace period runs, the hash of the key it replaced. calls.api_key_id says
-- which key uploaded a call so the admin can show calls per key; the index
-- backs that per-key count over a time window.
ALTER TABLE api_keys ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN last_used_at INTEGER;
ALTER TABLE api_keys ADD COLUMN last_used_ip TEXT;
ALTER TABLE api_keys ADD COLUMN previous_key TEXT;
ALTER TABLE api_keys ADD COLUMN previous_key_expires_at INTEGER;
UPDATE api_keys SET created_at = strftime('%s', 'now') WHERE created_at = 0;
ALTER TABLE calls ADD COLUMN api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_calls_api_key_datetime ON calls(api_key_id, date_time);

-- +migrate Down
DROP INDEX IF EXISTS idx_calls_api_key_datetime;
ALTER TABLE calls DROP COLUMN api_key_id;
ALTER TABLE api_keys DROP COLUMN previous_key_expires_at;
ALTER TABLE api_keys DROP COLUMN previous_key;
ALTER TABLE api_keys DROP COLUMN last_used_ip;
ALTER TABLE api_keys DROP COLUMN last_used_at;
ALTER TABLE api_keys DROP COLUMN created_at;
