package middleware

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// JWTAuth validates a Bearer JWT and stores userID, username, and role in the
// Gin context. Aborts with 401 if the token is missing or invalid.
func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			slog.Debug("middleware: jwt auth failed, no bearer header", "path", c.Request.URL.Path)
			c.AbortWithStatusJSON(401, gin.H{"error": "authorization header required"})
			return
		}

		tokenStr := strings.TrimPrefix(header, "Bearer ")
		claims, err := auth.ParseToken(tokenStr)
		if err != nil {
			c.AbortWithStatusJSON(401, gin.H{"error": "invalid or expired token"})
			return
		}

		if auth.Tokens.Rejects(claims) {
			c.AbortWithStatusJSON(401, gin.H{"error": "token has been revoked"})
			return
		}

		// Check account expiration embedded in JWT claims (OWASP A01).
		if claims.AccountExp > 0 && time.Now().Unix() > claims.AccountExp {
			c.AbortWithStatusJSON(401, gin.H{"error": "account expired"})
			return
		}

		slog.Debug("middleware: jwt auth success", "user_id", claims.UserID, "role", claims.Role)
		c.Set("userID", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Set("jti", claims.ID)
		c.Set("fam", claims.FamilyID)
		c.Next()
	}
}

// OptionalJWTAuth extracts user info from a Bearer JWT if present, but does not
// abort the request when the token is missing or invalid. Useful for endpoints
// that are publicly accessible but provide extra data to authenticated users.
func OptionalJWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			c.Next()
			return
		}

		tokenStr := strings.TrimPrefix(header, "Bearer ")
		claims, err := auth.ParseToken(tokenStr)
		if err != nil {
			c.Next()
			return
		}

		if auth.Tokens.Rejects(claims) {
			c.Next()
			return
		}

		// Check account expiration embedded in JWT claims (OWASP A01).
		if claims.AccountExp > 0 && time.Now().Unix() > claims.AccountExp {
			c.Next()
			return
		}

		c.Set("userID", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Set("jti", claims.ID)
		c.Set("fam", claims.FamilyID)
		c.Next()
	}
}

// applyClaimsToContext sets the standard JWT claim values onto the Gin context.
// Shared by the bearer and session-cookie auth paths.
func applyClaimsToContext(c *gin.Context, claims *auth.Claims) {
	c.Set("userID", claims.UserID)
	c.Set("username", claims.Username)
	c.Set("role", claims.Role)
	c.Set("jti", claims.ID)
	c.Set("fam", claims.FamilyID)
}

// claimsValid runs the same revocation, expiration and account-expiration
// checks as JWTAuth/OptionalJWTAuth. Returns true when the token can be used
// to identify the user.
func claimsValid(claims *auth.Claims) bool {
	if auth.Tokens.Rejects(claims) {
		return false
	}
	if claims.AccountExp > 0 && time.Now().Unix() > claims.AccountExp {
		return false
	}
	return true
}

// OptionalJWTOrSessionAuth resolves identity from, in priority order:
//
//  1. Authorization: Bearer header (existing behaviour, unchanged).
//  2. os_session cookie (new) — only honoured when the request is same-site,
//     determined by the Sec-Fetch-Site fetch metadata header. SameSite=Strict
//     on the cookie itself already enforces same-site at the browser layer;
//     this is defence-in-depth at the server.
//  3. Anonymous (no userID set in context — downstream handlers fall back to
//     publicAccess semantics or 401 as appropriate).
//
// The middleware never aborts the request: invalid/expired/revoked credentials
// (header or cookie) silently fall through to anonymous so that the
// publicAccess setting still controls access. This mirrors OptionalJWTAuth.
func OptionalJWTOrSessionAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Bearer header takes priority.
		if header := c.GetHeader("Authorization"); strings.HasPrefix(header, "Bearer ") {
			tokenStr := strings.TrimPrefix(header, "Bearer ")
			if claims, err := auth.ParseToken(tokenStr); err == nil && claimsValid(claims) {
				applyClaimsToContext(c, claims)
			}
			c.Next()
			return
		}

		// 2. os_session cookie — only for same-site requests.
		cookieValue, err := c.Cookie(auth.SessionCookieName)
		if err != nil || cookieValue == "" {
			c.Next()
			return
		}

		// Sec-Fetch-Site is a fetch-metadata header. Browsers always send it
		// for HTTP/1.1+ requests. Acceptable values for a same-origin/same-site
		// request are "same-origin", "same-site", and "none" (the user
		// directly typed/bookmarked the URL). If the header is missing
		// (older clients, tests), fall back to trusting the SameSite=Strict
		// browser-side enforcement.
		switch c.GetHeader("Sec-Fetch-Site") {
		case "", "same-origin", "same-site", "none":
			// allowed
		default:
			// "cross-site" or any unrecognised value — refuse to authenticate
			// from the cookie. Treat as anonymous; do not 401.
			c.Next()
			return
		}

		claims, err := auth.ParseToken(cookieValue)
		if err != nil || !claimsValid(claims) {
			c.Next()
			return
		}
		applyClaimsToContext(c, claims)
		c.Next()
	}
}

// RequireAdmin checks that the authenticated user has the admin role.
// Must be chained after JWTAuth. Aborts with 403 if the role is not admin.
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		roleStr, _ := role.(string)
		if roleStr != auth.RoleAdmin {
			slog.Debug("middleware: admin check failed", "role", roleStr)
			c.AbortWithStatusJSON(403, gin.H{"error": "admin access required"})
			return
		}
		slog.Debug("middleware: admin check passed")
		c.Next()
	}
}

// APIKeyAuth reads the API key from the API-key transports allowed for the
// active API version, then looks up the key in the database and sets
// "apiKeyID" in the Gin context. Aborts with 401 if the key is missing, not
// found, or disabled.
//
// On legacy paths the three rdio-scanner-style transports are accepted, in
// priority order: X-API-Key header, ?key= query param, and (for Trunk
// Recorder's rdioscanner_uploader plugin) a multipart "key" form field.
//
// On the native /api/v1/* surface — identified by the gin context flag
// "apiVersion" == "v1", set by V1Marker() on the v1 route group — only
// Authorization: Bearer <api-key> is honoured. JWT-shaped Bearer values
// (three base64url segments separated by dots) are rejected with the
// invalid_credentials envelope so the client surfaces the right error.
//
// The API-key value format itself is unchanged; only the wire transport
// differs between the two surfaces.
func APIKeyAuth(queries *db.Queries) gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID, _ := c.Get("requestID")
		isV1 := c.GetString("apiVersion") == "v1"

		// Resolve the API key string from the transports allowed for this
		// API version. Legacy: header → query → form (rdio-scanner-shaped).
		// Native v1: Authorization: Bearer only.
		var key string
		if isV1 {
			header := c.GetHeader("Authorization")
			if strings.HasPrefix(header, "Bearer ") {
				key = strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
			}
			// Reject JWT-shaped tokens here so Bearer-JWT-on-API-key-route
			// returns the canonical invalid_credentials envelope rather than
			// "API key required".
			if key != "" && looksLikeJWT(key) {
				slog.Warn("api key auth (v1): rejected JWT-shaped bearer",
					"request_id", requestID,
					"ip", c.ClientIP(),
					"path", c.Request.URL.Path,
				)
				c.AbortWithStatusJSON(401, gin.H{
					"error": gin.H{
						"code":    "invalid_credentials",
						"message": "API key required (Authorization: Bearer)",
					},
				})
				return
			}
		} else {
			key = c.GetHeader("X-API-Key")
			if key == "" {
				key = c.Query("key")
			}
			if key == "" {
				key = c.PostForm("key")
			}
		}
		if key == "" {
			slog.Warn("api key auth: missing X-API-Key header",
				"request_id", requestID,
				"ip", c.ClientIP(),
				"path", c.Request.URL.Path,
			)
			c.AbortWithStatusJSON(401, gin.H{"error": "API key required"})
			return
		}

		// Reject implausibly long keys before hashing (defense-in-depth; real
		// keys are 64 hex chars). Prevents CPU waste on attacker-controlled input.
		if len(key) > 128 {
			slog.Warn("api key auth: oversized key rejected",
				"request_id", requestID,
				"ip", c.ClientIP(),
				"path", c.Request.URL.Path,
				"length", len(key),
			)
			c.AbortWithStatusJSON(401, gin.H{"error": "invalid API key"})
			return
		}

		hashed := auth.HashAPIKey(key)
		apiKey, err := queries.GetAPIKeyByKey(c.Request.Context(), hashed)
		if err != nil {
			slog.Warn("api key auth: invalid key",
				"request_id", requestID,
				"ip", c.ClientIP(),
				"path", c.Request.URL.Path,
			)
			c.AbortWithStatusJSON(401, gin.H{"error": "invalid API key"})
			return
		}
		if apiKey.Disabled != 0 {
			slog.Warn("api key auth: disabled key used",
				"request_id", requestID,
				"ip", c.ClientIP(),
				"path", c.Request.URL.Path,
				"api_key_id", apiKey.ID,
			)
			c.AbortWithStatusJSON(401, gin.H{"error": "API key is disabled"})
			return
		}

		c.Set("apiKeyID", apiKey.ID)
		// A scoped key may only upload to its listed systems. An unparseable
		// scope yields an empty (deny-all) list rather than no restriction.
		if grants := auth.ParseSystemGrants(apiKey.SystemsJson); grants != nil {
			c.Set(auth.APIKeySystemsContextKey, grants)
		}
		if apiKey.Ident.Valid {
			c.Set("apiKeyIdent", apiKey.Ident.String)
		}
		if apiKey.CallRateLimit.Valid {
			c.Set("apiKeyCallRate", apiKey.CallRateLimit.Int64)
		}
		slog.Debug("middleware: api key auth success",
			"api_key_id", apiKey.ID,
			"ident", apiKey.Ident.String,
			"path", c.Request.URL.Path,
		)
		c.Next()
	}
}

// looksLikeJWT returns true when s has the structural shape of a JWT:
// three non-empty base64url segments separated by two dots. Used by the v1
// APIKeyAuth path to surface a clearer error when a caller mistakenly sends
// a user JWT to an API-key-protected endpoint.
func looksLikeJWT(s string) bool {
	if len(s) < 20 {
		return false
	}
	if strings.Count(s, ".") != 2 {
		return false
	}
	parts := strings.Split(s, ".")
	for _, p := range parts {
		if p == "" {
			return false
		}
	}
	return true
}

// SwaggerCookieAuth validates the short-lived docs session cookie.
func SwaggerCookieAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		value, err := c.Cookie(auth.SwaggerCookieName)
		if err != nil || !auth.ValidateSwaggerCookie(value) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "swagger session required"})
			return
		}
		c.Next()
	}
}
