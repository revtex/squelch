-- +migrate Up
-- A name for each downstream and webhook, so the admin, the audit log and
-- the attention list can say which one failed, and the outcome of the last
-- delivery so a failing target is visible without reading the logs.
ALTER TABLE downstreams ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE downstreams ADD COLUMN last_at INTEGER;
ALTER TABLE downstreams ADD COLUMN last_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE downstreams ADD COLUMN last_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE downstreams ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE downstreams ADD COLUMN last_ok_at INTEGER;
ALTER TABLE webhooks ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE webhooks ADD COLUMN last_at INTEGER;
ALTER TABLE webhooks ADD COLUMN last_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhooks ADD COLUMN last_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhooks ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE webhooks ADD COLUMN last_ok_at INTEGER;

-- +migrate Down
ALTER TABLE webhooks DROP COLUMN last_ok_at;
ALTER TABLE webhooks DROP COLUMN last_error;
ALTER TABLE webhooks DROP COLUMN last_status;
ALTER TABLE webhooks DROP COLUMN last_ok;
ALTER TABLE webhooks DROP COLUMN last_at;
ALTER TABLE webhooks DROP COLUMN label;
ALTER TABLE downstreams DROP COLUMN last_ok_at;
ALTER TABLE downstreams DROP COLUMN last_error;
ALTER TABLE downstreams DROP COLUMN last_status;
ALTER TABLE downstreams DROP COLUMN last_ok;
ALTER TABLE downstreams DROP COLUMN last_at;
ALTER TABLE downstreams DROP COLUMN label;
