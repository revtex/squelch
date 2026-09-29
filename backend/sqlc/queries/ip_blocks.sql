-- name: ListActiveIPBlocks :many
-- Every block still in force, newest first, with who added it.
SELECT b.id, b.cidr, b.reason, b.created_by, u.username AS created_by_username,
       b.created_at, b.expires_at
FROM ip_blocks b
LEFT JOIN users u ON u.id = b.created_by
WHERE b.expires_at IS NULL OR b.expires_at > sqlc.arg('now')
ORDER BY b.created_at DESC, b.id DESC;

-- name: GetIPBlock :one
SELECT * FROM ip_blocks WHERE id = ?;

-- name: CreateIPBlock :one
INSERT INTO ip_blocks (cidr, reason, created_by, created_at, expires_at)
VALUES (?, ?, ?, ?, ?)
RETURNING id;

-- name: DeleteIPBlock :exec
DELETE FROM ip_blocks WHERE id = ?;

-- name: DeleteExpiredIPBlocks :exec
DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at <= ?;
