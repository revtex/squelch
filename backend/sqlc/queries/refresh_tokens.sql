-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, revoked, created_at)
VALUES (?, ?, ?, ?, 0, ?);

-- name: GetRefreshTokenByHash :one
SELECT * FROM refresh_tokens WHERE token_hash = ?;

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked = 1 WHERE id = ?;

-- name: RevokeRefreshTokenFamily :exec
UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?;

-- name: RevokeAllRefreshTokensForUser :exec
UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?;

-- name: DeleteExpiredRefreshTokens :exec
-- Revoked rows are kept until they expire: they are the tombstones that let
-- a replayed, already-rotated token be detected as reuse.
DELETE FROM refresh_tokens WHERE expires_at < ?;

-- name: CountActiveRefreshTokenFamilies :one
SELECT COUNT(DISTINCT family_id) FROM refresh_tokens WHERE user_id = ? AND revoked = 0 AND expires_at > ?;

-- name: GetOldestActiveRefreshTokenFamily :one
SELECT family_id FROM refresh_tokens WHERE user_id = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at ASC LIMIT 1;
