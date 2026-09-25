// Package ws — admin WS request router.
//
// This file is the thin transport adapter between the WebSocket admin
// protocol (ADM_REQ / ADM_RES frames) and the transport-agnostic business
// logic in internal/admin. It preserves the wire protocol byte-for-byte:
// no op renames, no payload reshaping, no new error envelopes.
//
// Live-state ops that read from the hub's in-memory state (activity stats,
// log ring buffer) still live on *Client — they need hub/logging access
// the admin package explicitly does not have.
package ws

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/revtex/squelch/internal/admin"
	"github.com/revtex/squelch/internal/logging"
)

// adminOp is the generic admin.Operations method signature. Every handler
// in adminOpHandlers returns one of these (or a thin local wrapper) so the
// router can call them uniformly.
type adminOp func(ctx context.Context, params json.RawMessage, callerID int64) (any, error)

// adminOpHandlers returns the complete map of supported admin WS operations.
// The keys are the wire-protocol op names (e.g. "users.list"); changing them
// breaks the frontend — don't.
func (c *Client) adminOpHandlers() map[string]adminOp {
	o := c.hub.admin
	return map[string]adminOp{
		// Activity & Logs — live hub state, stay on *Client.
		"activity.stats":          c.adaptClientOp(c.opActivityStats),
		"activity.chart":          c.adaptClientOp(c.opActivityChart),
		"activity.top-talkgroups": c.adaptClientOp(c.opTopTalkgroups),
		"logs.query":              c.adaptClientOp(c.opLogsQuery),
		"logs.level":              c.adaptClientOp(c.opLogsLevel),

		// Users
		"users.list":     o.UsersList,
		"users.create":   o.UsersCreate,
		"users.update":   o.UsersUpdate,
		"users.delete":   o.UsersDelete,
		"users.signout":  o.UsersSignout,
		"lockouts.list":  o.LockoutsList,
		"lockouts.clear": o.LockoutsClear,

		// Connections
		"connections.list":       o.ConnectionsList,
		"connections.history":    o.ConnectionsHistory,
		"connections.disconnect": o.ConnectionsDisconnect,
		"sessions.list":          o.SessionsList,
		"sessions.revoke":        o.SessionsRevoke,
		"ipblocks.list":          o.IPBlocksList,
		"ipblocks.create":        o.IPBlocksCreate,
		"ipblocks.delete":        o.IPBlocksDelete,

		// Systems
		"systems.list":   o.SystemsList,
		"systems.create": o.SystemsCreate,
		"systems.update": o.SystemsUpdate,
		"systems.delete": o.SystemsDelete,

		// Talkgroups
		"talkgroups.list":   o.TalkgroupsList,
		"talkgroups.create": o.TalkgroupsCreate,
		"talkgroups.update": o.TalkgroupsUpdate,
		"talkgroups.delete": o.TalkgroupsDelete,

		// Units
		"units.list":   o.UnitsList,
		"units.create": o.UnitsCreate,
		"units.update": o.UnitsUpdate,
		"units.delete": o.UnitsDelete,

		// Groups
		"groups.list":   o.GroupsList,
		"groups.create": o.GroupsCreate,
		"groups.update": o.GroupsUpdate,
		"groups.delete": o.GroupsDelete,

		// Tags
		"tags.list":   o.TagsList,
		"tags.create": o.TagsCreate,
		"tags.update": o.TagsUpdate,
		"tags.delete": o.TagsDelete,

		// API Keys
		"apikeys.list":   o.APIKeysList,
		"apikeys.create": o.APIKeysCreate,
		"apikeys.update": o.APIKeysUpdate,
		"apikeys.delete": o.APIKeysDelete,
		"apikeys.rotate": o.APIKeysRotate,

		// DirMonitors
		"dirmonitors.list":   o.DirMonitorsList,
		"dirmonitors.create": o.DirMonitorsCreate,
		"dirmonitors.update": o.DirMonitorsUpdate,
		"dirmonitors.delete": o.DirMonitorsDelete,

		// Downstreams
		"downstreams.list":   o.DownstreamsList,
		"downstreams.create": o.DownstreamsCreate,
		"downstreams.update": o.DownstreamsUpdate,
		"downstreams.delete": o.DownstreamsDelete,

		// Webhooks
		"webhooks.list":   o.WebhooksList,
		"webhooks.create": o.WebhooksCreate,
		"webhooks.update": o.WebhooksUpdate,
		"webhooks.delete": o.WebhooksDelete,

		// Shared Links
		"shared-links.list":           o.SharedLinksList,
		"shared-links.delete":         o.SharedLinksDelete,
		"shared-links.restore":        o.SharedLinksRestore,
		"shared-links.revoke-expired": o.SharedLinksRevokeExpired,

		// Config
		"config.get":    o.ConfigGet,
		"config.update": o.ConfigUpdate,

		// Filesystem
		"fs.directories": o.FSDirectories,

		// Export
		"export.config":     o.ExportConfig,
		"export.talkgroups": o.ExportTalkgroups,
		"export.units":      o.ExportUnits,
		"export.groups":     o.ExportGroups,
		"export.tags":       o.ExportTags,

		// Import
		"import.config": o.ImportConfig,

		// RadioReference
		"radioreference.apply": o.RadioReferenceApply,

		// Transcription model management
		"transcription.status":   o.TranscriptionStatus,
		"transcription.models":   o.TranscriptionModels,
		"transcription.download": o.TranscriptionDownload,
		"transcription.delete":   o.TranscriptionDelete,
		"transcription.stats":    o.TranscriptionStats,
	}
}

// clientOp is the legacy signature used by the live-state handlers in
// client.go (they don't need callerID).
type clientOp func(ctx context.Context, params json.RawMessage) (any, error)

// adaptClientOp wraps a client-scoped op into the adminOp signature by
// dropping the callerID argument. The hub's live state functions don't
// need it — they're read-only.
func (c *Client) adaptClientOp(fn clientOp) adminOp {
	return func(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
		return fn(ctx, params)
	}
}

// opLogsLevel returns the current runtime log level. Kept here (vs
// client.go) because it's a tiny admin-only query with no other natural
// home.
func (c *Client) opLogsLevel(_ context.Context, _ json.RawMessage) (any, error) {
	return map[string]string{"level": logging.GetLevel()}, nil
}

// errorString unwraps admin.UserError into the byte-identical envelope the
// old dispatcher sent: the raw message string for validation errors, and
// "internal error" for anything else.
func errorString(err error) (msg string, isUser bool) {
	var uerr admin.UserError
	if errors.As(err, &uerr) {
		return err.Error(), true
	}
	return "internal error", false
}
