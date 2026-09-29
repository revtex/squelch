-- name: GetCallsPerHour :many
-- Returns call count per hour for the last 24 hours (24 rows, one per hour bucket).
SELECT
    (date_time / 3600) * 3600 AS hour_bucket,
    COUNT(*) AS call_count
FROM calls
WHERE date_time >= ?
GROUP BY hour_bucket
ORDER BY hour_bucket ASC;

-- name: GetActivityStats :one
-- Returns aggregate stats: today's calls, yesterday's calls up to the same
-- time of day (a fair comparison while today is still running), this
-- week's calls, total calls and when the newest call was made.
SELECT
    (SELECT COUNT(*) FROM calls c1 WHERE c1.date_time >= sqlc.arg(today_start)) AS calls_today,
    (SELECT COUNT(*) FROM calls c4 WHERE c4.date_time >= sqlc.arg(yesterday_start) AND c4.date_time < sqlc.arg(yesterday_until)) AS calls_yesterday,
    (SELECT COUNT(*) FROM calls c2 WHERE c2.date_time >= sqlc.arg(week_start)) AS calls_this_week,
    (SELECT COUNT(*) FROM calls) AS calls_total,
    CAST((SELECT COALESCE(MAX(c3.date_time), 0) FROM calls c3) AS INTEGER) AS last_call_at;

-- name: GetTopTalkgroups :many
-- Returns top N busiest talkgroups (by call count) in a time range.
SELECT
    c.talkgroup_id,
    c.system_id,
    t.talkgroup_id AS talkgroup_number,
    t.label AS talkgroup_label,
    t.name AS talkgroup_name,
    s.label AS system_label,
    COUNT(*) AS call_count
FROM calls c
LEFT JOIN talkgroups t ON t.id = c.talkgroup_id
LEFT JOIN systems s ON s.id = c.system_id
WHERE c.date_time >= ?
GROUP BY c.talkgroup_id
ORDER BY call_count DESC
LIMIT ?;
