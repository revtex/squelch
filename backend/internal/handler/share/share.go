// Package share provides endpoints for shareable call links.
package share

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/shared"
)

const (
	rateWindowDuration = time.Minute
	shareRatePerMin    = 10
)

// shareLimiter is a per-user sliding-window rate limiter for share creation.
type shareLimiter struct {
	mu          sync.Mutex
	windowStart time.Time
	count       int
	rateLimit   int
}

func (l *shareLimiter) allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.windowStart) >= rateWindowDuration {
		l.windowStart = now
		l.count = 0
	}
	if l.count >= l.rateLimit {
		return false
	}
	l.count++
	return true
}

// Handler handles shareable link endpoints.
type Handler struct {
	queries   *db.Queries
	processor *audio.Processor

	mu       sync.Mutex
	limiters map[int64]*shareLimiter
}

// New constructs a share Handler.
func New(queries *db.Queries, processor *audio.Processor) *Handler {
	return &Handler{
		queries:   queries,
		processor: processor,
		limiters:  make(map[int64]*shareLimiter),
	}
}

func (h *Handler) getShareLimiter(userID int64) *shareLimiter {
	h.mu.Lock()
	defer h.mu.Unlock()

	if len(h.limiters) > 100 {
		now := time.Now()
		for id, l := range h.limiters {
			l.mu.Lock()
			stale := now.Sub(l.windowStart) >= 2*rateWindowDuration
			l.mu.Unlock()
			if stale {
				delete(h.limiters, id)
			}
		}
	}

	l, ok := h.limiters[userID]
	if !ok {
		l = &shareLimiter{
			windowStart: time.Now(),
			rateLimit:   shareRatePerMin,
		}
		h.limiters[userID] = l
	}
	return l
}

// ShareResponse is the JSON payload for a shared call viewed via token.
type ShareResponse struct {
	Token          string `json:"token"`
	DateTime       int64  `json:"dateTime"`
	SystemLabel    string `json:"systemLabel"`
	TalkgroupLabel string `json:"talkgroupLabel"`
	TalkgroupName  string `json:"talkgroupName"`
	Frequency      int64  `json:"frequency"`
	Duration       int64  `json:"duration"`
	Source         int64  `json:"source"`
	Transcript     string `json:"transcript,omitempty"`
	AudioURL       string `json:"audioUrl"`
} // @name ShareResponse

// ShareCreateResponse is returned when a call is shared.
type ShareCreateResponse struct {
	Token string `json:"token"`
	URL   string `json:"url"`
} // @name ShareCreateResponse

// PostShareCall handles POST /api/calls/:id/share.
// Creates a shared_links record for the call and returns the token + URL.
//
// @Summary      Share a call
// @Description  Creates a shared_links record for the call and returns the token + URL.
// @Tags         Sharing,v1-Calls
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      int  true  "Call ID"
// @Success      201  {object}  ShareCreateResponse
// @Success      200  {object}  ShareCreateResponse
// @Failure      400  {object}  ErrorResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      403  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /calls/{id}/share [post]
// @Router       /v1/calls/{id}/share [post]
func (h *Handler) PostShareCall(c *gin.Context) {
	ctx := c.Request.Context()

	if shared.GetSettingValue(c, h.queries, "shareableLinks") != "true" {
		c.JSON(http.StatusForbidden, gin.H{"error": "sharing is disabled"})
		return
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid call id"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(int64)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Per-user rate limit: 10 shares per minute.
	if !h.getShareLimiter(userID).allow() {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "share rate limit exceeded, try again later"})
		return
	}

	// Verify call exists.
	call, err := h.queries.GetCall(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "call not found"})
			return
		}
		slog.Error("failed to get call for sharing", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Enforce per-user grants — restricted listeners cannot share calls
	// outside their authorised scope.
	if grants := shared.LoadUserGrants(c, h.queries); !shared.IsGranted(grants, call.SystemID, call.TalkgroupID.Int64) {
		c.JSON(http.StatusNotFound, gin.H{"error": "call not found"})
		return
	}

	// Check if already shared — return existing token. This must come after
	// the grant check: the token unlocks the call's audio for anyone.
	existing, err := h.queries.GetSharedLinkByCallID(ctx, id)
	if err == nil {
		c.JSON(http.StatusOK, ShareCreateResponse{
			Token: existing.Token,
			URL:   fmt.Sprintf("/call/%s", existing.Token),
		})
		return
	}

	token := uuid.New().String()

	// Compute expires_at from the global sharedLinkExpiry setting (stored as days).
	var expiresAt sql.NullInt64
	if expStr := shared.GetSettingValue(c, h.queries, "sharedLinkExpiry"); expStr != "" && expStr != "0" {
		if expDays, err := strconv.ParseInt(expStr, 10, 64); err == nil && expDays > 0 {
			expiresAt = sql.NullInt64{Int64: time.Now().Unix() + expDays*86400, Valid: true}
		}
	}

	sl, err := h.queries.CreateSharedLink(ctx, db.CreateSharedLinkParams{
		CallID:    id,
		UserID:    userID,
		Token:     token,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		slog.Error("failed to create shared link", "call_id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusCreated, ShareCreateResponse{
		Token: sl.Token,
		URL:   fmt.Sprintf("/call/%s", sl.Token),
	})
}

// DeleteShareCall handles DELETE /api/calls/:id/share.
// Removes the shared_links record. Only the original sharer or an admin can unshare.
//
// @Summary      Unshare a call
// @Description  Removes the shared_links record. Only the original sharer or an admin can unshare.
// @Tags         Sharing,v1-Calls
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      int  true  "Call ID"
// @Success      200  {object}  object{shared=bool}
// @Failure      400  {object}  ErrorResponse
// @Failure      403  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /calls/{id}/share [delete]
// @Router       /v1/calls/{id}/share [delete]
func (h *Handler) DeleteShareCall(c *gin.Context) {
	ctx := c.Request.Context()

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid call id"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(int64)
	role, _ := c.Get("role")

	// The token unlocks the call for anyone, so only a caller who may access
	// the call itself may read it.
	call, err := h.queries.GetCall(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not shared"})
			return
		}
		slog.Error("failed to get call for share lookup", "call_id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	if grants := shared.LoadUserGrants(c, h.queries); !shared.IsGranted(grants, call.SystemID, call.TalkgroupID.Int64) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not shared"})
		return
	}

	sl, err := h.queries.GetSharedLinkByCallID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not shared"})
			return
		}
		slog.Error("failed to get shared link", "call_id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	if sl.UserID != userID && role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	if err := h.queries.DeleteSharedLinkByCallID(ctx, id); err != nil {
		slog.Error("failed to delete shared link", "call_id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"shared": false})
}

// isSharedLinkExpired checks if a shared link has expired.
// It checks the explicit expires_at first, then falls back to the global
// sharedLinkExpiry setting (days) applied to created_at. Returns false if no expiry is set.
func (h *Handler) isSharedLinkExpired(c *gin.Context, expiresAt sql.NullInt64, createdAt int64) bool {
	now := time.Now().Unix()
	if expiresAt.Valid && expiresAt.Int64 > 0 {
		return now > expiresAt.Int64
	}
	// Fallback: global setting (days) applied to creation time.
	if expStr := shared.GetSettingValue(c, h.queries, "sharedLinkExpiry"); expStr != "" && expStr != "0" {
		if expDays, err := strconv.ParseInt(expStr, 10, 64); err == nil && expDays > 0 {
			return now > createdAt+expDays*86400
		}
	}
	return false
}

// GetSharedCallByToken handles GET /api/shared/:token.
// Returns call metadata as JSON for public viewing. No authentication required.
//
// @Summary      Get shared call by token
// @Description  Returns call metadata as JSON for public viewing. No authentication required.
// @Tags         Sharing,v1-Calls
// @Produce      json
// @Param        token  path      string  true  "Share token"
// @Failure      400    {object}  ErrorResponse
// @Success      200    {object}  ShareResponse
// @Failure      404    {object}  ErrorResponse
// @Failure      500    {object}  ErrorResponse
// @Router       /shared/{token} [get]
// @Router       /v1/shared/{token} [get]
func (h *Handler) GetSharedCallByToken(c *gin.Context) {
	ctx := c.Request.Context()
	token := c.Param("token")

	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token required"})
		return
	}

	sl, err := h.queries.GetSharedLinkByToken(ctx, token)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		slog.Error("failed to get shared link by token", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	if h.isSharedLinkExpired(c, sl.ExpiresAt, sl.CreatedAt) {
		c.JSON(http.StatusGone, gin.H{"error": "shared link has expired"})
		return
	}
	if err := h.queries.TouchSharedLinkOpened(ctx, db.TouchSharedLinkOpenedParams{
		Now: sql.NullInt64{Int64: time.Now().Unix(), Valid: true},
		ID:  sl.ID,
	}); err != nil {
		slog.Warn("failed to count a shared link open", "token", token, "error", err)
	}

	resp := ShareResponse{
		Token:          sl.Token,
		DateTime:       sl.DateTime,
		SystemLabel:    sl.SystemLabel.String,
		TalkgroupLabel: sl.TalkgroupLabel.String,
		TalkgroupName:  sl.TalkgroupName.String,
		Frequency:      sl.Frequency.Int64,
		Duration:       sl.Duration.Int64,
		Source:         sl.Source.Int64,
		AudioURL:       fmt.Sprintf("/api/shared/%s/audio", sl.Token),
	}

	// Fetch transcript if available.
	trx, err := h.queries.GetTranscriptionByCallID(ctx, sl.CallID)
	if err == nil {
		resp.Transcript = trx.Text
	}

	c.JSON(http.StatusOK, resp)
}

// GetSharedCallAudio handles GET /api/shared/:token/audio.
// Serves the audio file for a shared call. No authentication required.
//
// @Summary      Get shared call audio
// @Description  Serves the audio file for a shared call. No authentication required.
// @Tags         Sharing,v1-Calls
// @Produce      application/octet-stream
// @Param        token  path      string  true  "Share token"
// @Failure      400    {object}  ErrorResponse
// @Success      200    {file}    binary
// @Failure      404    {object}  ErrorResponse
// @Failure      500    {object}  ErrorResponse
// @Router       /shared/{token}/audio [get]
// @Router       /v1/shared/{token}/audio [get]
func (h *Handler) GetSharedCallAudio(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token required"})
		return
	}

	sl, err := h.queries.GetSharedLinkByToken(c.Request.Context(), token)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		slog.Error("failed to get shared link for audio", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	if h.isSharedLinkExpired(c, sl.ExpiresAt, sl.CreatedAt) {
		c.JSON(http.StatusGone, gin.H{"error": "shared link has expired"})
		return
	}

	recordingsDir := h.processor.RecordingsDir()
	relPath := filepath.Clean(sl.AudioPath)
	if strings.HasPrefix(relPath, "..") || filepath.IsAbs(relPath) {
		slog.Warn("rejected unsafe audio path", "token", token, "path", sl.AudioPath)
		c.JSON(http.StatusNotFound, gin.H{"error": "audio not found"})
		return
	}

	// Open the file scoped to recordingsDir via os.Root so traversal and
	// symlink escapes are impossible regardless of what's in the DB row.
	root, err := os.OpenRoot(recordingsDir)
	if err != nil {
		slog.Error("failed to open recordings root", "token", token, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer root.Close()

	f, err := root.Open(relPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "audio file not found"})
			return
		}
		slog.Error("failed to open shared call audio", "token", token, "path", relPath, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		slog.Error("failed to stat shared call audio", "token", token, "path", relPath, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	contentType := sl.AudioType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	filename := sl.AudioName
	if filename == "" {
		filename = filepath.Base(sl.AudioPath)
	}

	c.Header("Content-Disposition", shared.ContentDisposition("inline", filename))
	c.Header("Content-Type", contentType)
	http.ServeContent(c.Writer, c.Request, filename, fi.ModTime(), f)
}

// GetCallShare handles GET /api/calls/:id/share (legacy compatibility).
// Returns the share token for a call if it exists, for authenticated users.
//
// @Summary      Get call share status
// @Description  Returns the share token for a call if it exists, for authenticated users.
// @Tags         Sharing,v1-Calls
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      int  true  "Call ID"
// @Success      200  {object}  ShareCreateResponse
// @Failure      400  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /calls/{id}/share [get]
// @Router       /v1/calls/{id}/share [get]
func (h *Handler) GetCallShare(c *gin.Context) {
	ctx := c.Request.Context()

	if shared.GetSettingValue(c, h.queries, "shareableLinks") != "true" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid call id"})
		return
	}

	// The token unlocks the call for anyone, so only a caller who may access
	// the call itself may read it.
	call, err := h.queries.GetCall(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not shared"})
			return
		}
		slog.Error("failed to get call for share lookup", "call_id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	if grants := shared.LoadUserGrants(c, h.queries); !shared.IsGranted(grants, call.SystemID, call.TalkgroupID.Int64) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not shared"})
		return
	}

	sl, err := h.queries.GetSharedLinkByCallID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not shared"})
			return
		}
		slog.Error("failed to get shared link", "call_id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": sl.Token, "shared": true})
}
