-- +migrate Up
-- The audit trail reads the logs table newest-first within a time range;
-- until now nothing read it at all.
CREATE INDEX IF NOT EXISTS idx_logs_date_time ON logs(date_time DESC);

-- +migrate Down
DROP INDEX IF EXISTS idx_logs_date_time;
