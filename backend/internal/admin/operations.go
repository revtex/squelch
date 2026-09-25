// Package admin holds the transport-agnostic CRUD / config / import-export
// business logic for Squelch's admin surface.
//
// Every method on Operations takes (ctx, params, callerID) and returns
// (any, error); callers (currently internal/ws) are responsible for
// transport framing, authentication, authorization, and error envelope.
// This package MUST NOT import internal/ws or net/http-transport packages.
package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/geoip"
	"github.com/revtex/squelch/internal/ipblock"
	"github.com/revtex/squelch/internal/middleware"
)

// ── Public helper types ──

// UserError is returned by Operations methods for validation errors that
// should be shown verbatim to the client. Callers can use errors.As to
// distinguish these from internal errors.
type UserError string

func (e UserError) Error() string { return string(e) }

// Reloader triggers a service config reload (dirmonitor, downstream).
type Reloader interface {
	Reload()
}

// TranscriberReloader can hot-reload the transcription subsystem, report
// on it, and take a call again on request.
type TranscriberReloader interface {
	Reload(enabled bool, baseURL, model, language string, diarize bool) bool
	Enabled() bool
	BaseURL() string
	Model() string
	QueueDepth() int
	Workers() int
	MinDurationMs() int64
	SetMinDurationMs(ms int64)
	Retry(ctx context.Context, callID int64, audioPath string) error
}

// EventSink is the interface Operations uses to push admin events and
// broadcast config refreshes without importing the WebSocket package. The
// WS hub implements all three methods today, so the interface is satisfied
// automatically; tests can provide a no-op implementation.
type EventSink interface {
	BroadcastAdminEvent(topic string, data any)
	BroadcastCFG(ctx context.Context)
	DisconnectByUser(userID int64)
	ClientCount() int
}

// Deps are the optional dependencies used by admin operations. Any field
// left zero disables the corresponding feature path at runtime (matches
// the prior ws.HubDeps behaviour exactly).
type Deps struct {
	SQLDB             *sql.DB
	DirMonitorReload  Reloader
	DownstreamReload  Reloader
	TranscriberReload TranscriberReloader
	FFmpegAvailable   bool
	FDKAACAvailable   bool
	WhisperAvailable  bool
	RecordingsDir     string
	// DBFile is the SQLite database path, for the storage figures.
	DBFile        string
	EncryptionKey string
	// Connections is the live connection registry; nil leaves the
	// connection list empty.
	Connections *connections.Registry
	// IPBlocks is the address block list; nil turns blocking off.
	IPBlocks *ipblock.Matcher
	// GeoIP resolves addresses to countries; nil hides the country column.
	GeoIP *geoip.DB
	// LoginLimiter is the sign-in rate limiter; nil leaves the lockout
	// list empty.
	LoginLimiter *auth.RateLimiter
	// LegacyUsage counts requests on the deprecated /api/* surface; nil
	// reports none.
	LegacyUsage *middleware.LegacyUsageStore
	// Downstreams and Webhooks are the forwarding services, for delivery
	// state and tests; nil reports nothing and refuses tests.
	Downstreams Forwarder
	Webhooks    Forwarder
	// DirMonitors reports what each folder monitor is doing; nil reports
	// nothing.
	DirMonitors MonitorStatus
	// MaskTester parses a filename with a mask, for the admin's mask
	// tester; nil refuses the test.
	MaskTester func(mask, filename string) (map[string]string, bool)
}

// Operations owns the admin CRUD business logic. It is transport-agnostic —
// callers wrap its methods in whatever RPC / WS / HTTP envelope they use.
type Operations struct {
	Queries *db.Queries
	Deps    Deps
	Events  EventSink

	// StartTime is used by activity-stats and uptime calculations. It
	// defaults to time.Now() on New() but can be overridden for tests.
	StartTime time.Time

	// storage caches the recordings measurement between Settings loads.
	storage storageCache
}

// New constructs a new Operations bound to the given queries, deps, and
// event sink. The event sink may be nil for test fixtures that don't
// exercise broadcast-triggering paths.
func New(queries *db.Queries, deps Deps, events EventSink) *Operations {
	return &Operations{
		Queries:   queries,
		Deps:      deps,
		Events:    events,
		StartTime: time.Now(),
	}
}

// SetWhisperAvailable updates the cached ffmpeg/whisper capability after a
// transcription hot-reload. Kept for the config-update and import flows
// that mutate the live pool state.
func (o *Operations) SetWhisperAvailable(v bool) { o.Deps.WhisperAvailable = v }

// broadcastAdminEvent is a nil-safe wrapper around Events.BroadcastAdminEvent.
func (o *Operations) broadcastAdminEvent(topic string, data any) {
	if o.Events != nil {
		o.Events.BroadcastAdminEvent(topic, data)
	}
}

// broadcastCFG is a nil-safe wrapper around Events.BroadcastCFG.
func (o *Operations) broadcastCFG(ctx context.Context) {
	if o.Events != nil {
		o.Events.BroadcastCFG(ctx)
	}
}

// anonymousDisconnecter is implemented by sinks that can drop
// unauthenticated listeners (the WS hub). It is optional so test sinks need
// not implement it.
type anonymousDisconnecter interface {
	DisconnectAnonymous()
}

// enforcePublicAccess drops anonymous listeners unless publicAccess is
// currently "true". Call it after any write that may have changed the
// setting.
func (o *Operations) enforcePublicAccess(ctx context.Context) {
	d, ok := o.Events.(anonymousDisconnecter)
	if !ok {
		return
	}
	s, err := o.Queries.GetSetting(ctx, "publicAccess")
	if err == nil && s.Value == "true" {
		return
	}
	d.DisconnectAnonymous()
}

// disconnectByUser is a nil-safe wrapper around Events.DisconnectByUser.
func (o *Operations) disconnectByUser(userID int64) {
	if o.Events != nil {
		o.Events.DisconnectByUser(userID)
	}
}

// ── Helpers ──

func ptrToNullStr(p *string) sql.NullString {
	if p == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *p, Valid: true}
}

func ptrToNullInt(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func nullStr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	return &n.String
}

func nullInt(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	return &n.Int64
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE")
}

func validHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

// remapSystemsJSON rewrites the system PKs embedded in a systems_json column
// (used by api_keys, downstreams, webhooks, and users) so that grants
// referring to a system by its old PK end up referring to the freshly
// inserted row's PK after import. Accepts and returns a *string mirroring
// the export shape (nil = "all systems"). Any system PK that doesn't appear
// in the remap is dropped from the grant rather than silently broken.
//
// Shape: `[{"id": <int64>, "talkgroups": [<int64>...]}]` per
// auth.SystemGrant.
func remapSystemsJSON(in *string, systemRemap map[int64]int64) *string {
	if in == nil || strings.TrimSpace(*in) == "" {
		return in
	}
	var grants []auth.SystemGrant
	if err := json.Unmarshal([]byte(*in), &grants); err != nil {
		// Fall through with nil grants — try the legacy flat-id form.
		var ids []int64
		if jerr := json.Unmarshal([]byte(*in), &ids); jerr != nil {
			slog.Warn("import config: systems_json not recognised; preserving as-is",
				"error", err)
			return in
		}
		mapped := make([]int64, 0, len(ids))
		for _, id := range ids {
			if newID, ok := systemRemap[id]; ok {
				mapped = append(mapped, newID)
			} else {
				slog.Warn("import config: dropping unknown system grant", "system_pk", id)
			}
		}
		out, _ := json.Marshal(mapped)
		s := string(out)
		return &s
	}
	mapped := make([]auth.SystemGrant, 0, len(grants))
	for _, g := range grants {
		newID, ok := systemRemap[g.ID]
		if !ok {
			slog.Warn("import config: dropping unknown system grant", "system_pk", g.ID)
			continue
		}
		mapped = append(mapped, auth.SystemGrant{ID: newID, Talkgroups: g.Talkgroups})
	}
	out, _ := json.Marshal(mapped)
	s := string(out)
	return &s
}

// validRoles is the set of allowed user roles.
var validRoles = map[string]bool{
	auth.RoleAdmin:    true,
	auth.RoleListener: true,
}

// SensitiveSettingKeys are settings whose values are encrypted at rest.
// Exported because cmd/server/main.go consults it during secret migration.
var SensitiveSettingKeys = map[string]bool{
	"vapidPrivateKey": true,
	"jwtSecret":       true,
}

// serverOnlySettingKeys are settings the server reads but never hands to a
// client, not even an admin: the JWT signing key would let its holder mint
// tokens for any user, and it outlives the admin's own revocation.
var serverOnlySettingKeys = map[string]bool{
	auth.JWTSecretKeyName: true,
}

// allowedSettingKeys mirrors the allowed setting keys from config.go.
var allowedSettingKeys = map[string]bool{
	"apiKeyCallRate":              true,
	"auditRetentionDays":          true,
	"audioConversion":             true,
	"audioEncodingPreset":         true,
	"autoPopulateSystems":         true,
	"branding":                    true,
	"disableDuplicateDetection":   true,
	"duplicateDetectionTimeFrame": true,
	"email":                       true,
	"keypadBeeps":                 true,
	"logLevel":                    true,
	"loginMaxFailures":            true,
	"loginLockoutMinutes":         true,
	"connectionHistoryDays":       true,
	"maxClients":                  true,
	"pruneDays":                   true,
	"publicAccess":                true,
	"shareableLinks":              true,
	"sharedLinkExpiry":            true,
	"showListenersCount":          true,
	"time12hFormat":               true,
	"transcriptionDiarize":        true,
	"transcriptionEnabled":        true,
	"transcriptionMinDurationMs":  true,
	"transcriptionLanguage":       true,
	"liveTranscriptDisplay":       true,
	"transcriptionModel":          true,
	"transcriptionUrl":            true,
	"trMqttEnabled":               true,
	"vapidPrivateKey":             true,
	"vapidPublicKey":              true,
}

// AllowedSettingKeys reports whether a settings key is allowed to be mutated
// via the admin API. Exposed for tests.
func AllowedSettingKeys(key string) bool { return allowedSettingKeys[key] }

// hiddenTopLevelDirs for FS browsing.
var hiddenTopLevelDirs = map[string]bool{
	"bin": true, "boot": true, "dev": true, "lib": true,
	"lib32": true, "lib64": true, "libx32": true,
	"proc": true, "run": true, "sbin": true, "sys": true,
	"usr": true, "etc": true, "snap": true, "lost+found": true,
}

// ── Response mappers (exported for tests / transport layers) ──

func mapUser(u db.User) map[string]any {
	return map[string]any{
		"id":          u.ID,
		"username":    u.Username,
		"role":        u.Role,
		"disabled":    u.Disabled,
		"systemsJson": nullStr(u.SystemsJson),
		"expiration":  nullInt(u.Expiration),
		"limit":       nullInt(u.Limit),
		"createdAt":   u.CreatedAt,
		"updatedAt":   u.UpdatedAt,
		// The user has a temporary password and must pick their own at
		// the next sign-in.
		"passwordNeedChange": u.PasswordNeedChange,
	}
}

func mapUsers(users []db.User) []map[string]any {
	out := make([]map[string]any, len(users))
	for i, u := range users {
		out[i] = mapUser(u)
	}
	return out
}

func mapSystem(s db.System) map[string]any {
	return map[string]any{
		"id":                     s.ID,
		"systemId":               s.SystemID,
		"label":                  s.Label,
		"autoPopulateTalkgroups": s.AutoPopulateTalkgroups,
		"blacklistsJson":         nullStr(s.BlacklistsJson),
		"led":                    nullStr(s.Led),
		"order":                  s.Order,
	}
}

func mapSystems(systems []db.System) []map[string]any {
	out := make([]map[string]any, len(systems))
	for i, s := range systems {
		out[i] = mapSystem(s)
	}
	return out
}

func mapTalkgroup(t db.Talkgroup) map[string]any {
	return map[string]any{
		"id":          t.ID,
		"systemId":    t.SystemID,
		"talkgroupId": t.TalkgroupID,
		"label":       nullStr(t.Label),
		"name":        nullStr(t.Name),
		"frequency":   nullInt(t.Frequency),
		"led":         nullStr(t.Led),
		"groupId":     nullInt(t.GroupID),
		"tagId":       nullInt(t.TagID),
		"order":       t.Order,
	}
}

func mapTalkgroups(tgs []db.Talkgroup) []map[string]any {
	out := make([]map[string]any, len(tgs))
	for i, t := range tgs {
		out[i] = mapTalkgroup(t)
	}
	return out
}

func mapUnit(u db.Unit) map[string]any {
	return map[string]any{
		"id":       u.ID,
		"systemId": u.SystemID,
		"unitId":   u.UnitID,
		"label":    nullStr(u.Label),
		"order":    u.Order,
	}
}

func mapUnits(units []db.Unit) []map[string]any {
	out := make([]map[string]any, len(units))
	for i, u := range units {
		out[i] = mapUnit(u)
	}
	return out
}

// apiKeyFingerprint is a short, stable handle for a key that never reveals
// the secret: the first 12 hex characters of the hash of the stored hash.
func apiKeyFingerprint(k db.ApiKey) string {
	fingerprint := auth.HashAPIKey(k.Key)
	if len(fingerprint) > 12 {
		fingerprint = fingerprint[:12]
	}
	return fingerprint
}

func mapAPIKey(k db.ApiKey) map[string]any {
	var rotating *int64
	if k.PreviousKeyExpiresAt.Valid && k.PreviousKeyExpiresAt.Int64 > time.Now().Unix() {
		v := k.PreviousKeyExpiresAt.Int64
		rotating = &v
	}
	return map[string]any{
		"id":                   k.ID,
		"fingerprint":          apiKeyFingerprint(k),
		"ident":                nullStr(k.Ident),
		"disabled":             k.Disabled,
		"systemsJson":          nullStr(k.SystemsJson),
		"callRateLimit":        nullInt(k.CallRateLimit),
		"order":                k.Order,
		"createdAt":            k.CreatedAt,
		"lastUsedAt":           nullInt(k.LastUsedAt),
		"lastUsedIp":           nullStr(k.LastUsedIp),
		"previousKeyExpiresAt": rotating,
	}
}

func mapAPIKeys(keys []db.ApiKey) []map[string]any {
	out := make([]map[string]any, len(keys))
	for i, k := range keys {
		out[i] = mapAPIKey(k)
	}
	return out
}

func mapDirMonitor(d db.Dirmonitor) map[string]any {
	return map[string]any{
		"id":          d.ID,
		"directory":   d.Directory,
		"type":        d.Type,
		"mask":        nullStr(d.Mask),
		"extension":   nullStr(d.Extension),
		"frequency":   nullInt(d.Frequency),
		"delay":       nullInt(d.Delay),
		"deleteAfter": d.DeleteAfter,
		"usePolling":  d.UsePolling,
		"disabled":    d.Disabled,
		"systemId":    nullInt(d.SystemID),
		"talkgroupId": nullInt(d.TalkgroupID),
		"order":       d.Order,
	}
}

func mapDirMonitors(dms []db.Dirmonitor) []map[string]any {
	out := make([]map[string]any, len(dms))
	for i, d := range dms {
		out[i] = mapDirMonitor(d)
	}
	return out
}

// sqlNullInt is a short name for the nullable integer columns the mappers read.
type sqlNullInt = sql.NullInt64

func mapDownstream(d db.Downstream) map[string]any {
	return map[string]any{
		"id":          d.ID,
		"label":       d.Label,
		"url":         d.Url,
		"hasApiKey":   d.ApiKey != "",
		"systemsJson": nullStr(d.SystemsJson),
		"disabled":    d.Disabled,
		"order":       d.Order,
	}
}

func mapDownstreams(ds []db.Downstream) []map[string]any {
	out := make([]map[string]any, len(ds))
	for i, d := range ds {
		out[i] = mapDownstream(d)
	}
	return out
}

func mapWebhook(w db.Webhook) map[string]any {
	return map[string]any{
		"id":          w.ID,
		"label":       w.Label,
		"url":         w.Url,
		"type":        w.Type,
		"hasSecret":   w.Secret.Valid && w.Secret.String != "",
		"systemsJson": nullStr(w.SystemsJson),
		"disabled":    w.Disabled,
		"order":       w.Order,
	}
}

func mapWebhooks(ws []db.Webhook) []map[string]any {
	out := make([]map[string]any, len(ws))
	for i, w := range ws {
		out[i] = mapWebhook(w)
	}
	return out
}

func mapSharedLink(r db.ListSharedLinksRow) map[string]any {
	m := map[string]any{
		"id":             r.ID,
		"callId":         r.CallID,
		"userId":         r.UserID,
		"token":          r.Token,
		"createdAt":      r.CreatedAt,
		"opens":          r.Opens,
		"lastOpenedAt":   nullInt(r.LastOpenedAt),
		"sharedBy":       r.SharedBy,
		"dateTime":       r.DateTime,
		"duration":       r.Duration.Int64,
		"systemLabel":    r.SystemLabel.String,
		"talkgroupLabel": r.TalkgroupLabel.String,
		"talkgroupName":  r.TalkgroupName.String,
	}
	if r.ExpiresAt.Valid {
		m["expiresAt"] = r.ExpiresAt.Int64
	} else {
		m["expiresAt"] = nil
	}
	return m
}
