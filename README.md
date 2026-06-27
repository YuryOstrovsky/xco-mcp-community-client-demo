# XCO MCP Community Client Demo

A lean, **read-only, authentication-free** web client for the
community-grade **XCO MCP server** (ExtremeCloud Orchestrator). Ask a
question in natural language or browse the live tool catalog — all against
a Tier-1/Tier-2 SAFE_READ MCP server that requires no login.

> ## ⚠️ Read this first
>
> **Reference / demo software — provided AS-IS, unsupported.**
>
> - **What it's for.** A **plug-and-play** demo for people who want to try the
>   community XCO MCP server through a ready-made UI + natural-language console
>   **without building their own AI agent, client, or frontend**. It is a
>   *reference design*, not a product.
> - **It needs the server.** This client does nothing on its own — it is a
>   front-end for the **community XCO MCP server**, which you run **separately**:
>   **→ https://github.com/YuryOstrovsky/xco-mcp-community-server**
>   Point `MCP_BASE_URL` at your running community server (see
>   [DEPLOY.md](DEPLOY.md)).
> - **No support. Period.** This is unsupported, community, use-at-your-own-risk
>   software. **No support from anyone — not from Extreme Networks GTAC, not
>   from the authors.** You are entirely on your own.
> - **Read-only & auth-free** — no mutations, no login. See
>   [COMMUNITY.md](COMMUNITY.md) for scope.

> ## ⚠️ Network exposure warning
>
> This demo client has **no login, no users, no roles, and no authorization layer**.
>
> Anyone who can reach the web UI can browse tools, change client-side settings where exposed, and invoke read-only MCP calls through the configured community MCP server.
>
> Run it only on **localhost or a trusted management network**. If exposing it beyond localhost, place it behind an authenticated reverse proxy, VPN, or other access-control layer.
>
> If OpenAI is enabled, users with access to this UI may trigger OpenAI API usage.

---

## What it does

- **AI Console (natural-language routing)** — `POST /api/nl`: deterministic
  regex routing first, then an optional OpenAI / Ollama tool-pick. Returns a
  structured tool call plus a rendered result.
- **Tools browser** — the live MCP catalog (`/api/tools`) with a
  schema-driven input form; run any read tool and view its payload.
- **Fleet + search widgets** — fabric topology diagram, fleet inventory
  (serials, CSV export), transceiver inventory, IP/MAC "where is X" search.
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

For a deployable container, see **[DEPLOY.md](DEPLOY.md)** (single image; no
credentials baked into the image).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MCP_BASE_URL` | `http://127.0.0.1:8000` | The community MCP server. The client sends **no `Authorization` header**. |
| `OLLAMA_ENABLED` / `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | off | Optional local-LLM NL fallback. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — | Optional cloud LLM for NL routing/explain (also settable in the UI → **Server Settings**). |

The MCP URL is also changeable at runtime via the UI (**Server Settings**),
persisted to `backend/client_settings.json`.

## Project layout

```
backend/
  main.py            FastAPI app — NL routing, tool proxy, audit, settings
  core/              primitives: mcp_client · settings · llm · audit ·
                     tool_catalog · openai_usage · auth (no-op) · paths
  nl/                natural-language routing (deterministic + LLM tiers)
  tests/             pytest unit tests + an integration smoke test
frontend/
  src/App.tsx        app shell — state, routing, the NL console
  src/features/      tools browser · viz blocks · widgets
  src/components/    per-switch + fleet read widgets + shared UI
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

## Status & support

Demonstration / **reference** software, provided **AS-IS** for evaluating the
community XCO MCP server. **Not a product, and not supported by anyone —
including Extreme Networks GTAC.** Use entirely at your own risk.

Requires the **community XCO MCP server** to run against:
**https://github.com/YuryOstrovsky/xco-mcp-community-server**
— latest release: **[v1.0.0](https://github.com/YuryOstrovsky/xco-mcp-community-server/releases/tag/v1.0.0)**

## License

Licensed under the [Apache License 2.0](LICENSE).
