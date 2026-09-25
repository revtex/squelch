-- name: GetCall :one
SELECT
    c.*,
    s.label  AS system_label,
    t.label  AS talkgroup_label,
    t.name   AS talkgroup_name
FROM calls c
LEFT JOIN systems    s ON s.id = c.system_id
LEFT JOIN talkgroups t ON t.id = c.talkgroup_id
WHERE c.id = ?
LIMIT 1;

-- name: ListCalls :many
SELECT c.*
FROM calls c
LEFT JOIN talkgroups tg ON tg.id = c.talkgroup_id
LEFT JOIN transcriptions tr ON tr.call_id = c.id
WHERE
    (sqlc.narg('system_ids_csv') IS NULL OR instr(',' || sqlc.narg('system_ids_csv') || ',', ',' || c.system_id || ',') > 0)
    AND (sqlc.narg('talkgroup_ids_csv') IS NULL OR instr(',' || sqlc.narg('talkgroup_ids_csv') || ',', ',' || c.talkgroup_id || ',') > 0)
    AND (sqlc.narg('group_ids_csv') IS NULL OR instr(',' || sqlc.narg('group_ids_csv') || ',', ',' || tg.group_id || ',') > 0)
    AND (sqlc.narg('tag_ids_csv') IS NULL OR instr(',' || sqlc.narg('tag_ids_csv') || ',', ',' || tg.tag_id || ',') > 0)
    AND (sqlc.narg('date_from')    IS NULL OR c.date_time    >= sqlc.narg('date_from'))
    AND (sqlc.narg('date_to')      IS NULL OR c.date_time    <= sqlc.narg('date_to'))
    AND (sqlc.narg('bookmark_user_id') IS NULL OR EXISTS (
        SELECT 1 FROM bookmarks b WHERE b.call_id = c.id AND b.user_id = sqlc.narg('bookmark_user_id')
    ))
    AND (sqlc.narg('transcript')   IS NULL OR tr.text LIKE '%' || sqlc.narg('transcript') || '%')
ORDER BY c.date_time DESC
LIMIT  sqlc.narg('page_size')
OFFSET sqlc.narg('page_offset');

-- name: ListCallsAsc :many
SELECT c.*
FROM calls c
LEFT JOIN talkgroups tg ON tg.id = c.talkgroup_id
LEFT JOIN transcriptions tr ON tr.call_id = c.id
WHERE
    (sqlc.narg('system_ids_csv') IS NULL OR instr(',' || sqlc.narg('system_ids_csv') || ',', ',' || c.system_id || ',') > 0)
    AND (sqlc.narg('talkgroup_ids_csv') IS NULL OR instr(',' || sqlc.narg('talkgroup_ids_csv') || ',', ',' || c.talkgroup_id || ',') > 0)
    AND (sqlc.narg('group_ids_csv') IS NULL OR instr(',' || sqlc.narg('group_ids_csv') || ',', ',' || tg.group_id || ',') > 0)
    AND (sqlc.narg('tag_ids_csv') IS NULL OR instr(',' || sqlc.narg('tag_ids_csv') || ',', ',' || tg.tag_id || ',') > 0)
    AND (sqlc.narg('date_from')    IS NULL OR c.date_time    >= sqlc.narg('date_from'))
    AND (sqlc.narg('date_to')      IS NULL OR c.date_time    <= sqlc.narg('date_to'))
    AND (sqlc.narg('bookmark_user_id') IS NULL OR EXISTS (
        SELECT 1 FROM bookmarks b WHERE b.call_id = c.id AND b.user_id = sqlc.narg('bookmark_user_id')
    ))
    AND (sqlc.narg('transcript')   IS NULL OR tr.text LIKE '%' || sqlc.narg('transcript') || '%')
ORDER BY c.date_time ASC
LIMIT  sqlc.narg('page_size')
OFFSET sqlc.narg('page_offset');

-- name: CountCallsFiltered :one
SELECT COUNT(*)
FROM calls c
LEFT JOIN talkgroups tg ON tg.id = c.talkgroup_id
LEFT JOIN transcriptions tr ON tr.call_id = c.id
WHERE
    (sqlc.narg('system_ids_csv') IS NULL OR instr(',' || sqlc.narg('system_ids_csv') || ',', ',' || c.system_id || ',') > 0)
    AND (sqlc.narg('talkgroup_ids_csv') IS NULL OR instr(',' || sqlc.narg('talkgroup_ids_csv') || ',', ',' || c.talkgroup_id || ',') > 0)
    AND (sqlc.narg('group_ids_csv') IS NULL OR instr(',' || sqlc.narg('group_ids_csv') || ',', ',' || tg.group_id || ',') > 0)
    AND (sqlc.narg('tag_ids_csv') IS NULL OR instr(',' || sqlc.narg('tag_ids_csv') || ',', ',' || tg.tag_id || ',') > 0)
    AND (sqlc.narg('date_from')    IS NULL OR c.date_time    >= sqlc.narg('date_from'))
    AND (sqlc.narg('date_to')      IS NULL OR c.date_time    <= sqlc.narg('date_to'))
    AND (sqlc.narg('bookmark_user_id') IS NULL OR EXISTS (
        SELECT 1 FROM bookmarks b WHERE b.call_id = c.id AND b.user_id = sqlc.narg('bookmark_user_id')
    ))
    AND (sqlc.narg('transcript')   IS NULL OR tr.text LIKE '%' || sqlc.narg('transcript') || '%');

-- name: CreateCall :one
INSERT INTO calls (
    audio_path,
    audio_name,
    audio_type,
    date_time,
    frequency,
    duration,
    source,
    sources_json,
    frequencies_json,
    patches_json,
    system_id,
    talkgroup_id,
    site,
    channel,
    decoder,
    error_count,
    spike_count,
    talker_alias,
    api_key_id
) VALUES (
    :audio_path,
    :audio_name,
    :audio_type,
    :date_time,
    :frequency,
    :duration,
    :source,
    :sources_json,
    :frequencies_json,
    :patches_json,
    :system_id,
    :talkgroup_id,
    :site,
    :channel,
    :decoder,
    :error_count,
    :spike_count,
    :talker_alias,
    :api_key_id
) RETURNING id;

-- name: CountCalls :one
SELECT COUNT(*) FROM calls;

-- name: HasCallInTimeRange :one
SELECT EXISTS(
    SELECT 1
    FROM calls c
    WHERE c.system_id = ? AND c.talkgroup_id = ?
      AND c.date_time >= ? AND c.date_time <= ?
);

-- name: HasCallAtTimestamp :one
SELECT EXISTS(
    SELECT 1
    FROM calls c
    WHERE c.system_id = ? AND c.talkgroup_id = ? AND c.date_time = ?
);

-- name: GetCallIDsOlderThan :many
SELECT c.id, c.audio_path
FROM calls c
LEFT JOIN bookmarks b ON b.call_id = c.id
LEFT JOIN shared_links sl ON sl.call_id = c.id
WHERE c.date_time < ? AND b.id IS NULL AND sl.id IS NULL
ORDER BY c.date_time ASC
LIMIT 500;

-- name: DeleteCallBatch :exec
DELETE FROM calls WHERE id = ?;

-- name: CountCallsPerAPIKeySince :many
SELECT api_key_id, COUNT(*) AS calls
FROM calls
WHERE api_key_id IS NOT NULL AND date_time >= ?
GROUP BY api_key_id;

-- name: OldestCallTime :one
SELECT CAST(COALESCE(MIN(date_time), 0) AS INTEGER) AS oldest FROM calls;
