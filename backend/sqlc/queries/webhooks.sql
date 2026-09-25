-- name: GetWebhook :one
SELECT * FROM webhooks WHERE id = ? LIMIT 1;

-- name: ListWebhooks :many
SELECT * FROM webhooks ORDER BY "order" ASC, id ASC;

-- name: ListActiveWebhooks :many
SELECT * FROM webhooks WHERE disabled = 0 ORDER BY "order" ASC, id ASC;

-- name: CreateWebhook :one
INSERT INTO webhooks (
    url,
    type,
    secret,
    systems_json,
    disabled,
    "order",
    label
) VALUES (
    :url,
    :type,
    :secret,
    :systems_json,
    :disabled,
    :order,
    :label
) RETURNING id;

-- name: UpdateWebhook :exec
UPDATE webhooks SET
    url          = :url,
    type         = :type,
    secret       = :secret,
    systems_json = :systems_json,
    disabled     = :disabled,
    "order"      = :order,
    label        = :label
WHERE id = :id;

-- name: DeleteWebhook :exec
DELETE FROM webhooks WHERE id = ?;

-- name: RecordWebhookDelivery :exec
UPDATE webhooks SET
    last_at     = sqlc.arg('at'),
    last_ok     = sqlc.arg('ok'),
    last_status = sqlc.arg('status'),
    last_error  = sqlc.arg('error'),
    last_ok_at  = CASE WHEN sqlc.arg('ok') = 1 THEN sqlc.arg('at') ELSE last_ok_at END
WHERE id = sqlc.arg('id');
