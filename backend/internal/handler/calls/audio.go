package calls

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/handler/shared"
)

// GetCallAudio handles GET /api/calls/:id/audio.
//
//	@Summary		Get call audio file
//	@Description	Stream the audio file for a specific call. Authentication is optional when the publicAccess setting is enabled; otherwise a valid JWT is required.
//	@Tags			Calls,v1-Calls
//	@Security		BearerAuth
//	@Produce		application/octet-stream
//	@Param			id	path	int	true	"Call ID"
//	@Success		200	{file}	binary			"Audio file"
//	@Failure		400	{object}	ErrorResponse	"Invalid call ID"
//	@Failure		401	{object}	ErrorResponse	"Authentication required"
//	@Failure		404	{object}	ErrorResponse	"Call or audio not found"
//	@Failure		500	{object}	ErrorResponse	"Internal server error"
//	@Router			/calls/{id}/audio [get]
//	@Router			/v1/calls/{id}/audio [get]
func (h *Handler) GetCallAudio(c *gin.Context) {
	ctx := c.Request.Context()
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid call id"})
		return
	}

	// Require authentication or publicAccess for direct audio access.
	// Anonymous users must use /api/shared/:token/audio for shared calls.
	if !shared.RequireUserOrPublicAccess(c, h.queries) {
		return
	}

	call, err := h.queries.GetCall(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "call not found"})
			return
		}
		slog.Error("failed to get call audio metadata", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// Enforce per-user grants for non-admin listeners.
	if grants := shared.LoadUserGrants(c, h.queries); !shared.IsGranted(grants, call.SystemID, call.TalkgroupID.Int64) {
		c.JSON(http.StatusNotFound, gin.H{"error": "call not found"})
		return
	}

	recordingsDir := h.processor.RecordingsDir()
	relPath := filepath.Clean(call.AudioPath)
	if strings.HasPrefix(relPath, "..") || filepath.IsAbs(relPath) {
		slog.Warn("rejected unsafe audio path", "id", id, "path", call.AudioPath)
		c.JSON(http.StatusNotFound, gin.H{"error": "audio not found"})
		return
	}

	// Open the file scoped to recordingsDir via os.Root so traversal and
	// symlink escapes are impossible regardless of what's in the DB row.
	root, err := os.OpenRoot(recordingsDir)
	if err != nil {
		slog.Error("failed to open recordings root", "id", id, "error", err)
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
		slog.Error("failed to open call audio file", "id", id, "path", relPath, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		slog.Error("failed to stat call audio file", "id", id, "path", relPath, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	contentType := call.AudioType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	filename := call.AudioName
	if filename == "" {
		filename = "call"
	}

	c.Header("Content-Disposition", shared.ContentDisposition("inline", filename))
	c.Header("Content-Type", contentType)
	http.ServeContent(c.Writer, c.Request, filename, fi.ModTime(), f)
}
