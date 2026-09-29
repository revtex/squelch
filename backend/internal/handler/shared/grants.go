package shared

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// SystemGrant is the grant shape used by REST handlers.
type SystemGrant = auth.SystemGrant

// LoadUserGrants returns the parsed grants for the caller. It returns nil
// (allow-all) for admins, unauthenticated callers (whose access is gated by
// publicAccess elsewhere), and users without grants. If the user's row cannot
// be loaded — for example because the user was deleted while their token is
// still valid — it returns a deny-all list rather than failing open.
func LoadUserGrants(c *gin.Context, queries *db.Queries) []SystemGrant {
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr == auth.RoleAdmin {
		return nil
	}
	userIDVal, exists := c.Get("userID")
	if !exists {
		return nil
	}
	uid, _ := userIDVal.(int64)
	user, err := queries.GetUser(c.Request.Context(), uid)
	if err != nil {
		slog.WarnContext(c.Request.Context(), "grants: user lookup failed; denying", "user_id", uid, "error", err)
		return auth.DenyAllGrants()
	}
	return auth.ParseSystemGrants(user.SystemsJson)
}

// IsGranted checks whether a call with the given system/talkgroup passes the
// grant filter. A nil grant list means everything is allowed; an empty
// non-nil list denies everything.
func IsGranted(grants []SystemGrant, systemID, talkgroupID int64) bool {
	return auth.HasSystemAccess(grants, systemID, talkgroupID)
}

// RequireUserOrPublicAccess admits authenticated callers, and anonymous
// callers only while the publicAccess setting is "true". Otherwise it writes
// a 401 and returns false; the handler must return immediately.
func RequireUserOrPublicAccess(c *gin.Context, queries *db.Queries) bool {
	if _, hasUser := c.Get("userID"); hasUser {
		return true
	}
	if GetSettingValue(c, queries, "publicAccess") == "true" {
		return true
	}
	c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
	return false
}
