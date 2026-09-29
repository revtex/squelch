// Package stream exposes the continuous listener audio stream over HTTP.
//
// The transport is deliberately dumb — a never-ending chunked response of
// MPEG frames — because that is what a plain <audio> element can consume
// on every platform, including iOS with the screen locked. All of the
// interesting behaviour (pacing, per-listener filtering, backlog trimming)
// lives in internal/stream.
package stream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/shared"
	streamsvc "github.com/revtex/squelch/internal/stream"
)

// maxSidLen caps the client-supplied stream id. It is only ever echoed
// back to the same user's own WebSocket, but it is client input, so it is
// bounded.
const maxSidLen = 64

// Handler serves the listener audio stream.
type Handler struct {
	mgr     *streamsvc.Manager
	queries *db.Queries
}

// New builds the HTTP handler around an already-started Manager.
func New(mgr *streamsvc.Manager, queries *db.Queries) *Handler {
	return &Handler{mgr: mgr, queries: queries}
}

// NewManager wires a stream Manager to the database and the recordings
// directory. Start must still be called before it will serve.
func NewManager(queries *db.Queries, recordingsDir string) *streamsvc.Manager {
	return streamsvc.New(callSource(queries, recordingsDir), userFilter(queries))
}

// callSource resolves a call id to an on-disk path, refusing anything that
// would escape the recordings directory. The path is handed to FFmpeg, so
// unlike the per-call audio endpoint it cannot be opened through os.Root —
// the containment check has to be explicit.
func callSource(queries *db.Queries, recordingsDir string) streamsvc.CallSource {
	root := filepath.Clean(recordingsDir)
	return func(ctx context.Context, id int64) (streamsvc.Call, error) {
		call, err := queries.GetCall(ctx, id)
		if err != nil {
			return streamsvc.Call{}, err
		}

		rel := filepath.Clean(call.AudioPath)
		if rel == "." || filepath.IsAbs(rel) || strings.HasPrefix(rel, "..") {
			return streamsvc.Call{}, fmt.Errorf("stream: unsafe audio path for call %d", id)
		}
		full := filepath.Join(root, rel)
		if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
			return streamsvc.Call{}, fmt.Errorf("stream: audio path escapes recordings dir for call %d", id)
		}

		return streamsvc.Call{
			ID:          id,
			SystemID:    call.SystemID,
			TalkgroupID: call.TalkgroupID.Int64,
			AudioPath:   full,
		}, nil
	}
}

// storedSelection mirrors the shape persisted by the talkgroup-selection
// endpoint. Kept local rather than shared so the stream never writes it.
type storedSelection struct {
	DisabledTGs []int64 `json:"disabledTGs"`
	AvoidList   []struct {
		TalkgroupID int64 `json:"talkgroupId"`
		// Milliseconds since the epoch, matching the browser's Date.now().
		// Zero means the avoid does not expire.
		ExpiresAt int64 `json:"expiresAt"`
	} `json:"avoidList"`
}

// accountActive reports whether a user may still receive call audio: not
// disabled and not past their account expiration.
func accountActive(user db.User, now time.Time) bool {
	if user.Disabled != 0 {
		return false
	}
	return !user.Expiration.Valid || user.Expiration.Int64 <= 0 || now.Unix() <= user.Expiration.Int64
}

// userFilter reproduces the client-side play rules on the server, because a
// streaming listener has no client to apply them: system/talkgroup grants,
// the saved talkgroup selection, and active AVOID entries.
//
// HOLD is deliberately absent — it is transient UI state that is never
// persisted, so the stream cannot see it.
func userFilter(queries *db.Queries) streamsvc.Filter {
	return func(ctx context.Context, userID int64, call streamsvc.Call) bool {
		user, err := queries.GetUser(ctx, userID)
		if err != nil {
			slog.Warn("stream: filter could not load user", "user_id", userID, "error", err)
			return false
		}

		// The stream outlives the request that authenticated it, so account
		// state is re-checked for every call rather than only at connect.
		if !accountActive(user, time.Now()) {
			return false
		}

		if !auth.HasSystemAccess(auth.ParseSystemGrants(user.SystemsJson), call.SystemID, call.TalkgroupID) {
			return false
		}

		if !user.TgSelectionJson.Valid || user.TgSelectionJson.String == "" {
			return true
		}
		var sel storedSelection
		if err := json.Unmarshal([]byte(user.TgSelectionJson.String), &sel); err != nil {
			// A selection we cannot read must not silently mute the stream.
			slog.Warn("stream: unreadable talkgroup selection", "user_id", userID, "error", err)
			return true
		}

		for _, id := range sel.DisabledTGs {
			if id == call.TalkgroupID {
				return false
			}
		}
		now := time.Now().UnixMilli()
		for _, a := range sel.AvoidList {
			if a.TalkgroupID == call.TalkgroupID && (a.ExpiresAt == 0 || a.ExpiresAt > now) {
				return false
			}
		}
		return true
	}
}

// GetStream handles GET /api/v1/listener/stream.
//
//	@Summary		Continuous listener audio stream
//	@Description	Never-ending audio stream of the caller's selected talkgroups, silence-padded between calls. Intended for background playback on platforms that suspend a page once audio stops — notably iOS with the screen locked. Applies the caller's saved talkgroup selection, AVOID entries and system grants server-side.
//	@Tags			v1-Listener
//	@Security		BearerAuth
//	@Param			sid	query	string	false	"Opaque per-connection id (max 64 chars). Echoed in stream.cue WebSocket events so a client can tell its own stream's cues from those of its other tabs."
//	@Produce		audio/mpeg
//	@Success		200	{file}		binary					"Continuous MPEG audio stream"
//	@Failure		401	{object}	shared.APIErrorResponse	"Authentication required"
//	@Failure		503	{object}	shared.APIErrorResponse	"Streaming unavailable (encoder missing)"
//	@Router			/v1/listener/stream [get]
func (h *Handler) GetStream(c *gin.Context) {
	userIDVal, ok := c.Get("userID")
	if !ok {
		shared.WriteAPIError(c, http.StatusUnauthorized, shared.CodeInvalidCredentials,
			"authentication required", nil)
		return
	}
	userID, _ := userIDVal.(int64)

	// The token is only checked for signature and expiry; refuse a stream
	// to an account that has since been disabled or has expired.
	user, err := h.queries.GetUser(c.Request.Context(), userID)
	if err != nil || !accountActive(user, time.Now()) {
		shared.WriteAPIError(c, http.StatusUnauthorized, shared.CodeInvalidCredentials,
			"authentication required", nil)
		return
	}

	if !h.mgr.Ready() {
		shared.WriteAPIError(c, http.StatusServiceUnavailable, shared.CodeUnavailable,
			"audio streaming is unavailable on this server", nil)
		return
	}

	// Opaque and client-chosen, so it is length-capped and echoed back
	// only over that same user's WebSocket — it identifies a connection,
	// never a user, and grants nothing.
	sid := c.Query("sid")
	if len(sid) > maxSidLen {
		sid = sid[:maxSidLen]
	}

	// The server sets a 60s WriteTimeout for ordinary requests, which would
	// cut a live stream off mid-frame. Clear the deadline for this
	// connection only.
	if err := http.NewResponseController(c.Writer).SetWriteDeadline(time.Time{}); err != nil {
		slog.Warn("stream: could not clear the write deadline; "+
			"the stream will be cut off by the server write timeout", "error", err)
	}

	// Chunked, uncacheable, and explicitly unbuffered: an intermediary that
	// buffers this response would hold frames back and defeat the point.
	c.Header("Content-Type", streamsvc.ContentType)
	c.Header("Cache-Control", "no-store, no-transform")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	who := connections.Conn{
		UserID:   userID,
		Username: user.Username,
		Role:     user.Role,
		JTI:      c.GetString("jti"),
		FamilyID: c.GetString("fam"),
		Client:   connections.ClientFromRequest(c.Request, c.ClientIP()),
	}
	if who.FamilyID != "" {
		if n, err := h.queries.IsNativeRefreshFamily(c.Request.Context(), who.FamilyID); err == nil {
			who.Native = n != 0
		}
	}
	err = h.mgr.Serve(c.Request.Context(), who, sid, c.Writer, c.Writer.Flush)
	switch {
	case err == nil, errors.Is(err, context.Canceled):
		// Client went away — the normal end of a live stream.
	default:
		slog.Debug("stream: listener ended", "user_id", userID, "error", err)
	}
}
