-- name: CreateSharedLink :one
INSERT INTO shared_links (call_id, user_id, token, created_at, expires_at)
VALUES (?, ?, ?, unixepoch(), ?)
ON CONFLICT (call_id) DO UPDATE SET call_id = call_id
RETURNING *;

-- name: GetSharedLinkByToken :one
SELECT
    sl.*,
    c.audio_path,
    c.audio_name,
    c.audio_type,
    c.date_time,
    c.frequency,
    c.duration,
    c.source,
    c.site,
    c.channel,
    c.decoder,
    s.label  AS system_label,
    t.label  AS talkgroup_label,
    t.name   AS talkgroup_name
FROM shared_links sl
JOIN calls      c ON c.id = sl.call_id
LEFT JOIN systems    s ON s.id = c.system_id
LEFT JOIN talkgroups t ON t.id = c.talkgroup_id
WHERE sl.token = ?
LIMIT 1;

-- name: GetSharedLinkByCallID :one
SELECT * FROM shared_links WHERE call_id = ? LIMIT 1;

-- name: DeleteSharedLink :exec
DELETE FROM shared_links WHERE id = ?;

-- name: DeleteSharedLinkByCallID :exec
DELETE FROM shared_links WHERE call_id = ?;

-- name: ListSharedLinks :many
SELECT
    sl.id,
    sl.call_id,
    sl.user_id,
    sl.token,
    sl.created_at,
    sl.expires_at,
    sl.opens,
    sl.last_opened_at,
    u.username   AS shared_by,
    c.date_time,
    c.duration,
    s.label      AS system_label,
    t.label      AS talkgroup_label,
    t.name       AS talkgroup_name
FROM shared_links sl
JOIN users       u ON u.id = sl.user_id
JOIN calls       c ON c.id = sl.call_id
LEFT JOIN systems    s ON s.id = c.system_id
LEFT JOIN talkgroups t ON t.id = c.talkgroup_id
ORDER BY sl.created_at DESC;

-- name: TouchSharedLinkOpened :exec
UPDATE shared_links SET opens = opens + 1, last_opened_at = :now WHERE id = :id;

-- name: RestoreSharedLink :exec
INSERT INTO shared_links (call_id, user_id, token, created_at, expires_at)
VALUES (:call_id, :user_id, :token, :created_at, :expires_at);
