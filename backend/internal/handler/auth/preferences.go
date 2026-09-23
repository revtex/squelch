package auth

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/db"
)

// preferencesResponse is a listener's own client settings, stored against the
// account so they follow the person rather than the browser.
//
// Every field is a pointer: absent means "never chosen", which is not the same
// as a chosen value. The keypad's absent is what lets the instance-wide
// default still apply, while an explicit "disabled" silences it for good.
type preferencesResponse struct {
	KeypadBeeps *string `json:"keypadBeeps,omitempty"`
} // @name PreferencesResponse

type preferencesRequest struct {
	KeypadBeeps *string `json:"keypadBeeps,omitempty"`
} // @name PreferencesRequest

// keypadBeepStyles are the sounds the client knows how to make. Anything else
// is refused rather than stored, so a bad value cannot sit in the account
// waiting to be served back to every device the listener signs in on.
var keypadBeepStyles = map[string]bool{
	"disabled": true,
	"uniden":   true,
	"whistler": true,
}

// storedPreferences decodes preferences_json, tolerating a malformed value by
// treating it as unset — a listener's beep style is not worth a 500.
func storedPreferences(raw sql.NullString) preferencesResponse {
	var prefs preferencesResponse
	if !raw.Valid || raw.String == "" {
		return prefs
	}
	if err := json.Unmarshal([]byte(raw.String), &prefs); err != nil {
		slog.Warn("malformed preferences_json", "error", err)
		return preferencesResponse{}
	}
	return prefs
}

// GetPreferences handles GET /api/v1/listener/preferences (JWT required).
//
// @Summary      Get listener preferences
// @Description  Return the authenticated listener's own client settings. A
// @Description  field is absent when it has never been set, which leaves the
// @Description  instance-wide default in force.
// @Tags         Auth,v1-Listener
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  preferencesResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /v1/listener/preferences [get]
func (h *Handler) GetPreferences(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(int64)

	user, err := h.queries.GetUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}

	c.JSON(http.StatusOK, storedPreferences(user.PreferencesJson))
}

// PutPreferences handles PUT /api/v1/listener/preferences (JWT required).
//
// Fields the body omits are left as they are, so a client that knows about one
// preference cannot wipe another it has never heard of.
//
// @Summary      Update listener preferences
// @Description  Save the authenticated listener's own client settings. Omitted
// @Description  fields keep their stored value.
// @Tags         Auth,v1-Listener
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      preferencesRequest  true  "Preferences"
// @Success      200   {object}  preferencesResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /v1/listener/preferences [put]
func (h *Handler) PutPreferences(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(int64)

	var req preferencesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	user, err := h.queries.GetUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}

	prefs := storedPreferences(user.PreferencesJson)
	if req.KeypadBeeps != nil {
		if !keypadBeepStyles[*req.KeypadBeeps] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown keypad beep style"})
			return
		}
		prefs.KeypadBeeps = req.KeypadBeeps
	}

	encoded, err := json.Marshal(prefs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save preferences"})
		return
	}

	if err := h.queries.UpdateUserPreferences(c.Request.Context(), db.UpdateUserPreferencesParams{
		PreferencesJson: sql.NullString{String: string(encoded), Valid: true},
		UpdatedAt:       time.Now().Unix(),
		ID:              userID,
	}); err != nil {
		slog.Error("failed to save preferences", "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save preferences"})
		return
	}

	c.JSON(http.StatusOK, prefs)
}
