# syntax=docker/dockerfile:1.6
# ─────────────────────────────────────────────────────────────────────────────
# XCO MCP Client — production Docker image
#
# Stage 1: build the React UI → frontend/dist
# Stage 2: Python runtime + built UI, single port (5174)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: frontend build ─────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build

# Install deps with reproducible lockfile
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source. The .dockerignore filters out node_modules + dist;
# everything else (src, scripts, configs, etc.) comes in wholesale so
# new top-level files don't keep going stale here. Was previously a
# brittle per-file list — broke when `frontend/scripts/gen-tool-types.mjs`
# was added (the build now runs `gen-tools && tsc && vite build`).
COPY frontend/ ./

RUN npm run build


# ── Stage 2: Python runtime ─────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Minimal system deps: ca-certificates (TLS to the MCP server) + curl
# (the HEALTHCHECK below).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd --create-home --uid 1000 app
WORKDIR /app

# Install Python deps first (cached when requirements unchanged)
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy the whole backend tree. The .dockerignore filters out secrets,
# caches, docs, audit logs, etc. — so this is safe AND robust against
# the package extractions we keep doing (agent.py → agent/, the
# core/ ambient/ cross_fabric/ nl/ health_watcher/ packages, etc.).
# Previously each file was listed by hand and went stale each time we
# split a module.
COPY backend/ /app/backend/

# Built frontend from stage 1 (backend serves it at /)
COPY --from=frontend-builder /build/dist /app/frontend/dist

# Dedicated data directory — audit log lives here so a volume can be
# mounted at /app/data (Docker volumes mount over directories, not files).
RUN mkdir -p /app/data && chown -R app:app /app
ENV AUDIT_LOG_PATH=/app/data/audit.log

# ── Demo default (OVERRIDE via -e / --env-file) ──────────────────────────────
# Community edition: point at your auth-free community MCP server. There is NO
# authentication — no OAuth2, no client id/secret. MCP_BASE_URL assumes the
# server runs in Docker on the same host (add --add-host on Linux).
ENV MCP_BASE_URL=http://host.docker.internal:8000

USER app
WORKDIR /app/backend

EXPOSE 5174

# Health check — backend exposes /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:5174/api/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5174"]
