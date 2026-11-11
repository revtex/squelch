-- name: GetKeywordRule :one
SELECT * FROM keyword_rules WHERE id = ? LIMIT 1;

-- name: ListKeywordRules :many
SELECT * FROM keyword_rules ORDER BY "order" ASC, id ASC;

-- name: ListActiveKeywordRules :many
SELECT * FROM keyword_rules WHERE disabled = 0 ORDER BY "order" ASC, id ASC;

-- name: CreateKeywordRule :one
INSERT INTO keyword_rules (
    label,
    patterns_json,
    systems_json,
    talkgroups_json,
    cooldown_sec,
    disabled,
    "order",
    created_at
) VALUES (
    :label,
    :patterns_json,
    :systems_json,
    :talkgroups_json,
    :cooldown_sec,
    :disabled,
    :order,
    :created_at
) RETURNING id;

-- name: UpdateKeywordRule :exec
UPDATE keyword_rules SET
    label           = :label,
    patterns_json   = :patterns_json,
    systems_json    = :systems_json,
    talkgroups_json = :talkgroups_json,
    cooldown_sec    = :cooldown_sec,
    disabled        = :disabled,
    "order"         = :order
WHERE id = :id;

-- name: DeleteKeywordRule :exec
DELETE FROM keyword_rules WHERE id = ?;

-- name: GetKeywordTarget :one
SELECT * FROM keyword_targets WHERE id = ? LIMIT 1;

-- name: ListKeywordTargets :many
SELECT * FROM keyword_targets ORDER BY "order" ASC, id ASC;

-- name: ListActiveKeywordTargets :many
SELECT * FROM keyword_targets WHERE disabled = 0 ORDER BY "order" ASC, id ASC;

-- name: CreateKeywordTarget :one
INSERT INTO keyword_targets (
    label,
    type,
    url,
    secret,
    rules_json,
    disabled,
    "order"
) VALUES (
    :label,
    :type,
    :url,
    :secret,
    :rules_json,
    :disabled,
    :order
) RETURNING id;

-- name: UpdateKeywordTarget :exec
UPDATE keyword_targets SET
    label      = :label,
    type       = :type,
    url        = :url,
    secret     = :secret,
    rules_json = :rules_json,
    disabled   = :disabled,
    "order"    = :order
WHERE id = :id;

-- name: DeleteKeywordTarget :exec
DELETE FROM keyword_targets WHERE id = ?;

-- name: RecordKeywordTargetDelivery :exec
UPDATE keyword_targets SET
    last_at     = sqlc.arg('at'),
    last_ok     = sqlc.arg('ok'),
    last_status = sqlc.arg('status'),
    last_error  = sqlc.arg('error'),
    last_ok_at  = CASE WHEN sqlc.arg('ok') = 1 THEN sqlc.arg('at') ELSE last_ok_at END
WHERE id = sqlc.arg('id');
