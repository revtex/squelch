-- name: UpsertTranscriptionJob :exec
-- A call handed to the transcriber (again): back to queued with a clean slate.
INSERT INTO transcription_jobs (call_id, status, error, model, duration_ms, created_at, finished_at)
VALUES (:call_id, :status, :error, :model, NULL, :created_at, CASE WHEN :status = 'queued' THEN NULL ELSE :created_at END)
ON CONFLICT(call_id) DO UPDATE SET
    status = excluded.status,
    error = excluded.error,
    model = excluded.model,
    duration_ms = NULL,
    created_at = excluded.created_at,
    finished_at = excluded.finished_at;

-- name: FinishTranscriptionJob :exec
UPDATE transcription_jobs
SET status = :status, error = :error, duration_ms = :duration_ms, finished_at = :finished_at
WHERE call_id = :call_id;

-- name: GetTranscriptionJob :one
SELECT * FROM transcription_jobs WHERE call_id = ? LIMIT 1;

-- name: ListTranscriptionJobs :many
-- Recent jobs with the call they belong to; an empty status lists them all.
SELECT
    j.call_id, j.status, j.error, j.model, j.duration_ms, j.created_at, j.finished_at,
    c.date_time AS call_time,
    CAST(COALESCE(c.duration, 0) AS INTEGER) AS call_duration_ms,
    s.label AS system_label,
    t.talkgroup_id AS talkgroup_number,
    t.label AS talkgroup_label
FROM transcription_jobs j
JOIN calls c ON c.id = j.call_id
JOIN systems s ON s.id = c.system_id
LEFT JOIN talkgroups t ON t.id = c.talkgroup_id
WHERE (@status = '' OR j.status = @status)
ORDER BY j.created_at DESC, j.id DESC
LIMIT @limit;

-- name: CountTranscriptionJobs :one
SELECT
    CAST(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS INTEGER) AS queued,
    CAST(SUM(CASE WHEN status = 'failed' AND finished_at >= @since THEN 1 ELSE 0 END) AS INTEGER) AS failed_recent,
    CAST(SUM(CASE WHEN status = 'skipped' AND finished_at >= @since THEN 1 ELSE 0 END) AS INTEGER) AS skipped_recent
FROM transcription_jobs;

-- name: DeleteTranscriptionJobsBefore :execrows
DELETE FROM transcription_jobs WHERE status <> 'queued' AND created_at < ?;
