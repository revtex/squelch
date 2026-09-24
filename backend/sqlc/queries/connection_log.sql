-- name: InsertConnectionLog :one
INSERT INTO connection_log (kind, user_id, username, ip, country_code, user_agent, native, family_id, connected_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: CloseConnectionLog :exec
UPDATE connection_log SET disconnected_at = ?, disconnect_reason = ? WHERE id = ?;

-- name: CloseOpenConnectionLogs :exec
-- At startup: rows still open were left by a process that did not shut
-- down cleanly. Their real end time is unknown.
UPDATE connection_log SET disconnected_at = ?, disconnect_reason = ? WHERE disconnected_at IS NULL;

-- name: ListConnectionLog :many
SELECT * FROM connection_log
WHERE (sqlc.narg('ip') IS NULL OR ip = sqlc.narg('ip'))
  AND (sqlc.narg('user_id') IS NULL OR user_id = sqlc.narg('user_id'))
  AND (sqlc.narg('kind') IS NULL OR kind = sqlc.narg('kind'))
  AND (sqlc.narg('since') IS NULL OR connected_at >= sqlc.narg('since'))
  AND (sqlc.narg('until') IS NULL OR connected_at < sqlc.narg('until'))
ORDER BY connected_at DESC, id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountConnectionLog :one
SELECT COUNT(*) FROM connection_log
WHERE (sqlc.narg('ip') IS NULL OR ip = sqlc.narg('ip'))
  AND (sqlc.narg('user_id') IS NULL OR user_id = sqlc.narg('user_id'))
  AND (sqlc.narg('kind') IS NULL OR kind = sqlc.narg('kind'))
  AND (sqlc.narg('since') IS NULL OR connected_at >= sqlc.narg('since'))
  AND (sqlc.narg('until') IS NULL OR connected_at < sqlc.narg('until'));

-- name: DeleteConnectionLogBefore :exec
DELETE FROM connection_log WHERE connected_at < ?;
