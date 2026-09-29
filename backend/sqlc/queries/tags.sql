-- name: GetTag :one
SELECT * FROM tags WHERE id = ? LIMIT 1;

-- name: GetTagByLabel :one
SELECT * FROM tags WHERE label = ? LIMIT 1;

-- name: ListTags :many
SELECT * FROM tags ORDER BY label ASC;

-- name: CreateTag :one
INSERT INTO tags (label) VALUES (:label) RETURNING id;

-- name: UpdateTag :exec
UPDATE tags SET label = :label WHERE id = :id;

-- name: DeleteTag :exec
DELETE FROM tags WHERE id = ?;

-- name: ListTagsWithUsage :many
SELECT tg.id, tg.label, COUNT(t.id) AS talkgroups
FROM tags tg
LEFT JOIN talkgroups t ON t.tag_id = tg.id
GROUP BY tg.id
ORDER BY tg.label ASC;

-- name: CountTalkgroupsWithTag :one
SELECT COUNT(*) FROM talkgroups WHERE tag_id = ?;

-- name: MoveTalkgroupsToTag :exec
UPDATE talkgroups SET tag_id = sqlc.narg('to_tag') WHERE tag_id = sqlc.arg('from_tag');
