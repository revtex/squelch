-- +migrate Up
-- Where each device session was last used from, for the admin's list of
-- signed-in devices. Every rotation inserts a new row, so the newest row of
-- a family describes the device as it is now: ip and user_agent are that
-- request's, created_at is when it last refreshed. signed_in_at is carried
-- forward from the login, because the family's first row is deleted once it
-- expires. native marks the Squelch app, which asks for its tokens in the
-- response body rather than in cookies.
ALTER TABLE refresh_tokens ADD COLUMN ip TEXT;
ALTER TABLE refresh_tokens ADD COLUMN user_agent TEXT;
ALTER TABLE refresh_tokens ADD COLUMN native INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refresh_tokens ADD COLUMN signed_in_at INTEGER;

-- +migrate Down
ALTER TABLE refresh_tokens DROP COLUMN signed_in_at;
ALTER TABLE refresh_tokens DROP COLUMN native;
ALTER TABLE refresh_tokens DROP COLUMN user_agent;
ALTER TABLE refresh_tokens DROP COLUMN ip;
