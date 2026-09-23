-- +migrate Up
-- Per-listener client preferences that follow the account rather than the
-- browser: the keypad beep style to begin with. One JSON column rather than
-- a column per preference, because these are the client's own settings and
-- the server only stores and returns them.
ALTER TABLE users ADD COLUMN preferences_json TEXT;

-- +migrate Down
ALTER TABLE users DROP COLUMN preferences_json;
