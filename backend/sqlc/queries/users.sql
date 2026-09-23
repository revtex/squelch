-- name: GetUser :one
SELECT * FROM users WHERE id = ? LIMIT 1;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = ? LIMIT 1;

-- name: ListUsers :many
SELECT * FROM users ORDER BY id ASC;

-- name: CreateUser :one
INSERT INTO users (
    username,
    password_hash,
    role,
    disabled,
    systems_json,
    expiration,
    "limit",
    password_need_change,
    created_at,
    updated_at
) VALUES (
    :username,
    :password_hash,
    :role,
    :disabled,
    :systems_json,
    :expiration,
    :limit,
    :password_need_change,
    :created_at,
    :updated_at
) RETURNING id;

-- name: UpdateUser :exec
UPDATE users SET
    username     = :username,
    role         = :role,
    disabled     = :disabled,
    systems_json = :systems_json,
    expiration   = :expiration,
    "limit"      = :limit,
    updated_at   = :updated_at
WHERE id = :id;

-- name: UpdateUserPassword :exec
UPDATE users SET
    password_hash        = :password_hash,
    password_need_change = 0,
    updated_at           = :updated_at
WHERE id = :id;

-- name: DeleteUser :exec
DELETE FROM users WHERE id = ?;

-- name: UpdateUserTGSelection :exec
UPDATE users SET
    tg_selection_json = :tg_selection_json,
    updated_at        = :updated_at
WHERE id = :id;

-- name: UpdateUserPreferences :exec
UPDATE users SET
    preferences_json = :preferences_json,
    updated_at       = :updated_at
WHERE id = :id;
