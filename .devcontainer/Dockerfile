FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# System packages: FFmpeg, SQLite, build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sqlite3 \
    build-essential \
    ripgrep \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Go (installed directly to avoid Podman /tmp tmpfs issues with devcontainer features)
ARG GO_VERSION=1.26.4
RUN curl -sSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    | tar -xz -C /usr/local
ENV PATH="/usr/local/go/bin:/home/vscode/go/bin:${PATH}"
ENV GOPATH="/home/vscode/go"

# Node.js (installed directly to avoid Podman /tmp tmpfs issues with devcontainer features)
ARG NODE_VERSION=22
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm

# sqlc
ARG SQLC_VERSION=1.27.0
RUN curl -sSL "https://github.com/sqlc-dev/sqlc/releases/download/v${SQLC_VERSION}/sqlc_${SQLC_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin sqlc

# golang-migrate
ARG MIGRATE_VERSION=4.18.1
RUN curl -sSL "https://github.com/golang-migrate/migrate/releases/download/v${MIGRATE_VERSION}/migrate.linux-amd64.tar.gz" \
    | tar -xz -C /usr/local/bin migrate

# golangci-lint (installed from source to match Go version)
RUN go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# swag (Swagger doc generator)
RUN GOBIN=/usr/local/bin go install github.com/swaggo/swag/cmd/swag@v1.16.4

# air (Go hot-reload)
RUN GOBIN=/usr/local/bin go install github.com/air-verse/air@latest

# Ensure GOPATH dirs exist and are owned by vscode
RUN mkdir -p /home/vscode/go/bin /home/vscode/go/pkg && chown -R vscode:vscode /home/vscode/go
