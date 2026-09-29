# Squelch — multi-stage build

# Stage 1: Build frontend (must run before Go so go:embed has files to embed)
FROM node:22-alpine AS node-builder
WORKDIR /src/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

# Stage 2: Build Go binary with embedded frontend
FROM golang:1.26-alpine AS go-builder
ARG VERSION=dev
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
RUN go install github.com/swaggo/swag/cmd/swag@v1.16.4
COPY backend/ .
# Copy the built frontend dist into the go:embed target path
COPY --from=node-builder /src/frontend/dist ./internal/static/dist/
# Generate Swagger docs (gitignored, must be built in CI)
RUN swag init -d cmd/server,internal/handler -g main.go --parseDependency --parseInternal
RUN go build -ldflags="-s -w -X github.com/revtex/squelch/internal/config.Version=${VERSION}" -o /squelch ./cmd/server
# squelch-rekey re-encrypts secrets after the v3.0.0 key-derivation
# change. It ships in the image because the operators who need it are
# running the container, and the server refuses to start until it has
# been run. It needs --entrypoint, because the image's entrypoint execs
# the server: `docker compose run --rm --no-deps --user 1001 \
#   --entrypoint ./squelch-rekey squelch -db /data/squelch.db`.
RUN go build -ldflags="-s -w" -o /squelch-rekey ./cmd/rekey

# Stage 3: Minimal runtime image
FROM alpine:3.21
RUN apk add --no-cache ffmpeg ca-certificates tzdata su-exec && \
  adduser -D -u 1001 appuser && \
  mkdir -p /data/recordings && chown -R appuser:appuser /data
WORKDIR /app
COPY --from=go-builder /squelch ./squelch
COPY --from=go-builder /squelch-rekey ./squelch-rekey
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh
# Defaults for standalone docker run; override via environment or compose.
ENV SQUELCH_LISTEN=0.0.0.0:3022
ENV SQUELCH_DB_FILE=/data/squelch.db
ENV SQUELCH_RECORDINGS_DIR=/data/recordings
EXPOSE 3022
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3022/api/v1/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
