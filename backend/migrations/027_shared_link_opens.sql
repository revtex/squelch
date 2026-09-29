-- +migrate Up
-- How often a shared call has been opened, for the admin's Shared links
-- page. Counted when the public page fetches the call, not the audio.
ALTER TABLE shared_links ADD COLUMN opens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shared_links ADD COLUMN last_opened_at INTEGER;

-- +migrate Down
ALTER TABLE shared_links DROP COLUMN last_opened_at;
ALTER TABLE shared_links DROP COLUMN opens;
