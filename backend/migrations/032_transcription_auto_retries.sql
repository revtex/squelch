-- +migrate Up
-- How many times the server has retried a call on its own after go-whisper
-- could not be reached. An admin retry does not count; the automatic retry
-- stops at a small cap so a call that keeps failing is not sent forever.
ALTER TABLE transcription_jobs ADD COLUMN auto_retries INTEGER NOT NULL DEFAULT 0;

-- +migrate Down
ALTER TABLE transcription_jobs DROP COLUMN auto_retries;
