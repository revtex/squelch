-- name: GetGroup :one
SELECT * FROM groups WHERE id = ? LIMIT 1;

-- name: GetGroupByLabel :one
SELECT * FROM groups WHERE label = ? LIMIT 1;

-- name: ListGroups :many
SELECT * FROM groups ORDER BY label ASC;

-- name: CreateGroup :one
INSERT INTO groups (label) VALUES (:label) RETURNING id;

-- name: UpdateGroup :exec
UPDATE groups SET label = :label WHERE id = :id;

-- name: DeleteGroup :exec
DELETE FROM groups WHERE id = ?;

-- name: ListGroupsWithUsage :many
SELECT g.id, g.label, COUNT(t.id) AS talkgroups
FROM groups g
LEFT JOIN talkgroups t ON t.group_id = g.id
GROUP BY g.id
ORDER BY g.label ASC;

-- name: CountTalkgroupsInGroup :one
SELECT COUNT(*) FROM talkgroups WHERE group_id = ?;

-- name: MoveTalkgroupsToGroup :exec
UPDATE talkgroups SET group_id = sqlc.narg('to_group') WHERE group_id = sqlc.arg('from_group');
