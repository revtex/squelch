// Package auth contains authentication handlers (login, refresh, logout, password change, /me, TG selection)
// and the Swagger docs session endpoint that mints a short-lived HTTP-only cookie.
package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/shared"
)

// WSDisconnecter is the subset of ws.Hub used by Handler for session eviction.
type WSDisconnecter interface {
	DisconnectByUser(userID int64)
	DisconnectByJTI(jti string)
}

// Handler handles authentication endpoints.
type Handler struct {
	queries     *db.Queries
	rateLimiter *auth.RateLimiter
	hub         WSDisconnecter
	// replayCache absorbs harmless duplicate refresh requests (parallel
	// tabs, service-worker retries, reloads mid-rotation) within a short
	// grace window without revoking the token family. See replay_cache.go.
	replayCache *replayCache
}

// New constructs an auth Handler.
func New(queries *db.Queries, rateLimiter *auth.RateLimiter, hub WSDisconnecter) *Handler {
	return &Handler{
		queries:     queries,
		rateLimiter: rateLimiter,
		hub:         hub,
		replayCache: newReplayCache(RefreshReplayGrace),
	}
}

type loginRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	RememberMe *bool  `json:"rememberMe,omitempty"`
} // @name LoginRequest

// NativeClientHeader lets a non-browser client ask for the refresh token in
// the response body instead of an httpOnly cookie. Media players fetch audio
// on their own network stack — ExoPlayer only sees cookies belonging to the
// OkHttpClient it was handed, and AVPlayer does not reliably use
// HTTPCookieStorage at all — so a native app authenticates every request with
// a bearer header and has nowhere sensible to keep a cookie.
const (
	NativeClientHeader = "X-Squelch-Client"
	NativeClientValue  = "native"
)

// wantsNativeTokens reports whether the caller asked for body-carried refresh
// tokens on login.
//
// Note the asymmetry with refreshViaBody below, which is deliberate and worth
// understanding before anyone "fixes" it. On refresh the guard is structural:
// the raw token is echoed only to a caller that already presented one in the
// body, so possession of the httpOnly cookie can never be escalated into a
// JS-readable token. Here the guard is only that the caller knows the
// password — this header is client-asserted, so page script with both an XSS
// foothold and stolen credentials could ask for a 30-day token it can read,
// where the cookie would have denied it. Closing that would mean also
// requiring the absence of a refresh cookie (a real native client never has
// one); it is not done here because it would silently drop a native client
// that happens to carry a cookie jar into the browser path.
func wantsNativeTokens(c *gin.Context) bool {
	return c.GetHeader(NativeClientHeader) == NativeClientValue
}

// refreshRequest is the body a non-browser client sends to /auth/refresh and
// /auth/logout when it holds the refresh token itself.
type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
} // @name RefreshRequest

// bodyRefreshToken pulls the refresh token out of the request body, returning
// "" when there is no body, it is not JSON, or it carries no token. A missing
// body is the normal browser case, not an error.
func bodyRefreshToken(c *gin.Context) string {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		return ""
	}
	return req.RefreshToken
}

type loginUserResponse struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
} // @name LoginUserResponse

type loginResponse struct {
	Token string            `json:"token"`
	User  loginUserResponse `json:"user"`
	// RefreshToken is populated only for clients that sent
	// `X-Squelch-Client: native`; browsers get the httpOnly cookie instead
	// and never see this field.
	RefreshToken       string `json:"refreshToken,omitempty"`
	PasswordNeedChange bool   `json:"passwordNeedChange"`
} // @name LoginResponse

// PostLogin handles POST /api/auth/login.
// Returns 429 if rate-limited (via middleware), 401 for invalid credentials, 200 with JWT on success.
//
// @Summary      Log in
// @Description  Authenticate with username and password, returns a JWT token.
// @Tags         Auth,v1-Auth
// @Accept       json
// @Produce      json
// @Param        body  body      loginRequest   true  "Login credentials"
// @Param        X-Squelch-Client  header  string  false  "Set to `native` to receive the refresh token in the response body instead of an httpOnly cookie"
// @Success      200   {object}  loginResponse
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      429   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /auth/login [post]
// @Router       /v1/auth/login [post]
func (h *Handler) PostLogin(c *gin.Context) {
	ip := c.ClientIP()

	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	// Reserve the attempt before any password check so a burst of parallel
	// requests cannot outrun the lockout.
	if !h.rateLimiter.TryBegin(ip) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many failed attempts, try again later"})
		return
	}
	defer h.rateLimiter.End(ip)

	user, err := h.queries.GetUserByUsername(c.Request.Context(), req.Username)
	if err != nil {
		// Always run bcrypt to normalise response time and prevent username
		// enumeration via timing side-channel (OWASP A07).
		_ = auth.CheckPassword(req.Password, auth.DummyHash)
		h.rateLimiter.RecordFailure(ip)
		h.logAuthEvent(c.Request.Context(), "warn", "login failed: invalid username", ip)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if user.Disabled != 0 {
		// Return the same generic error to avoid revealing account existence
		// or disabled status (OWASP A10 — sensitive data exposure).
		h.rateLimiter.RecordFailure(ip)
		h.logAuthEvent(c.Request.Context(), "warn", "login failed: disabled account", ip)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	// Check account expiration (OWASP A01 — broken access control).
	if user.Expiration.Valid && user.Expiration.Int64 > 0 {
		if time.Now().Unix() > user.Expiration.Int64 {
			h.rateLimiter.RecordFailure(ip)
			slog.WarnContext(c.Request.Context(), "login failed: expired account", "user_id", user.ID, "ip", ip)
			h.logAuthEvent(c.Request.Context(), "warn", "login failed: expired account", ip)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
	}

	if !auth.CheckPassword(req.Password, user.PasswordHash) {
		h.rateLimiter.RecordFailure(ip)
		slog.WarnContext(c.Request.Context(), "login failed: wrong password", "user_id", user.ID, "ip", ip)
		h.logAuthEvent(c.Request.Context(), "warn", "login failed: wrong password", ip)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	h.rateLimiter.Reset(ip)

	var accountExp int64
	if user.Expiration.Valid {
		accountExp = user.Expiration.Int64
	}

	token, jti, err := auth.GenerateToken(user.ID, user.Username, user.Role, accountExp)
	if err != nil {
		slog.Error("auth: failed to generate token", "user_id", user.ID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	auth.Tokens.Track(user.ID, jti, time.Now().Add(auth.AccessTokenExpiry))

	// Generate refresh token and store its hash in the DB.
	rawRefresh, hashRefresh, err := auth.GenerateRefreshToken()
	if err != nil {
		slog.Error("auth: failed to generate refresh token", "user_id", user.ID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	familyID := uuid.New().String()
	now := time.Now()

	// Enforce max refresh token families per user.
	count, err := h.queries.CountActiveRefreshTokenFamilies(c.Request.Context(), db.CountActiveRefreshTokenFamiliesParams{
		UserID:    user.ID,
		ExpiresAt: now.Unix(),
	})
	if err == nil && count >= auth.MaxRefreshFamilies {
		// Revoke the oldest family to make room.
		oldestFamily, err := h.queries.GetOldestActiveRefreshTokenFamily(c.Request.Context(), db.GetOldestActiveRefreshTokenFamilyParams{
			UserID:    user.ID,
			ExpiresAt: now.Unix(),
		})
		if err == nil {
			_ = h.queries.RevokeRefreshTokenFamily(c.Request.Context(), oldestFamily)
		}
	}

	if err := h.queries.CreateRefreshToken(c.Request.Context(), db.CreateRefreshTokenParams{
		UserID:    user.ID,
		TokenHash: hashRefresh,
		FamilyID:  familyID,
		ExpiresAt: now.Add(auth.RefreshTokenExpiry).Unix(),
		CreatedAt: now.Unix(),
	}); err != nil {
		slog.Error("auth: failed to store refresh token", "user_id", user.ID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	// A native client carries both tokens itself: the refresh token comes
	// back in the body below, and the access JWT rides an Authorization
	// header on every request including audio. Setting either cookie would
	// hand it credentials it has no way to manage.
	native := wantsNativeTokens(c)
	if !native {
		// Set refresh token cookie. rememberMe defaults to true.
		rememberMe := req.RememberMe == nil || *req.RememberMe
		if rememberMe {
			auth.SetRefreshCookie(c, rawRefresh, int(auth.RefreshTokenExpiry.Seconds()))
		} else {
			// Session-only cookie (no Max-Age / Expires — cleared on browser close).
			auth.SetRefreshCookie(c, rawRefresh, 0)
		}

		// Also set the os_session cookie carrying the access JWT so that
		// <audio src=…> and other same-origin browser requests can authenticate
		// without injecting an Authorization header. Lifetime mirrors the
		// access-token TTL; the frontend bearer flow continues to work unchanged.
		auth.SetSessionCookie(c, token, int(auth.AccessTokenExpiry.Seconds()))
	}

	h.logAuthEvent(c.Request.Context(), "info", "login success: "+user.Username, ip)
	slog.Info("user logged in", "user_id", user.ID, "username", user.Username, "ip", ip)

	resp := loginResponse{
		Token: token,
		User: loginUserResponse{
			ID:       user.ID,
			Username: user.Username,
			Role:     user.Role,
		},
		PasswordNeedChange: user.PasswordNeedChange != 0,
	}
	if native {
		resp.RefreshToken = rawRefresh
	}
	c.JSON(http.StatusOK, resp)
}

// logAuthEvent writes an authentication event to the logs table for auditing
// (OWASP A09 — security logging & monitoring).
func (h *Handler) logAuthEvent(ctx context.Context, level, message, ip string) {
	_ = h.queries.CreateLog(ctx, db.CreateLogParams{
		DateTime: time.Now().Unix(),
		Level:    level,
		Message:  message + " [ip=" + ip + "]",
	})
}

// PostLogout handles POST /api/auth/logout (JWT required).
// Revokes the current token so it cannot be reused.
//
// @Summary      Log out
// @Description  Revoke the current JWT token.
// @Tags         Auth,v1-Auth
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      refreshRequest  false  "Non-browser clients pass their refresh token here so its family is revoked"
// @Success      200  {object}  object{ok=bool}
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /auth/logout [post]
// @Router       /v1/auth/logout [post]
func (h *Handler) PostLogout(c *gin.Context) {
	if jtiVal, ok := c.Get("jti"); ok {
		if jti, ok := jtiVal.(string); ok {
			auth.Tokens.Revoke(jti)
			// Immediately disconnect the WS session using this token.
			if h.hub != nil {
				h.hub.DisconnectByJTI(jti)
			}
		}
	}

	// Revoke the refresh token family and clear the cookie. A native client
	// holds its refresh token in the body instead, and without this its
	// family would outlive the logout by up to 30 days: revoking the access
	// JWT by jti above says nothing about the refresh family, and the only
	// other paths that revoke one are replay detection and the
	// max-families eviction on login.
	rawToken, err := c.Cookie(auth.RefreshCookieName)
	if err != nil || rawToken == "" {
		rawToken = bodyRefreshToken(c)
	}
	if rawToken != "" {
		tokenHash := auth.HashRefreshToken(rawToken)
		if rt, err := h.queries.GetRefreshTokenByHash(c.Request.Context(), tokenHash); err == nil {
			_ = h.queries.RevokeRefreshTokenFamily(c.Request.Context(), rt.FamilyID)
		}
	}
	auth.ClearRefreshCookie(c)
	auth.ClearSessionCookie(c)

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type refreshResponse struct {
	Token string            `json:"token"`
	User  loginUserResponse `json:"user"`
	// RefreshToken is returned only to a caller that presented its refresh
	// token in the request body. A cookie-bearing browser never receives
	// it, so an XSS foothold cannot escalate the httpOnly cookie into a
	// token it can read and keep.
	RefreshToken string `json:"refreshToken,omitempty"`
} // @name RefreshResponse

// PostRefresh handles POST /api/auth/refresh (no JWT required — cookie is the auth).
// Validates the refresh token cookie, rotates it, and returns a new access token.
//
// @Summary      Refresh access token
// @Description  Exchange a valid refresh token cookie for a new access token and rotated refresh token.
// @Tags         Auth,v1-Auth
// @Accept       json
// @Produce      json
// @Param        body  body      refreshRequest  false  "Non-browser clients send {\"refreshToken\": \"…\"} here instead of the cookie; the rotated token comes back in the response body"
// @Success      200  {object}  refreshResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /auth/refresh [post]
// @Router       /v1/auth/refresh [post]
func (h *Handler) PostRefresh(c *gin.Context) {
	// The cookie wins when present, so a browser's flow is untouched. Only
	// when there is no cookie does the body come into play, which is what
	// keeps the raw token out of every browser response: viaBody is the
	// single condition guarding both the cookie writes below and the token
	// echoed in the response.
	rawToken, err := c.Cookie(auth.RefreshCookieName)
	viaBody := false
	if err != nil || rawToken == "" {
		rawToken = bodyRefreshToken(c)
		viaBody = rawToken != ""
	}
	if rawToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no refresh token"})
		return
	}

	tokenHash := auth.HashRefreshToken(rawToken)
	rt, err := h.queries.GetRefreshTokenByHash(c.Request.Context(), tokenHash)
	if err != nil {
		// Token not found — invalid or already consumed.
		auth.ClearRefreshCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	// If the token has been revoked, this MAY be a replay attack — but it
	// is far more likely to be a benign duplicate (parallel tab, service
	// worker, reload mid-rotation). If we already rotated this exact token
	// within the grace window, replay the cached successor so both racing
	// clients converge on the same access JWT and refresh cookie. Outside
	// the grace window, treat it as theft and revoke the family.
	if rt.Revoked != 0 {
		if cached, ok := h.replayCache.get(tokenHash); ok {
			slog.Info("auth: refresh replay within grace window, returning cached successor",
				"family_id", rt.FamilyID, "user_id", rt.UserID)
			resp := refreshResponse{
				Token: cached.accessToken,
				User: loginUserResponse{
					ID:       cached.userID,
					Username: cached.username,
					Role:     cached.role,
				},
			}
			if viaBody {
				// Same idempotency the cookie path gets: a native client
				// that retried mid-rotation must converge on the same
				// successor rather than lose its session.
				resp.RefreshToken = cached.refreshRaw
			} else {
				auth.SetRefreshCookie(c, cached.refreshRaw, int(auth.RefreshTokenExpiry.Seconds()))
				auth.SetSessionCookie(c, cached.accessToken, int(auth.AccessTokenExpiry.Seconds()))
			}
			c.JSON(http.StatusOK, resp)
			return
		}
		slog.Warn("auth: refresh token replay detected, revoking family",
			"family_id", rt.FamilyID, "user_id", rt.UserID)
		_ = h.queries.RevokeRefreshTokenFamily(c.Request.Context(), rt.FamilyID)
		auth.ClearRefreshCookie(c)
		ip := c.ClientIP()
		h.logAuthEvent(c.Request.Context(), "warn", "refresh token replay detected", ip)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	// Check expiration.
	if time.Now().Unix() > rt.ExpiresAt {
		_ = h.queries.RevokeRefreshToken(c.Request.Context(), rt.ID)
		auth.ClearRefreshCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token expired"})
		return
	}

	// Revoke the old refresh token (rotation).
	_ = h.queries.RevokeRefreshToken(c.Request.Context(), rt.ID)

	// Load user — check disabled, expiration.
	user, err := h.queries.GetUser(c.Request.Context(), rt.UserID)
	if err != nil || user.Disabled != 0 {
		auth.ClearRefreshCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}
	if user.Expiration.Valid && user.Expiration.Int64 > 0 {
		if time.Now().Unix() > user.Expiration.Int64 {
			auth.ClearRefreshCookie(c)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "account expired"})
			return
		}
	}

	// Generate new access token.
	var accountExp int64
	if user.Expiration.Valid {
		accountExp = user.Expiration.Int64
	}
	accessToken, jti, err := auth.GenerateToken(user.ID, user.Username, user.Role, accountExp)
	if err != nil {
		slog.Error("auth: failed to generate token on refresh", "user_id", user.ID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}
	auth.Tokens.Track(user.ID, jti, time.Now().Add(auth.AccessTokenExpiry))

	// Generate new refresh token (same family).
	newRaw, newHash, err := auth.GenerateRefreshToken()
	if err != nil {
		slog.Error("auth: failed to generate refresh token on refresh", "user_id", user.ID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	now := time.Now()
	if err := h.queries.CreateRefreshToken(c.Request.Context(), db.CreateRefreshTokenParams{
		UserID:    user.ID,
		TokenHash: newHash,
		FamilyID:  rt.FamilyID,
		ExpiresAt: now.Add(auth.RefreshTokenExpiry).Unix(),
		CreatedAt: now.Unix(),
	}); err != nil {
		slog.Error("auth: failed to store rotated refresh token", "user_id", user.ID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	if !viaBody {
		// Set new cookie with same Max-Age as original.
		auth.SetRefreshCookie(c, newRaw, int(auth.RefreshTokenExpiry.Seconds()))

		// Rotate the os_session cookie alongside the refresh cookie so the
		// browser-only <audio> auth path always carries a fresh access JWT.
		auth.SetSessionCookie(c, accessToken, int(auth.AccessTokenExpiry.Seconds()))
	}

	// Cache the issued response keyed by the OLD token hash so a duplicate
	// presentation of the same cookie within the grace window (parallel
	// tab, SW retry, reload mid-rotation) is answered idempotently rather
	// than treated as replay-and-revoke. See replay_cache.go.
	h.replayCache.put(tokenHash, replayCacheEntry{
		accessToken: accessToken,
		refreshRaw:  newRaw,
		userID:      user.ID,
		username:    user.Username,
		role:        user.Role,
		familyID:    rt.FamilyID,
	})

	resp := refreshResponse{
		Token: accessToken,
		User: loginUserResponse{
			ID:       user.ID,
			Username: user.Username,
			Role:     user.Role,
		},
	}
	if viaBody {
		resp.RefreshToken = newRaw
	}
	c.JSON(http.StatusOK, resp)
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
} // @name ChangePasswordRequest

// PutPassword handles PUT /api/auth/password (JWT required, any role).
// Verifies the current password and updates it to the new one.
//
// @Summary      Change password
// @Description  Change the current user's password. Requires the current password for verification.
// @Tags         Auth,v1-Auth
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      changePasswordRequest  true  "Current and new password"
// @Success      200   {object}  object{ok=bool}
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /auth/password [put]
// @Router       /v1/auth/password [put]
func (h *Handler) PutPassword(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(int64)

	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.CurrentPassword == "" || req.NewPassword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "currentPassword and newPassword are required"})
		return
	}

	if len(req.NewPassword) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new password must be at least 8 characters"})
		return
	}
	if len(req.NewPassword) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new password must be at most 128 characters"})
		return
	}

	user, err := h.queries.GetUser(c.Request.Context(), userID)
	if err != nil {
		slog.Error("failed to load user for password change", "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}

	if !auth.CheckPassword(req.CurrentPassword, user.PasswordHash) {
		ip := c.ClientIP()
		slog.Warn("auth: password change rejected - wrong current password", "user_id", userID, "ip", ip)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "current password is incorrect"})
		return
	}

	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		slog.Error("failed to hash new password", "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	if err := h.queries.UpdateUserPassword(c.Request.Context(), db.UpdateUserPasswordParams{
		PasswordHash: hash,
		UpdatedAt:    time.Now().Unix(),
		ID:           userID,
	}); err != nil {
		slog.Error("failed to update password", "user_id", userID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update password"})
		return
	}

	// Revoke all existing tokens so compromised sessions are immediately invalidated.
	auth.Tokens.RevokeAllForUser(userID)
	_ = h.queries.RevokeAllRefreshTokensForUser(c.Request.Context(), userID)

	// Disconnect all active WS sessions for this user.
	if h.hub != nil {
		h.hub.DisconnectByUser(userID)
	}

	ip := c.ClientIP()
	slog.Info("auth: password changed", "user_id", userID, "ip", ip)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetMe handles GET /api/auth/me (JWT required).
// Returns the current user's basic profile.
//
// @Summary      Current user
// @Description  Return the authenticated user's profile.
// @Tags         Auth,v1-Auth
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  loginUserResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /auth/me [get]
// @Router       /v1/auth/me [get]
func (h *Handler) GetMe(c *gin.Context) {
	userID, _ := c.Get("userID")
	username, _ := c.Get("username")
	role, _ := c.Get("role")

	uid, _ := userID.(int64)
	uname, _ := username.(string)
	roleStr, _ := role.(string)

	c.JSON(http.StatusOK, loginUserResponse{
		ID:       uid,
		Username: uname,
		Role:     roleStr,
	})
}

type tgSelectionResponse struct {
	DisabledTGs []int64        `json:"disabledTGs"`
	AvoidList   []avoidTGEntry `json:"avoidList"`
	// Version fingerprints the stored selection. Clients echo it back on
	// PUT so a stale tab or a second device cannot silently overwrite a
	// newer selection (see PutTGSelection).
	Version string `json:"version"`
} // @name TGSelectionResponse

type tgSelectionRequest struct {
	DisabledTGs []int64        `json:"disabledTGs"`
	AvoidList   []avoidTGEntry `json:"avoidList"`
	// Version is the fingerprint the client last read. Omitted (legacy
	// clients) means "overwrite unconditionally".
	Version *string `json:"version,omitempty"`
} // @name TGSelectionRequest

// tgSelectionStored is the on-disk shape of tg_selection_json. It deliberately
// omits Version so the fingerprint covers only the selection itself.
type tgSelectionStored struct {
	DisabledTGs []int64        `json:"disabledTGs"`
	AvoidList   []avoidTGEntry `json:"avoidList"`
}

// tgSelectionVersion fingerprints the stored tg_selection_json so a PUT can
// detect that someone else wrote in between. Content-addressed rather than
// timestamp-based, so unrelated user edits (role, password) don't spuriously
// conflict.
func tgSelectionVersion(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:8])
}

// storedTGSelection returns the user's raw tg_selection_json ("" when unset).
func storedTGSelection(user db.User) string {
	if user.TgSelectionJson.Valid {
		return user.TgSelectionJson.String
	}
	return ""
}

type avoidTGEntry struct {
	TalkgroupID int64 `json:"talkgroupId"`
	ExpiresAt   int64 `json:"expiresAt"`
} // @name AvoidTGEntry

// GetTGSelection handles GET /api/auth/tg-selection (JWT required).
// Returns the list of talkgroup IDs the user has disabled.
//
// @Summary      Get talkgroup selection
// @Description  Return the authenticated user's disabled talkgroup IDs.
// @Tags         Auth,v1-Listener
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  tgSelectionResponse
// @Failure      401  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /auth/tg-selection [get]
// @Router       /v1/listener/tg-selection [get]
func (h *Handler) GetTGSelection(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(int64)

	user, err := h.queries.GetUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}

	stored := storedTGSelection(user)
	resp := tgSelectionResponse{
		DisabledTGs: []int64{},
		AvoidList:   []avoidTGEntry{},
		Version:     tgSelectionVersion(stored),
	}
	if stored != "" {
		raw := []byte(stored)

		// Current format: { disabledTGs: number[], avoidList: [{talkgroupId, expiresAt}] }
		var cur tgSelectionStored
		if err := json.Unmarshal(raw, &cur); err != nil {
			// Backward compatibility: legacy format was a bare number[]
			var legacyDisabled []int64
			if legacyErr := json.Unmarshal(raw, &legacyDisabled); legacyErr != nil {
				slog.Warn("malformed tg_selection_json", "user_id", userID, "error", err)
				// Return empty lists rather than failing
			} else {
				resp.DisabledTGs = legacyDisabled
			}
		} else {
			if cur.DisabledTGs != nil {
				resp.DisabledTGs = cur.DisabledTGs
			}
			if cur.AvoidList != nil {
				resp.AvoidList = cur.AvoidList
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

// maxTGSelectionEntries bounds each list in a stored talkgroup selection.
// It sits well above any real system's talkgroup count.
const maxTGSelectionEntries = 50000

// PutTGSelection handles PUT /api/auth/tg-selection (JWT required).
// Saves the list of talkgroup IDs the user wants disabled.
//
// @Summary      Update talkgroup selection
// @Description  Save the authenticated user's disabled talkgroup IDs. When the
// @Description  request carries the `version` returned by GET, a mismatch means
// @Description  another session saved first and the write is rejected with 409.
// @Tags         Auth,v1-Listener
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      tgSelectionRequest  true  "Disabled talkgroup IDs"
// @Success      200   {object}  object{ok=bool,version=string}
// @Failure      400   {object}  ErrorResponse
// @Failure      401   {object}  ErrorResponse
// @Failure      409   {object}  ErrorResponse
// @Failure      500   {object}  ErrorResponse
// @Router       /auth/tg-selection [put]
// @Router       /v1/listener/tg-selection [put]
func (h *Handler) PutTGSelection(c *gin.Context) {
	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(int64)

	var req tgSelectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if len(req.DisabledTGs) > maxTGSelectionEntries || len(req.AvoidList) > maxTGSelectionEntries {
		shared.WriteAPIError(c, http.StatusBadRequest, shared.CodeValidationFailed,
			"talkgroup selection has too many entries",
			map[string]any{"max": maxTGSelectionEntries})
		return
	}

	next := tgSelectionStored{DisabledTGs: req.DisabledTGs, AvoidList: req.AvoidList}
	if next.DisabledTGs == nil {
		next.DisabledTGs = []int64{}
	}
	if next.AvoidList == nil {
		next.AvoidList = []avoidTGEntry{}
	}

	// Optimistic concurrency: a client that read version X may only replace
	// version X. Without this, a tab left open from before a filtering
	// session would blind-overwrite it (re-enabling every talkgroup) the
	// next time anything in that tab changed.
	current := ""
	if user, err := h.queries.GetUser(c.Request.Context(), userID); err == nil {
		current = tgSelectionVersion(storedTGSelection(user))
	} else {
		slog.Warn("tg_selection: version precheck failed", "user_id", userID, "error", err)
	}
	if req.Version != nil && current != "" && *req.Version != current {
		slog.Info("tg_selection: rejected stale write",
			"user_id", userID,
			"client_version", *req.Version,
			"current_version", current,
			"disabled_count", len(next.DisabledTGs))
		shared.WriteAPIError(c, http.StatusConflict, shared.CodeConflict,
			"talkgroup selection was modified elsewhere",
			map[string]any{"currentVersion": current})
		return
	}

	jsonBytes, err := json.Marshal(next)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode selection"})
		return
	}

	if err := h.queries.UpdateUserTGSelection(c.Request.Context(), db.UpdateUserTGSelectionParams{
		TgSelectionJson: sql.NullString{String: string(jsonBytes), Valid: true},
		UpdatedAt:       time.Now().Unix(),
		ID:              userID,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save selection"})
		return
	}

	slog.Info("tg_selection: saved",
		"user_id", userID,
		"disabled_count", len(next.DisabledTGs),
		"avoid_count", len(next.AvoidList))

	c.JSON(http.StatusOK, gin.H{"ok": true, "version": tgSelectionVersion(string(jsonBytes))})
}

// PostDocsSession handles POST /api/admin/docs/session.
// It mints a short-lived HTTP-only cookie so Swagger UI can be opened in a new
// browser tab without exposing the JWT. Kept in the auth package because it is
// fundamentally a session-cookie-minting endpoint.
//
// @Summary      Create Swagger docs session cookie
// @Description  Issues a short-lived HTTP-only cookie used to access /api/admin/docs.
// @Tags         Admin,v1-Admin
// @Produce      json
// @Success      200  {object}  object{ok=bool}
// @Security     BearerAuth
// @Router       /admin/docs/session [post]
// @Router       /v1/admin/docs/session [post]
func PostDocsSession(c *gin.Context) {
	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	auth.SetSwaggerCookie(c, secure)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
