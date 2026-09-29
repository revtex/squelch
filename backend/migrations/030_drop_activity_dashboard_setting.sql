-- +migrate Up
-- activityDashboard was never read by the server; the Overview is always on.
DELETE FROM settings WHERE key = 'activityDashboard';

-- +migrate Down
INSERT OR IGNORE INTO settings (key, value) VALUES ('activityDashboard', 'false');
