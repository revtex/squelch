// Package legacyusage exposes the 24-hour legacy /api/* hit aggregate to
// admins. Backed by the in-memory ring buffer in
// middleware.DefaultLegacyUsageStore.
package legacyusage

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/revtex/squelch/internal/middleware"
)

// LegacyUsageEntry mirrors middleware.LegacyUsageEntry for swagger generation.
type LegacyUsageEntry struct {
	Path        string    `json:"path"`
	Method      string    `json:"method"`
	APIKeyIdent string    `json:"apiKeyIdent"`
	APIKeyID    int64     `json:"apiKeyId,omitempty"`
	Count       int       `json:"count"`
	LastSeen    time.Time `json:"lastSeen"`
} // @name LegacyUsageEntry

// LegacyUsageResponse is the v1 admin envelope.
type LegacyUsageResponse struct {
	WindowSeconds int                `json:"windowSeconds"`
	GeneratedAt   time.Time          `json:"generatedAt"`
	Entries       []LegacyUsageEntry `json:"entries"`
} // @name LegacyUsageResponse

// Handler serves the legacy-usage report.
type Handler struct {
	store *middleware.LegacyUsageStore
	now   func() time.Time
}

// New constructs a Handler. store may be nil to use the package singleton;
// now may be nil to use time.Now.
func New(store *middleware.LegacyUsageStore, now func() time.Time) *Handler {
	if store == nil {
		store = middleware.DefaultLegacyUsageStore
	}
	if now == nil {
		now = time.Now
	}
	return &Handler{store: store, now: now}
}

// GetUsage handles GET /api/v1/admin/legacy-usage.
//
//	@Summary		Legacy /api/* usage report (24h)
//	@Description	Returns one entry per (path, method, API key) tuple seen on the legacy /api/* surface in the last 24 hours, sourced from an in-memory ring buffer. Used by the admin dashboard to surface clients that still need to migrate to /api/v1.
//	@Tags			v1-Admin
//	@Produce		json
//	@Security		BearerAuth
//	@Success		200	{object}	LegacyUsageResponse
//	@Failure		401	{object}	shared.APIErrorResponse
//	@Failure		403	{object}	shared.APIErrorResponse
//	@Router			/v1/admin/legacy-usage [get]
func (h *Handler) GetUsage(c *gin.Context) {
	raw := h.store.Aggregate24h()
	entries := make([]LegacyUsageEntry, len(raw))
	for i, e := range raw {
		entries[i] = LegacyUsageEntry{
			Path:        e.Path,
			Method:      e.Method,
			APIKeyIdent: e.APIKeyIdent,
			APIKeyID:    e.APIKeyID,
			Count:       e.Count,
			LastSeen:    e.LastSeen.UTC(),
		}
	}
	c.JSON(http.StatusOK, LegacyUsageResponse{
		WindowSeconds: int((24 * time.Hour).Seconds()),
		GeneratedAt:   h.now().UTC(),
		Entries:       entries,
	})
}
