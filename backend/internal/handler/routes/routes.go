// Package routes wires all Squelch HTTP and WebSocket routes onto a Gin engine.
//
// It owns the top-level route registration and middleware ordering, and delegates
// per-feature handling to the handler subpackages (auth, calls, bookmarks, share,
// setup, health, and admin/*).
package routes

import (
	"database/sql"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	"github.com/revtex/squelch/docs" // swagger generated docs

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/downstream"
	"github.com/revtex/squelch/internal/handler/admin/imports"
	"github.com/revtex/squelch/internal/handler/admin/legacyusage"
	"github.com/revtex/squelch/internal/handler/admin/radioreference"
	"github.com/revtex/squelch/internal/handler/admin/transcriptions"
	trmqttadmin "github.com/revtex/squelch/internal/handler/admin/trmqtt"
	authhandler "github.com/revtex/squelch/internal/handler/auth"
	"github.com/revtex/squelch/internal/handler/bookmarks"
	"github.com/revtex/squelch/internal/handler/calls"
	"github.com/revtex/squelch/internal/handler/health"
	"github.com/revtex/squelch/internal/handler/setup"
	"github.com/revtex/squelch/internal/handler/share"
	streamhandler "github.com/revtex/squelch/internal/handler/stream"
	"github.com/revtex/squelch/internal/middleware"
	"github.com/revtex/squelch/internal/static"
	streamsvc "github.com/revtex/squelch/internal/stream"
	"github.com/revtex/squelch/internal/trmqtt"
	"github.com/revtex/squelch/internal/ws"
)

// DirMonitorReloader is implemented by dirmonitor.Service to trigger a config reload.
type DirMonitorReloader interface {
	Reload()
}

// DownstreamReloader is implemented by downstream.Service to trigger a config reload.
type DownstreamReloader interface {
	Reload()
}

// DownstreamNotifier sends call events to downstream pushers.
type DownstreamNotifier interface {
	Notify(event downstream.CallEvent)
}

// Deps holds the dependencies required to register all API routes.
type Deps struct {
	Queries            *db.Queries
	RateLimiter        *auth.RateLimiter
	Processor          *audio.Processor
	Hub                *ws.Hub
	SQLDB              *sql.DB
	DirMonitorReloader DirMonitorReloader
	DownstreamReloader DownstreamReloader
	DownstreamNotifier DownstreamNotifier
	Transcriber        audio.Transcriber // nil when transcription is disabled
	Version            string
	FFmpegAvailable    bool
	FDKAACAvailable    bool
	WhisperAvailable   bool
	TRMqttManager      *trmqtt.Manager // nil when feature disabled
	EncryptionKey      string
	// StreamManager backs the continuous listener audio stream. Nil (or
	// not started) leaves the endpoint responding 503 rather than absent,
	// so clients get a clear answer instead of a 404.
	StreamManager *streamsvc.Manager
}

// RegisterRoutes wires all API routes onto the Gin engine.
func RegisterRoutes(r *gin.Engine, deps Deps) {
	// The @version annotation in main.go is a build-time literal that goes
	// stale the moment a release is cut, so report the binary's real version
	// instead. Empty in tests, which pass a zero Deps.
	if deps.Version != "" {
		docs.SwaggerInfo.Version = deps.Version
	}

	healthHandler := health.New(deps.Version)
	setupHandler := setup.New(deps.Queries)
	// Avoid the typed-nil interface footgun: only promote deps.Hub into the
	// WSDisconnecter interface when the concrete pointer is non-nil. This
	// keeps tests that pass Deps{} (no Hub) from triggering nil-pointer
	// dereferences on logout / token revocation paths.
	var disconnecter authhandler.WSDisconnecter
	if deps.Hub != nil {
		disconnecter = deps.Hub
	}
	authH := authhandler.New(deps.Queries, deps.RateLimiter, disconnecter)
	callHandler := calls.New(deps.Queries, deps.Processor, deps.Hub, deps.DownstreamNotifier, deps.Transcriber)
	shareHandler := share.New(deps.Queries, deps.Processor)
	bookmarkHandler := bookmarks.New(deps.Queries)
	importsHandler := imports.New(deps.Queries, deps.Hub)
	rrHandler := radioreference.New(deps.Queries)
	transcriptionsHandler := transcriptions.New(deps.Queries, deps.WhisperAvailable)
	legacyUsageHandler := legacyusage.New(nil, nil)
	trMqttHandler := trmqttadmin.New(deps.Queries, deps.TRMqttManager, deps.EncryptionKey)

	// Global middleware applied to every request.
	r.Use(middleware.RequestID())
	r.Use(middleware.CORS())
	r.Use(middleware.Logger())

	api := r.Group("/api")

	// Phase N-3 — RFC 8594 deprecation signalling for legacy /api/* routes.
	// Each registration below carries a `dep("/api/v1/...")` middleware that
	// emits the Deprecation/Sunset/Link headers, records an entry in the
	// 24-hour usage ring buffer, and emits a structured warn log. The map
	// is hand-built so the successor URI on the Link header is exact.
	dep := func(successor string) gin.HandlerFunc {
		return middleware.Deprecated(successor, middleware.LegacyAPISunset)
	}

	// Health check — unauthenticated.
	api.GET("/health", dep("/api/v1/health"), healthHandler.Get)

	// First-run setup — unauthenticated.
	api.GET("/setup/status", dep("/api/v1/setup/status"), setupHandler.GetSetupStatus)
	api.POST("/setup", dep("/api/v1/setup"), middleware.MaxBodySize(1<<20), setupHandler.PostSetup)

	// Auth — login and refresh are unauthenticated; the rest require a valid JWT.
	api.POST("/auth/login", dep("/api/v1/auth/login"), middleware.MaxBodySize(1<<20), middleware.RateLimit(deps.RateLimiter), authH.PostLogin)
	api.POST("/auth/refresh", dep("/api/v1/auth/refresh"), middleware.MaxBodySize(1<<20), middleware.RateLimit(deps.RateLimiter), authH.PostRefresh)

	authRequired := api.Group("/auth")
	authRequired.Use(middleware.JWTAuth())
	{
		authRequired.POST("/logout", dep("/api/v1/auth/logout"), middleware.MaxBodySize(1<<20), authH.PostLogout)
		authRequired.PUT("/password", dep("/api/v1/auth/password"), authH.PutPassword)
		authRequired.GET("/me", dep("/api/v1/auth/me"), authH.GetMe)
		authRequired.GET("/tg-selection", dep("/api/v1/listener/tg-selection"), authH.GetTGSelection)
		authRequired.PUT("/tg-selection", dep("/api/v1/listener/tg-selection"), authH.PutTGSelection)
	}

	// Call search — public access with optional auth for bookmarks.
	api.GET("/calls", dep("/api/v1/calls"), middleware.OptionalJWTAuth(), callHandler.GetCalls)
	api.GET("/calls/:id/audio", dep("/api/v1/calls/:id/audio"), middleware.OptionalJWTOrSessionAuth(), callHandler.GetCallAudio)
	api.GET("/calls/:id/transcript", dep("/api/v1/calls/:id/transcript"), middleware.OptionalJWTAuth(), callHandler.GetCallTranscript)

	// Shared calls — token-based public access (no auth required).
	// Rate-limited to 30 req/min per IP to prevent bandwidth exhaustion.
	sharedRateLimit := middleware.RateLimitByIP(30)
	api.GET("/shared/:token", dep("/api/v1/shared/:token"), sharedRateLimit, shareHandler.GetSharedCallByToken)
	api.GET("/shared/:token/audio", dep("/api/v1/shared/:token/audio"), sharedRateLimit, shareHandler.GetSharedCallAudio)

	// Share management — JWT required.
	api.POST("/calls/:id/share", dep("/api/v1/calls/:id/share"), middleware.JWTAuth(), shareHandler.PostShareCall)
	api.DELETE("/calls/:id/share", dep("/api/v1/calls/:id/share"), middleware.JWTAuth(), shareHandler.DeleteShareCall)
	api.GET("/calls/:id/share", dep("/api/v1/calls/:id/share"), middleware.JWTAuth(), shareHandler.GetCallShare)

	// Bookmarks — JWT required.
	bookmarksGroup := api.Group("/bookmarks")
	bookmarksGroup.Use(middleware.JWTAuth())
	{
		bookmarksGroup.GET("", dep("/api/v1/bookmarks"), bookmarkHandler.GetBookmarkIDs)
		bookmarksGroup.GET("/calls", dep("/api/v1/bookmarks/calls"), bookmarkHandler.GetBookmarkCalls)
		bookmarksGroup.POST("", dep("/api/v1/bookmarks"), bookmarkHandler.PostToggleBookmark)
	}

	// Call upload — API key auth.
	// Pre-auth body-size cap (50 MiB) prevents unauthenticated clients from
	// consuming memory/bandwidth before the API key is validated.
	upload := r.Group("/")
	upload.Use(middleware.MaxBodySize(50<<20), middleware.APIKeyAuth(deps.Queries))
	{
		upload.POST("/api/call-upload", dep("/api/v1/calls"), callHandler.PostCallUpload)
		upload.POST("/api/trunk-recorder-call-upload", dep("/api/v1/calls"), callHandler.PostCallUpload)
	}

	// Admin routes — JWT + admin role required.
	admin := api.Group("/admin")
	admin.Use(middleware.JWTAuth(), middleware.RequireAdmin(), middleware.MaxBodySize(2<<20)) // 2 MiB JSON body limit
	{
		// Import (file uploads — must stay REST)
		admin.POST("/import/talkgroups", dep("/api/v1/admin/import/talkgroups"), importsHandler.ImportTalkgroups)
		admin.POST("/import/units", dep("/api/v1/admin/import/units"), importsHandler.ImportUnits)
		admin.POST("/import/groups", dep("/api/v1/admin/import/groups"), importsHandler.ImportGroups)
		admin.POST("/import/tags", dep("/api/v1/admin/import/tags"), importsHandler.ImportTags)

		// RadioReference CSV preview (file upload — must stay REST)
		admin.POST("/radioreference/preview/csv", dep("/api/v1/admin/radioreference/preview"), rrHandler.PreviewCSV)

		// Transcription status
		admin.GET("/transcriptions/status", dep("/api/v1/admin/transcriptions/status"), transcriptionsHandler.GetStatus)

		// Trunk-recorder MQTT instances (gated by trMqttEnabled setting).
		admin.GET("/tr/instances", dep("/api/v1/admin/tr/instances"), trMqttHandler.ListInstances)
		admin.POST("/tr/instances", dep("/api/v1/admin/tr/instances"), trMqttHandler.CreateInstance)
		admin.PATCH("/tr/instances/:id", dep("/api/v1/admin/tr/instances/:id"), trMqttHandler.UpdateInstance)
		admin.DELETE("/tr/instances/:id", dep("/api/v1/admin/tr/instances/:id"), trMqttHandler.DeleteInstance)
		admin.POST("/tr/instances/:id/test", dep("/api/v1/admin/tr/instances/:id/test"), trMqttHandler.TestInstance)
		admin.POST("/tr/instances/:id/reconnect", dep("/api/v1/admin/tr/instances/:id/reconnect"), trMqttHandler.ReconnectInstance)
		admin.GET("/tr/instances/:id/snapshot", dep("/api/v1/admin/tr/instances/:id/snapshot"), trMqttHandler.GetSnapshot)

		// Swagger: issue a short-lived HTTP-only cookie so Swagger UI
		// can be opened in a new browser tab without exposing the JWT.
		admin.POST("/docs/session", dep("/api/v1/admin/docs/session"), authhandler.PostDocsSession)
	}

	// Swagger API documentation — protected by the HTTP-only cookie
	// set via POST /api/admin/docs/session above.
	swaggerDocs := api.Group("/admin/docs")
	swaggerDocs.Use(middleware.SwaggerCookieAuth())
	{
		swaggerDocs.GET("/*any", dep("/api/v1/admin/docs/*any"), ginSwagger.WrapHandler(swaggerFiles.Handler))
	}

	// WebSocket endpoints.
	// /api/ws is the canonical Squelch listener route. /ws is a temporary
	// compatibility alias that delegates to the same handler so existing
	// rdio-scanner-shaped clients keep working during the legacy-API transition.
	listenerWS := gin.WrapF(ws.HandleListenerWS(deps.Hub, deps.Queries))
	r.GET("/api/ws", dep("/api/v1/ws/listener"), listenerWS)
	r.GET("/ws", dep("/api/v1/ws/listener"), listenerWS)
	r.GET("/api/admin/ws", dep("/api/v1/ws/admin"), gin.WrapF(ws.HandleAdminWS(deps.Hub, deps.Queries)))

	// Native (v1) WebSocket endpoints. Registered on the root router rather
	// than inside the /api/v1 group because the V1ErrorEnvelope middleware
	// buffers HTTP response bodies, which would corrupt the WebSocket upgrade.
	r.GET("/api/v1/ws/listener", gin.WrapF(ws.HandleListenerWSv1(deps.Hub, deps.Queries)))
	r.GET("/api/v1/ws/admin", gin.WrapF(ws.HandleAdminWSv1(deps.Hub, deps.Queries)))

	// ----- Native API (Phase N-1, plan §4.1) ---------------------------------
	// All v1 routes carry the V1Marker so version-aware middleware can branch,
	// and the V1ErrorEnvelope rewriter normalises any 4xx/5xx body emitted by
	// shared handlers into the native {error:{code,message,details}} shape.
	v1 := r.Group("/api/v1")
	v1.Use(middleware.V1Marker(), middleware.V1ErrorEnvelope())

	// Unauthenticated.
	v1.GET("/health", healthHandler.Get)
	v1.GET("/setup/status", setupHandler.GetSetupStatus)
	v1.POST("/setup", middleware.MaxBodySize(1<<20), setupHandler.PostSetup)
	v1.POST("/auth/login", middleware.MaxBodySize(1<<20), middleware.RateLimit(deps.RateLimiter), authH.PostLogin)
	v1.POST("/auth/refresh", middleware.MaxBodySize(1<<20), middleware.RateLimit(deps.RateLimiter), authH.PostRefresh)

	// Public call surfaces (optional auth, share links).
	v1.GET("/calls", middleware.OptionalJWTAuth(), callHandler.GetCalls)
	v1.GET("/calls/:id/audio", middleware.OptionalJWTOrSessionAuth(), callHandler.GetCallAudio)
	// Same auth as call audio: a media element cannot send an
	// Authorization header, so the session cookie has to be accepted.
	v1.GET("/listener/stream", middleware.OptionalJWTOrSessionAuth(),
		streamhandler.New(deps.StreamManager, deps.Queries).GetStream)
	v1.GET("/calls/:id/transcript", middleware.OptionalJWTAuth(), callHandler.GetCallTranscript)
	v1SharedRateLimit := middleware.RateLimitByIP(30)
	v1.GET("/shared/:token", v1SharedRateLimit, shareHandler.GetSharedCallByToken)
	v1.GET("/shared/:token/audio", v1SharedRateLimit, shareHandler.GetSharedCallAudio)

	// JWT-protected v1 routes.
	v1Auth := v1.Group("")
	v1Auth.Use(middleware.JWTAuth())
	{
		v1Auth.POST("/auth/logout", middleware.MaxBodySize(1<<20), authH.PostLogout)
		v1Auth.PUT("/auth/password", authH.PutPassword)
		v1Auth.GET("/auth/me", authH.GetMe)
		// /api/auth/tg-selection is renamed to /api/v1/listener/tg-selection
		// per plan §4.1; the handler body is reused unchanged.
		v1Auth.GET("/listener/tg-selection", authH.GetTGSelection)
		v1Auth.PUT("/listener/tg-selection", authH.PutTGSelection)
		v1Auth.POST("/calls/:id/share", shareHandler.PostShareCall)
		v1Auth.DELETE("/calls/:id/share", shareHandler.DeleteShareCall)
		v1Auth.GET("/calls/:id/share", shareHandler.GetCallShare)
		v1Auth.GET("/bookmarks", bookmarkHandler.GetBookmarkIDs)
		v1Auth.GET("/bookmarks/calls", bookmarkHandler.GetBookmarkCalls)
		v1Auth.POST("/bookmarks", bookmarkHandler.PostToggleBookmark)
	}

	// Native upload — Authorization: Bearer <api-key> only (enforced by
	// APIKeyAuth's v1 branch, keyed off V1Marker).
	v1Upload := v1.Group("")
	v1Upload.Use(middleware.MaxBodySize(50<<20), middleware.APIKeyAuth(deps.Queries))
	{
		v1Upload.POST("/calls", callHandler.PostCallUploadV1)
		v1Upload.POST("/calls/test", callHandler.PostCallsTestV1)
	}

	// Admin v1 routes.
	v1Admin := v1.Group("/admin")
	v1Admin.Use(middleware.JWTAuth(), middleware.RequireAdmin(), middleware.MaxBodySize(2<<20))
	{
		v1Admin.POST("/import/talkgroups", importsHandler.ImportTalkgroups)
		v1Admin.POST("/import/units", importsHandler.ImportUnits)
		v1Admin.POST("/import/groups", importsHandler.ImportGroups)
		v1Admin.POST("/import/tags", importsHandler.ImportTags)
		// Plan §4.1 drops the trailing `/csv` segment on the v1 path.
		v1Admin.POST("/radioreference/preview", rrHandler.PreviewCSV)
		v1Admin.GET("/transcriptions/status", transcriptionsHandler.GetStatus)
		v1Admin.GET("/legacy-usage", legacyUsageHandler.GetUsage)
		v1Admin.POST("/docs/session", authhandler.PostDocsSession)

		// Trunk-recorder MQTT instances (gated by trMqttEnabled setting).
		v1Admin.GET("/tr/instances", trMqttHandler.ListInstances)
		v1Admin.POST("/tr/instances", trMqttHandler.CreateInstance)
		v1Admin.PATCH("/tr/instances/:id", trMqttHandler.UpdateInstance)
		v1Admin.DELETE("/tr/instances/:id", trMqttHandler.DeleteInstance)
		v1Admin.POST("/tr/instances/:id/test", trMqttHandler.TestInstance)
		v1Admin.POST("/tr/instances/:id/reconnect", trMqttHandler.ReconnectInstance)
		v1Admin.GET("/tr/instances/:id/snapshot", trMqttHandler.GetSnapshot)
	}
	v1SwaggerDocs := v1.Group("/admin/docs")
	v1SwaggerDocs.Use(middleware.SwaggerCookieAuth())
	{
		v1SwaggerDocs.GET("/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
	}

	// Serve embedded frontend (SPA mode).
	serveFrontend(r)
}

// serveFrontend serves the embedded frontend dist/ as a SPA.
// Non-API, non-WS routes serve static files; unmatched paths fall back to index.html.
func serveFrontend(r *gin.Engine) {
	distFS, err := fs.Sub(static.DistFS, "dist")
	if err != nil {
		slog.Warn("embedded frontend not available", "error", err)
		return
	}

	// Check if the embedded FS has an index.html (i.e. a real build was embedded).
	if _, err := fs.Stat(distFS, "index.html"); err != nil {
		slog.Warn("no embedded frontend found — run frontend build and rebuild backend to embed")
		return
	}

	fileServer := http.FileServer(http.FS(distFS))

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// Don't serve frontend for API or WS paths.
		if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/ws") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		// Machine-fetched well-known documents must never fall through to
		// index.html. RFC 8615 paths and the legacy root-level Apple
		// association file are requested by verifiers that expect JSON (or
		// a clean 404 meaning "this server has no such association"); the
		// SPA fallback answered both with HTTP 200 and an HTML body, which
		// a verifier reports as a malformed file rather than a missing one.
		// Nothing is served here yet — this only makes the absence honest.
		if strings.HasPrefix(path, "/.well-known/") || path == "/apple-app-site-association" {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}

		// Try to serve the exact file (JS, CSS, images, etc.).
		if f, err := distFS.Open(strings.TrimPrefix(path, "/")); err == nil {
			f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}

		// SPA fallback: serve index.html for client-side routing.
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}
