# syntax=docker/dockerfile:1.6
# DaShengOS sandbox · v0.3 Phase 4
#
# Multi-stage build:
#   - builder: golang:1.23-alpine compiles both binaries
#   - runtime: distroless/static (~2MB) for production-hardened, no-shell image
#
# Build:
#   docker build -t dasheng/sandbox:v0.3.0-phase4 -f deploy/Dockerfile .
#
# Run:
#   docker run --rm -v /tmp/dasheng:/tmp/dasheng dasheng/sandbox:v0.3.0-phase4
#   docker run --rm -v /tmp/dasheng:/tmp/dasheng dasheng/sandbox:v0.3.0-phase4 /supervisord

FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git ca-certificates
WORKDIR /build

# Cache go mod downloads
COPY go.mod go.sum* ./
RUN go mod download || true

COPY . .

# Build both binaries (CGO_ENABLED=0 for static distroless runtime)
ARG VERSION=v0.3.0-phase4
ARG COMMIT=unknown
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
    -o /out/sandbox ./cmd/sandbox
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o /out/supervisord ./cmd/supervisord

# ----------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

# Copy both binaries
COPY --from=builder /out/sandbox /sandbox
COPY --from=builder /out/supervisord /supervisord

# Pre-create runtime dirs (distroless has no shell, but volumes work fine)
# Run as nonroot user (uid 65532)
USER nonroot:nonroot

# Default to sandbox daemon; override with [/supervisord] for supervisord mode
ENV DASHE_SANDBOX_SOCKET=/tmp/dasheng/sandbox.sock
ENV DASHE_CONTROL_SOCKET=/tmp/dasheng/sandbox.sock

# Healthcheck (distroless has no curl; supervisord brings its own)
# HEALTHCHECK --interval=30s --timeout=3s CMD ...

# Socket + log dirs are volumes
VOLUME ["/tmp/dasheng"]

EXPOSE 8000

ENTRYPOINT ["/sandbox"]
CMD []
