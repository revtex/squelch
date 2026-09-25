-- name: CreateLog :exec
INSERT INTO logs (date_time, level, message)
VALUES (:date_time, :level, :message);

-- name: ListLogs :many
-- level_pattern and query_pattern are LIKE patterns; "%" matches anything.
SELECT id, date_time, level, message FROM logs
WHERE date_time >= @from_time AND date_time <= @to_time
  AND level LIKE @level_pattern
  AND message LIKE @query_pattern
ORDER BY date_time DESC, id DESC
LIMIT @row_limit;

-- name: CountLogsSince :one
SELECT COUNT(*) FROM logs WHERE date_time >= @since;

-- name: DeleteLogsBefore :execrows
DELETE FROM logs WHERE date_time < @before;
