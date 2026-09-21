// Package auth provides JWT signing/verification and bcrypt password helpers.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HashAPIKey returns a stable SHA-256 hex digest of an API key.
func HashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

const (
	RoleAdmin    = "admin"
	RoleListener = "listener"

	// AccessTokenExpiry is the lifetime of short-lived JWT access tokens.
	AccessTokenExpiry = 15 * time.Minute

	// RefreshTokenExpiry is the lifetime of opaque refresh tokens (HTTP-only cookie).
	RefreshTokenExpiry = 30 * 24 * time.Hour

	// MaxRefreshFamilies is the maximum number of active refresh token families per user.
	// With access TTL = 15 min and silent refresh ≈1 min before expiry, every active
	// browser/tab consumes ~4 token slots per hour. 20 leaves comfortable headroom for
	// a typical multi-device homelab user (desktop + phone + tablet) without bloating
	// the deny list, and still bounds the impact of a stolen refresh family.
	MaxRefreshFamilies = 20
)

// JWTSecret is the HS256 signing key. It is initialised lazily:
//   - Tests may call SetJWTSecretForTest to inject a deterministic value.
//   - Production code MUST call InitJWTSecret(ctx, queries, encryptionKey) from
//     server startup, AFTER the DB and encryption key are ready, to load (or
//     generate and persist) a stable secret.
//
// If neither has happened by the time a token is signed/parsed, an emergency
// random secret is used so tests that do not exercise auth never panic — but
// a warning is logged and any issued tokens will be invalidated on restart.
var (
	jwtSecretMu  sync.RWMutex
	jwtSecretVal []byte
)

// JWTSecret returns the current signing key. Exposed for callers that embed
// the auth package in test harnesses.
func JWTSecret() []byte { //nolint:revive
	jwtSecretMu.RLock()
	if len(jwtSecretVal) > 0 {
		s := jwtSecretVal
		jwtSecretMu.RUnlock()
		return s
	}
	jwtSecretMu.RUnlock()

	// Lazy-generate a process-local random secret so unit tests that don't
	// initialise auth don't panic. Production startup should always call
	// InitJWTSecret before any request is served.
	jwtSecretMu.Lock()
	defer jwtSecretMu.Unlock()
	if len(jwtSecretVal) == 0 {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			panic("auth: failed to generate random JWT secret: " + err.Error())
		}
		jwtSecretVal = b
		slog.Warn("auth: JWT secret not initialised — generated ephemeral secret (tokens will not survive restart)")
	}
	return jwtSecretVal
}

// SetJWTSecretForTest sets the JWT signing key. Intended for tests only.
func SetJWTSecretForTest(secret []byte) {
	jwtSecretMu.Lock()
	defer jwtSecretMu.Unlock()
	jwtSecretVal = append([]byte(nil), secret...)
}

// JWTSecretKeyName is the settings row that stores the persistent JWT signing secret.
const JWTSecretKeyName = "jwtSecret"

// jwtSecretLoader abstracts the settings read/write so InitJWTSecret can accept
// *db.Queries without the auth package importing internal/db (which would
// introduce a cycle).
type jwtSecretLoader interface {
	Get(ctx context.Context, key string) (value string, err error)
	Upsert(ctx context.Context, key, value string) error
}

// InitJWTSecret loads (or creates) the persistent JWT signing secret.
//
// Resolution order:
//  1. SQUELCH_JWT_SECRET env var (treated as the raw secret string)
//  2. Encrypted "jwtSecret" row in the settings table (decrypted with encryptionKey)
//  3. Generate 32 random bytes, encrypt with encryptionKey, persist, and use
//
// When no encryption key is configured, the generated secret is stored in
// plaintext (a warning is logged). Call from cmd/server after the DB is open
// and the encryption key has been resolved.
func InitJWTSecret(ctx context.Context, loader jwtSecretLoader, encryptionKey string) error {
	// 1. Env var — highest precedence, never touches the DB.
	if v := strings.TrimSpace(os.Getenv("SQUELCH_JWT_SECRET")); v != "" {
		SetJWTSecretForTest([]byte(v))
		slog.Info("auth: JWT secret loaded from SQUELCH_JWT_SECRET")
		return nil
	}

	// 2. Settings row.
	value, err := loader.Get(ctx, JWTSecretKeyName)
	if err == nil && value != "" {
		secret, derr := decodeJWTSecretValue(value, encryptionKey)
		if derr != nil {
			return fmt.Errorf("auth: failed to decode stored JWT secret: %w", derr)
		}
		SetJWTSecretForTest(secret)
		slog.Info("auth: JWT secret loaded from settings")
		return nil
	}

	// 3. Generate and persist.
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("auth: generate JWT secret: %w", err)
	}
	stored := base64.StdEncoding.EncodeToString(raw)
	if encryptionKey != "" {
		enc, eerr := EncryptString(stored, encryptionKey)
		if eerr != nil {
			return fmt.Errorf("auth: encrypt JWT secret: %w", eerr)
		}
		stored = enc
	} else {
		slog.Warn("auth: no encryption key configured — JWT secret will be stored in plaintext",
			"impact", "anyone with read access to the database file can forge admin tokens",
			"fix", "set SQUELCH_ENCRYPTION_KEY, or provide SQUELCH_JWT_SECRET to bypass DB storage entirely")
	}
	if err := loader.Upsert(ctx, JWTSecretKeyName, stored); err != nil {
		return fmt.Errorf("auth: persist JWT secret: %w", err)
	}
	SetJWTSecretForTest(raw)
	slog.Info("auth: JWT secret generated and persisted")
	return nil
}

// decodeJWTSecretValue decrypts (if needed) and base64-decodes a stored JWT secret value.
func decodeJWTSecretValue(stored, encryptionKey string) ([]byte, error) {
	val := stored
	if IsEncrypted(val) {
		if encryptionKey == "" {
			return nil, errors.New("jwt secret is encrypted but no encryption key is configured")
		}
		plain, err := DecryptString(val, encryptionKey)
		if err != nil {
			return nil, fmt.Errorf("decrypt: %w", err)
		}
		val = plain
	}
	raw, err := base64.StdEncoding.DecodeString(val)
	if err != nil {
		// Legacy / env-supplied values may be raw strings, not base64.
		return []byte(val), nil //nolint:nilerr // fall back to raw bytes for legacy secrets
	}
	return raw, nil
}

// DummyHash is a pre-computed bcrypt cost-12 hash used to normalise response
// timing in the login handler, preventing username enumeration via timing
// side-channel (OWASP A07 / timing attack mitigation).
var DummyHash string

// Tokens is the global token tracker. Initialised by init().
var Tokens *TokenTracker

func init() {
	h, err := bcrypt.GenerateFromPassword([]byte(""), 12)
	if err != nil {
		panic("auth: failed to generate dummy bcrypt hash: " + err.Error())
	}
	DummyHash = string(h)
	Tokens = NewTokenTracker()
}

// Claims is the JWT payload.
type Claims struct {
	UserID     int64  `json:"userId"`
	Username   string `json:"username"`
	Role       string `json:"role"`
	AccountExp int64  `json:"accountExp,omitempty"` // unix epoch; 0 = never expires
	jwt.RegisteredClaims
}

// HashPassword hashes a plaintext password using bcrypt with cost 12.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword reports whether the plaintext password matches the bcrypt hash.
func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// GenerateToken signs a new HS256 JWT for the given user, valid for AccessTokenExpiry.
// accountExp is the user's account expiration as a unix epoch (0 means no expiry).
// Returns the signed token string and the unique JTI (token ID).
func GenerateToken(userID int64, username, role string, accountExp int64) (string, string, error) {
	now := time.Now()
	jti := uuid.New().String()
	claims := Claims{
		UserID:     userID,
		Username:   username,
		Role:       role,
		AccountExp: accountExp,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenExpiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(JWTSecret())
	slog.Debug("auth: token generated", "user_id", userID, "username", username, "role", role, "jti", jti)
	return signed, jti, err
}

// GenerateRefreshToken creates a cryptographically random opaque refresh token.
// Returns the raw hex-encoded token (for the cookie) and its SHA-256 hash (for DB storage).
func GenerateRefreshToken() (raw string, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(b)
	h := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(h[:])
	return raw, hash, nil
}

// HashRefreshToken returns the SHA-256 hex digest of a raw refresh token.
func HashRefreshToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// TokenTracker tracks active JWTs per user. When a user exceeds MaxTokens
// the oldest token is invalidated by adding it to a deny-list.
type TokenTracker struct {
	mu         sync.Mutex
	MaxTokens  int
	userTokens map[int64][]tokenEntry
	denied     map[string]time.Time // JTI → expiry time
	validFrom  int64                // unix seconds; tokens issued earlier are rejected
}

type tokenEntry struct {
	JTI       string
	ExpiresAt time.Time
}

// NewTokenTracker creates a TokenTracker with a default max of MaxRefreshFamilies
// active tokens per user.
func NewTokenTracker() *TokenTracker {
	return &TokenTracker{
		MaxTokens:  MaxRefreshFamilies,
		userTokens: make(map[int64][]tokenEntry),
		denied:     make(map[string]time.Time),
		validFrom:  time.Now().Unix(),
	}
}

// Track records a new token for the given user. If the user already has
// MaxTokens active tokens, the oldest is moved to the deny list.
func (tt *TokenTracker) Track(userID int64, jti string, expiresAt time.Time) {
	tt.mu.Lock()
	defer tt.mu.Unlock()

	slog.Debug("auth: tracking token", "user_id", userID, "jti", jti)
	tt.cleanupLocked()

	entries := tt.userTokens[userID]
	if len(entries) >= tt.MaxTokens {
		// Revoke the oldest token.
		tt.denied[entries[0].JTI] = entries[0].ExpiresAt
		entries = entries[1:]
	}
	tt.userTokens[userID] = append(entries, tokenEntry{JTI: jti, ExpiresAt: expiresAt})
}

// IsRevoked reports whether the given JTI has been revoked.
func (tt *TokenTracker) IsRevoked(jti string) bool {
	tt.mu.Lock()
	defer tt.mu.Unlock()
	exp, ok := tt.denied[jti]
	if !ok {
		slog.Debug("auth: revocation check", "jti", jti, "revoked", false)
		return false
	}
	// Lazily clean up expired denied entries.
	if time.Now().After(exp) {
		delete(tt.denied, jti)
		slog.Debug("auth: revocation check (expired denial)", "jti", jti, "revoked", false)
		return false
	}
	slog.Debug("auth: revocation check", "jti", jti, "revoked", true)
	return true
}

// Rejects reports whether an access token must not be honoured: its JTI was
// revoked, or it was issued before this tracker (and so this process)
// started. Revocations live only in memory, so without the second rule a
// token from an earlier run would survive a disable, demotion, deletion,
// password change or logout that straddled a restart. Clients recover by
// refreshing, and refresh re-checks the account in the database.
func (tt *TokenTracker) Rejects(claims *Claims) bool {
	if claims.IssuedAt == nil || claims.IssuedAt.Unix() < tt.validFrom {
		slog.Debug("auth: token predates this process", "jti", claims.ID)
		return true
	}
	return tt.IsRevoked(claims.ID)
}

// Revoke adds a single JTI to the deny list with an AccessTokenExpiry expiry.
func (tt *TokenTracker) Revoke(jti string) {
	tt.mu.Lock()
	defer tt.mu.Unlock()
	tt.denied[jti] = time.Now().Add(AccessTokenExpiry)
}

// RevokeAllForUser revokes all tokens for a user.
func (tt *TokenTracker) RevokeAllForUser(userID int64) {
	tt.mu.Lock()
	defer tt.mu.Unlock()
	slog.Debug("auth: revoking all tokens for user", "user_id", userID, "count", len(tt.userTokens[userID]))
	for _, e := range tt.userTokens[userID] {
		tt.denied[e.JTI] = e.ExpiresAt
	}
	delete(tt.userTokens, userID)
}

// cleanupLocked removes expired entries from both userTokens and denied.
// Must be called with tt.mu held.
func (tt *TokenTracker) cleanupLocked() {
	now := time.Now()
	for uid, entries := range tt.userTokens {
		valid := entries[:0]
		for _, e := range entries {
			if e.ExpiresAt.After(now) {
				valid = append(valid, e)
			} else {
				delete(tt.denied, e.JTI)
			}
		}
		if len(valid) == 0 {
			delete(tt.userTokens, uid)
		} else {
			tt.userTokens[uid] = valid
		}
	}
	// Also clean expired entries from the denied map (including orphans from RevokeAllForUser).
	for jti, exp := range tt.denied {
		if now.After(exp) {
			delete(tt.denied, jti)
		}
	}
}

// ParseToken verifies and parses a signed JWT string, returning the Claims on success.
func ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return JWTSecret(), nil
	})
	if err != nil {
		slog.Debug("auth: token parse failed", "error", err)
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		slog.Debug("auth: token parse invalid claims")
		return nil, jwt.ErrTokenInvalidClaims
	}
	slog.Debug("auth: token parsed", "user_id", claims.UserID, "role", claims.Role)
	return claims, nil
}

// swaggerCookieName is the cookie name used for Swagger UI session auth.
const SwaggerCookieName = "os_swagger"

// SetSwaggerCookie sets a short-lived, HTTP-only, SameSite=Strict cookie
// that authorises access to the Swagger UI docs route.
// The cookie value is an HMAC-SHA256 of "swagger:<expiry>" signed with JWTSecret.
// When secure is true the cookie is marked Secure (HTTPS-only).
func SetSwaggerCookie(c interface {
	SetSameSite(http.SameSite)
	SetCookie(name, value string, maxAge int, path, domain string, secure, httpOnly bool)
}, secure bool) {
	const maxAge = 3600 // 1 hour
	expiry := time.Now().Add(time.Duration(maxAge) * time.Second).Unix()
	payload := fmt.Sprintf("swagger:%d", expiry)
	mac := hmac.New(sha256.New, JWTSecret())
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))
	value := fmt.Sprintf("%d.%s", expiry, sig)

	c.SetSameSite(http.SameSiteStrictMode)
	// Path "/api" so the cookie is sent on both the legacy
	// /api/admin/docs/* route and the v1 /api/v1/admin/docs/* route.
	c.SetCookie(SwaggerCookieName, value, maxAge, "/api", "", secure, true)
}

// ValidateSwaggerCookie checks that the swagger cookie value is valid and
// not expired.
func ValidateSwaggerCookie(value string) bool {
	parts := strings.SplitN(value, ".", 2)
	if len(parts) != 2 {
		return false
	}
	expiry, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return false
	}
	if time.Now().Unix() > expiry {
		return false
	}
	payload := fmt.Sprintf("swagger:%d", expiry)
	mac := hmac.New(sha256.New, JWTSecret())
	mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(parts[1]), []byte(expected))
}
