-- name: GetDownstream :one
SELECT * FROM downstreams WHERE id = ? LIMIT 1;

-- name: ListDownstreams :many
SELECT * FROM downstreams ORDER BY "order" ASC, id ASC;

-- name: ListActiveDownstreams :many
SELECT * FROM downstreams WHERE disabled = 0 ORDER BY "order" ASC, id ASC;

-- name: CreateDownstream :one
INSERT INTO downstreams (
    url,
    api_key,
    systems_json,
    disabled,
    "order",
    label
) VALUES (
    :url,
    :api_key,
    :systems_json,
    :disabled,
    :order,
    :label
) RETURNING id;

-- name: UpdateDownstream :exec
UPDATE downstreams SET
    url          = :url,
    api_key      = :api_key,
    systems_json = :systems_json,
    disabled     = :disabled,
    "order"      = :order,
    label        = :label
WHERE id = :id;

-- name: DeleteDownstream :exec
DELETE FROM downstreams WHERE id = ?;

-- name: RecordDownstreamDelivery :exec
UPDATE downstreams SET
    last_at     = sqlc.arg('at'),
    last_ok     = sqlc.arg('ok'),
    last_status = sqlc.arg('status'),
    last_error  = sqlc.arg('error'),
    last_ok_at  = CASE WHEN sqlc.arg('ok') = 1 THEN sqlc.arg('at') ELSE last_ok_at END
WHERE id = sqlc.arg('id');
