# XCO MCP Client (Community Edition) — Docker Deployment Guide

A lean, **read-only, authentication-free** client for the community-grade
XCO MCP server (Tier-1/Tier-2 SAFE_READ tools). There is **no login, no
OAuth2, no credentials** — you only point it at a reachable community MCP
server. See [`COMMUNITY.md`](COMMUNITY.md) for what this edition includes.

The image is a single container: a FastAPI backend that proxies the MCP
server and serves the built React UI on **one port (5174)**.

---

## Prerequisites

- **Docker Engine 20.10+** (Compose v2 optional) on the target box.
- A running **community XCO MCP server** reachable from the container. It
  needs **no authentication**. Note its URL — e.g. `http://<host>:8000`
  (or `http://host.docker.internal:8000` when it runs in Docker on the
  same host; see [Networking](#networking--same-host-deployment)).
- That's it. No client credentials, no OAuth2 client registration.

---

## Quick start

### 1. Install Docker (if needed)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

### 2. Load the image

If you received the image as a file (the normal distribution path):

```bash
docker load < xco-mcp-client-community-<date>.tar.gz
```

The tarball carries two tags for the same image — a dated one and
`:latest` — so the `docker run … xco-mcp-client-community:latest` commands
below work as-is. Confirm:

```bash
docker images | grep xco-mcp-client-community
```

> **Building from source instead?** From the repo root:
> `docker build -t xco-mcp-client-community:latest .`
> (Stage 1 builds the UI with Node; stage 2 is the Python runtime — no
> local Node/Python needed, only Docker.)

### 3. Create a working directory

```bash
mkdir -p ~/xco-mcp-client && cd ~/xco-mcp-client
```

### 4. Create the environment file

```bash
cat > .env.docker << 'EOF'
# ── Community MCP server (required) ──────────────────────────────────────────
# Point at your auth-free community MCP server. If the server runs in Docker
# on THIS host, use host.docker.internal (see the Networking section). NO
# credentials are needed — the community server requires no authentication.
MCP_BASE_URL=http://host.docker.internal:8000

# ── Local LLM via Ollama (optional — set OLLAMA_ENABLED=1 to turn on) ────────
OLLAMA_ENABLED=0
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen2.5:3b-instruct

# ── OpenAI (optional — easier to set later from the UI → Server Settings) ────
# OPENAI_API_KEY=
# OPENAI_MODEL=gpt-4o-mini
EOF
```

### 5. Start the client

```bash
docker run -d --name xco-mcp-client \
  -p 5174:5174 \
  --env-file .env.docker \
  --add-host=host.docker.internal:host-gateway \
  -v xco-mcp-audit:/app/data \
  --restart unless-stopped \
  xco-mcp-client-community:latest
```

- `--add-host=host.docker.internal:host-gateway` lets the container reach
  services on the host (the MCP server, Ollama). Required on Linux; harmless
  on Docker Desktop.
- `-v xco-mcp-audit:/app/data` persists the audit log + UI settings across
  restarts.

### 6. Verify

```bash
# Backend health + MCP reachability
curl -s http://localhost:5174/api/health
# → {"status":"ok", ...}  (proxied from the community server's /health)

# Tool catalog (proxied from the community server, no auth)
curl -s http://localhost:5174/api/tools | python3 -c 'import sys,json;print(len(json.load(sys.stdin)),"tools")'
# → e.g. "267 tools"  (a non-empty list = the client reached the server)
```

### 7. Open the UI

Browse to `http://<box-ip>:5174`. The app loads **straight into the
dashboard — there is no login screen.** Use the AI Console (natural-language
queries), the Tools browser, and read-only Investigate.

---

## Configuration — there are no credentials

Unlike the enterprise client, the community edition performs **no
authentication** in either direction:

- It does **not** log operators in (no users, no roles, no tokens).
- It calls the community MCP server with **no `Authorization` header**.

The only runtime configuration is the **MCP server URL** plus optional
Ollama / OpenAI settings. Change the MCP URL at runtime via the UI:
**Server Settings → MCP Server URL → Save** (persisted to
`/app/data/client_settings.json`, so mount the `/app/data` volume as in
step 5 for it to survive restarts). The `.env.docker` values are only the
**initial seed** used the first time the container starts with no persisted
settings.

---

## Networking — same-host deployment

The most common setup: the community MCP server and this client both run as
**separate Docker containers on the same Linux host** (shipped and managed
independently — no shared compose file).

### The pitfall: `localhost` inside a container ≠ the host

Every container has its own loopback interface. If you set:

```
MCP_BASE_URL=http://127.0.0.1:8000     # ❌ WRONG inside a container
MCP_BASE_URL=http://localhost:8000     # ❌ WRONG inside a container
```

the client tries to connect to **the client container itself** on port 8000
— the MCP server isn't there. You'll see connection-refused / timeout, and
the UI loads but `/api/tools` is empty.

### The fix: `host.docker.internal`

Docker ships a magic hostname `host.docker.internal` that resolves to **the
host machine** from inside a container.
- **macOS / Windows** (Docker Desktop): Just Works.
- **Linux**: add `--add-host=host.docker.internal:host-gateway` (every
  example in this guide already includes it).

### Complete recipe — both containers on the same box

**Step 1.** Start the **community MCP server** (per its own guide), publishing
port 8000 to the host:

```bash
# (example — see the server's own deployment docs for exact flags)
docker run -d --name xco-mcp-server --restart unless-stopped \
  -p 8000:8000 \
  <community-mcp-server-image>
curl -s http://localhost:8000/health        # verify from the host
```

> The `-p 8000:8000` is what makes `host.docker.internal:8000` reachable
> from the client container.

**Step 2.** Start the **client** pointing at it (no credentials):

```bash
docker run -d --name xco-mcp-client --restart unless-stopped \
  -p 5174:5174 \
  -e MCP_BASE_URL=http://host.docker.internal:8000 \
  --add-host=host.docker.internal:host-gateway \
  -v xco-mcp-audit:/app/data \
  xco-mcp-client-community:latest
```

Verify end-to-end:

```bash
curl -s http://localhost:5174/api/health
# → {"status":"ok", ...}
curl -s http://localhost:5174/api/tools | head -c 120
# → a JSON array of tools, not empty
```

Open the UI: **http://\<host-ip\>:5174/**

### Quick diagnostic from inside the client container

```bash
docker exec -it xco-mcp-client sh -c 'curl -s $MCP_BASE_URL/health'
# should print: {"status":"ok", ...}
```

If that works, the client↔server path is fine. If it fails, your networking
is wrong — re-check the steps above.

### Other options (reference)

| MCP server location | `MCP_BASE_URL` |
|---|---|
| Same host, both in Docker (above) | `http://host.docker.internal:8000` (+ `--add-host`) |
| MCP server native on the host (not in Docker) | `http://host.docker.internal:8000` (same) |
| MCP server on a different host (LAN) | `http://<server-ip>:8000` (no `--add-host` needed) |
| Both containers share a user-defined network | `http://<server-container-name>:8000` (advanced) |

### Ollama (optional) — same gotcha applies

If you enable Ollama and it runs on the host, use
`OLLAMA_BASE_URL=http://host.docker.internal:11434`. Verify:

```bash
docker exec xco-mcp-client curl -fsS http://host.docker.internal:11434/api/tags
# → {"models":[…]}
```

---

## Persistent data

The container writes under `/app/data`:

- `audit.log` — append-only JSONL of operator-visible events (UI →
  **Activity Log**).
- `client_settings.json` — written when you change settings in the UI.

Mounting a named volume at `/app/data` (step 5) preserves both across
restarts and image updates.

```bash
# Back up the audit log
docker cp xco-mcp-client:/app/data/audit.log ./audit-backup.log

# Reset (wipe audit log + persisted settings)
docker rm -f xco-mcp-client
docker volume rm xco-mcp-audit
# then re-run step 5
```

---

## Environment variables reference

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MCP_BASE_URL` | **yes** | `http://host.docker.internal:8000` | The community MCP server. No credentials. |
| `OLLAMA_ENABLED` | no | `0` | `1` to enable the local-LLM NL fallback. |
| `OLLAMA_BASE_URL` | no | `http://host.docker.internal:11434` | Ollama endpoint. |
| `OLLAMA_MODEL` | no | `qwen2.5:3b-instruct` | Ollama model id. |
| `OPENAI_API_KEY` | no | — | Cloud LLM for NL routing/explain (also settable in the UI). |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | OpenAI model id. |
| `AUDIT_LOG_PATH` | no | `/app/data/audit.log` | Set by the image; keep under the mounted volume. |

There is intentionally **no** `MCP_CLIENT_ID` / `MCP_CLIENT_SECRET` — the
community server uses no authentication.

---

## Monitoring

```bash
curl -s http://localhost:5174/api/health     # also drives the HEALTHCHECK
docker ps --filter name=xco-mcp-client        # status incl. health state
docker logs -f xco-mcp-client                 # logs
```

Key endpoints (all proxied through the client, no auth):
`/api/health`, `/api/tools`, `/api/invoke`, `/api/nl`, `/api/agent/skills`,
`/api/audit`.

---

## Stopping, restarting, updating

```bash
docker stop xco-mcp-client          # stop (volume preserved)
docker start xco-mcp-client         # start again
docker rm -f xco-mcp-client         # remove the container

# Update to a new image build:
docker load < xco-mcp-client-community-<new-date>.tar.gz
docker rm -f xco-mcp-client
# re-run step 5 (the xco-mcp-audit volume carries your data forward)
```

---

## Docker Compose (alternative to `docker run`)

A `docker-compose.yml` ships in the repo. From a directory containing it
(or the repo root):

```bash
MCP_BASE_URL=http://host.docker.internal:8000 docker compose up -d
docker compose logs -f
docker compose down
```

---

## Troubleshooting

**Container won't start** — `docker logs xco-mcp-client`. A bind error on
5174 means the port is in use; change the left side of `-p 5174:5174`
(e.g. `-p 8088:5174`).

**UI loads but the tool list is empty** — the client can't reach the MCP
server. Check `MCP_BASE_URL`, the `--add-host` flag, and:
```bash
docker exec -it xco-mcp-client sh -c 'curl -fsS $MCP_BASE_URL/health'
```

**`host.docker.internal` doesn't resolve (older Linux Docker)** — ensure the
`--add-host=host.docker.internal:host-gateway` flag is present, or use the
host's LAN IP for `MCP_BASE_URL` instead.

**`/api/health` says the MCP server is "not reachable"** — see
[Networking](#networking--same-host-deployment); it's the
localhost-vs-host.docker.internal issue 9 times out of 10.

---

## Building the distribution image (maintainers)

```bash
# From the repo root. No local Node/Python needed — Docker builds both stages.
DATE=$(date +%Y.%m.%d)
docker build -t xco-mcp-client-community:latest -t xco-mcp-client-community:$DATE .

# Save a portable, gzipped tarball for copying to another box:
mkdir -p docker-dist
docker save xco-mcp-client-community:latest xco-mcp-client-community:$DATE \
  | gzip > docker-dist/xco-mcp-client-community-$DATE.tar.gz

# On the target box:
docker load < xco-mcp-client-community-$DATE.tar.gz
```

The build context is kept lean by `.dockerignore` (excludes `.venv`,
`node_modules`, `docker-dist/`, tarballs, logs, tests, docs). The image only
contains the backend + the built UI; no secrets are baked in.
