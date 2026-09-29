-- name: GetAPIKey :one
SELECT * FROM api_keys WHERE id = ? LIMIT 1;

-- name: GetAPIKeyByKey :one
SELECT * FROM api_keys WHERE key = ? LIMIT 1;

-- name: ListAPIKeys :many
SELECT * FROM api_keys ORDER BY "order" ASC, id ASC;

-- name: CreateAPIKey :one
INSERT INTO api_keys (
    key,
    ident,
    disabled,
    systems_json,
    call_rate_limit,
    "order",
    created_at
) VALUES (
    :key,
    :ident,
    :disabled,
    :systems_json,
    :call_rate_limit,
    :order,
    :created_at
) RETURNING id;

-- name: UpdateAPIKey :exec
UPDATE api_keys SET
    key          = :key,
    ident        = :ident,
    disabled     = :disabled,
    systems_json = :systems_json,
    call_rate_limit = :call_rate_limit,
    "order"      = :order
WHERE id = :id;

-- name: DeleteAPIKey :exec
DELETE FROM api_keys WHERE id = ?;

-- name: GetAPIKeyByPreviousKey :one
SELECT * FROM api_keys
WHERE previous_key = ? AND previous_key_expires_at > ?
LIMIT 1;

-- name: TouchAPIKeyUsed :exec
UPDATE api_keys SET last_used_at = :last_used_at, last_used_ip = :last_used_ip WHERE id = :id;

-- name: RotateAPIKey :exec
UPDATE api_keys SET
    key                     = :key,
    previous_key            = :previous_key,
    previous_key_expires_at = :previous_key_expires_at
WHERE id = :id;
