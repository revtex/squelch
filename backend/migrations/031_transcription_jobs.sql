-- +migrate Up
-- One row per call handed to the transcriber: what happened to it and why.
-- Retrying a call reuses its row, so the table never grows past the calls.
CREATE TABLE IF NOT EXISTS transcription_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id     INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
    status      TEXT    NOT NULL,   -- queued | done | failed | skipped
    error       TEXT,
    model       TEXT,
    duration_ms INTEGER,
    created_at  INTEGER NOT NULL,
    finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status_created ON transcription_jobs(status, created_at);

INSERT OR IGNORE INTO settings (key, value) VALUES ('transcriptionMinDurationMs', '0');

-- +migrate Down
DROP INDEX IF EXISTS idx_transcription_jobs_status_created;
DROP TABLE IF EXISTS transcription_jobs;
DELETE FROM settings WHERE key = 'transcriptionMinDurationMs';
