# XCO MCP Community Client Demo

A lean, **read-only, authentication-free** web client for the
community-grade **XCO MCP server** (ExtremeCloud Orchestrator). Ask a
question in natural language, browse the live tool catalog, or run a
read-only investigation — all against a Tier-1/Tier-2 SAFE_READ MCP
server that requires no login.

> **Demonstration / reference only.** This client performs **no mutations
> and no authentication**. See [COMMUNITY.md](COMMUNITY.md) for scope and
> [DEPLOY.md](DEPLOY.md) for the Docker deployment guide.

---

## What it does

- **AI Console (natural-language routing)** — `POST /api/nl`: deterministic
  regex routing first, then an optional OpenAI / Ollama tool-pick. Returns a
  structured tool call plus a rendered result.
- **Tools browser** — the live MCP catalog (`/api/tools`) with a
  schema-driven input form; run any read tool and view its payload.
- **Read-only investigations** — bounded LLM tool-use loops that chain read
  tools into a Markdown report (5 skills: fabric-health, pre-/post-firmware
  checks, pre-RMA, XCO health).
- **Per-switch widgets** — typed viewers for RESTCONF / inventory payloads
  (interfaces, ARP, LLDP, running-config, clocks, VRF/VLAN summaries, …).
- **Activity log** — a tail of every operator-visible event (`/api/audit`).

There is **no** login, **no** mutation surface, and **no** multi-site — the
client talks to a single community MCP server and sends no `Authorization`
header.

## Architecture

A single FastAPI backend (`backend/`) that proxies the community MCP server
and serves the built React UI (`frontend/`) on **one port (5174)**:

```
browser ──HTTP──> client backend (FastAPI :5174) ──HTTP──> community MCP server
                   └─ also serves the React UI at /
```

## Quick start (development)

Prerequisites: Python 3.10+, Node 20+, and a reachable community MCP server.

```bash
# Backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
MCP_BASE_URL=http://127.0.0.1:8000 .venv/bin/uvicorn main:app --host 0.0.0.0 --port 5174

# Frontend (Vite dev server, hot reload)
cd frontend
npm install
npm run dev
```

Open the UI — it boots straight into the dashboard (no login screen).

For a production container, see **[DEPLOY.md](DEPLOY.md)** (single image, no
credentials).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MCP_BASE_URL` | `http://127.0.0.1:8000` | The community MCP server. **No credentials.** |
| `OLLAMA_ENABLED` / `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | off | Optional local-LLM NL fallback. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — | Optional cloud LLM for NL routing/explain (also settable in the UI → **Server Settings**). |

The MCP URL is also changeable at runtime via the UI (**Server Settings**),
persisted to `backend/client_settings.json`.

## Project layout

```
backend/
  main.py            FastAPI app — NL routing, tool proxy, audit, settings
  core/              primitives: mcp_client · settings · llm · sse · audit ·
                     tool_catalog · openai_usage · auth (no-op) · paths
  nl/                natural-language routing (deterministic + LLM tiers)
  agent/             read-only investigation engine
  agent_routes.py    /api/agent/* — skills list + investigate
  agent_skills/*.md  the 5 read-only investigation skills
  tests/             pytest unit tests + an integration smoke test
frontend/
  src/App.tsx        app shell — state, routing, the NL console
  src/features/      tools browser · agent investigate · viz blocks · widgets
  src/components/    per-switch read widgets + shared UI
  src/lib/           API client · typed-invoke · hooks
```

## Verifying

```bash
# Backend unit tests (no server needed)
cd backend && .venv/bin/python -m pytest -q

# Integration smoke (needs the backend running + a reachable community server)
cd backend && BASE_URL=http://127.0.0.1:5174 .venv/bin/python -m tests.smoke

# Frontend
cd frontend && npm run build && npm test
```

## Status

Demonstration software, provided **as-is** for evaluating the community XCO
MCP server. Not a supported product.
