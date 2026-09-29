-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, revoked, created_at, ip, user_agent, native, signed_in_at)
VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?);

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

-- name: IsNativeRefreshFamily :one
-- Whether the device session is the Squelch app. Backed by
-- idx_refresh_tokens_family_id.
SELECT CAST(COALESCE(MAX(native), 0) AS INTEGER) AS native FROM refresh_tokens WHERE family_id = ?;

-- name: ListActiveSessions :many
-- One row per signed-in device: the newest unrevoked, unexpired token of
-- each family. user_id NULL lists every account.
SELECT rt.family_id, rt.user_id, u.username, u.role,
       rt.ip, rt.user_agent, rt.native, rt.signed_in_at,
       rt.created_at AS last_used_at, rt.expires_at
FROM refresh_tokens rt
JOIN users u ON u.id = rt.user_id
WHERE rt.revoked = 0
  AND rt.expires_at > sqlc.arg('now')
  AND (sqlc.narg('user_id') IS NULL OR rt.user_id = sqlc.narg('user_id'))
  AND rt.id = (SELECT MAX(r2.id) FROM refresh_tokens r2 WHERE r2.family_id = rt.family_id)
ORDER BY rt.created_at DESC;

-- name: GetActiveSessionOwner :one
-- The account a signed-in device belongs to, if the device can still mint
-- an access token. Backed by idx_refresh_tokens_family_id.
SELECT rt.user_id, u.username
FROM refresh_tokens rt
JOIN users u ON u.id = rt.user_id
WHERE rt.family_id = sqlc.arg('family_id')
  AND rt.revoked = 0
  AND rt.expires_at > sqlc.arg('now')
ORDER BY rt.id DESC
LIMIT 1;

-- name: ListUserSessionStats :many
-- One row per account that has ever signed in (within the token retention
-- window): where it was last seen, when, and how many devices can still
-- sign back in. Backed by idx_refresh_tokens_user_id.
SELECT rt.user_id,
       rt.ip           AS last_seen_ip,
       rt.created_at   AS last_seen_at,
       (SELECT COUNT(DISTINCT r3.family_id) FROM refresh_tokens r3
         WHERE r3.user_id = rt.user_id AND r3.revoked = 0 AND r3.expires_at > sqlc.arg('now')) AS devices
FROM refresh_tokens rt
WHERE rt.id = (SELECT MAX(r2.id) FROM refresh_tokens r2 WHERE r2.user_id = rt.user_id);
