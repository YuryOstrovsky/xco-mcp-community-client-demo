# Community Edition — what this is

This is the **community-grade** build of the MCP client demo: a lean,
**read-only, authentication-free** client for the community-grade XCO MCP
server (Tier-1/Tier-2 SAFE_READ tools only). It was produced by stripping
the enterprise client down — removing authentication/OAuth2, the entire
Tier-3/Tier-4 mutation surface, and the enterprise-only subsystems.

> **Reference / demo only — unsupported.** This is a plug-and-play demo for
> people who want a ready-made UI + NL console over the community server
> **without building their own agent/client/frontend**. It is **not a
> product** and is **supported by no one — not Extreme Networks GTAC, not
> the authors**. It is useless without the **community XCO MCP server**:
> **https://github.com/YuryOstrovsky/xco-mcp-community-server**

If you're looking for the enterprise feature set (plans pipeline, mutation
proposals, RoCE, multi-site, ambient agent, RBAC, etc.), this is not that
build — those features were deliberately removed here.

## Target server

Point the client at an **auth-free community MCP server**:

- It exposes `POST /invoke`, `GET /tools`, `GET /health`, `GET /ready`,
  `GET /metrics`.
- It requires **no** authentication — no OAuth2, no bearer token, no API
  key. An `Authorization` header is ignored.
- Its catalog is **SAFE_READ only** (~263 tools): `get`/`list`/`show`. There
  are no `create`/`delete`/`deploy`/`firmware`/`RoCE`/`factory`/`RMA`
  mutation tools.

Set the server URL via `MCP_BASE_URL` (env) or the **Server Settings** panel
in the UI. The default in `core/settings.py` is `http://127.0.0.1:8000`.

## What was removed (vs the enterprise client)

**Authentication / OAuth2 (load-bearing — gone entirely)**
- No login flow (`POST /api/auth/token` removed). The app boots straight
  into the dashboard with no credentials.
- No upstream OAuth2 client-credentials token cache. `core/mcp_client.py`
  calls the server with **no `Authorization` header**.
- `core/auth.py` is now no-op shims (`require_bearer` requires no token;
  JWT/scope helpers return empty). `core/rbac.py`'s `require_admin` is a
  no-op. No roles, no admin gating, no tool-scope filtering.

**Tier-3 / Tier-4 mutation surface (gone)**
- Plans pipeline (`plans_routes.py`, `/api/plans/*`, mutation ledger).
- The entire **AI Agent Skills** subsystem (the LLM investigation engine,
  skills, and `/api/agent/*` endpoints) — enterprise feature, removed.
- Fabric lifecycle (add/remove/delete/destroy/deploy/clean/reconcile/RMA/
  firmware/L2-extension), RoCE (`roce_host_test*`, the RoCE UI), tenant
  create/edit/delete (EPG/VRF/port-channel).

**Enterprise subsystems (gone — "lean" build)**
- Ambient agent (`ambient/` — chat, Twilio, Telegram, scheduler, event
  ingest, widget render, mutation gate).
- Cross-fabric fleet dashboard (`cross_fabric/`).
- Health watcher (`health_watcher/`).
- Multi-site registry, RBAC/Clients/Webhooks admin, cost-telemetry panels.

## What remains (read-only, works against the community server)

- **AI Console / NL routing** — `POST /api/nl` (+ `/api/nl/explain`):
  deterministic regex → OpenAI → Ollama tool-pick, read-only.
- **Tools browser** — `GET /api/tools` (live community catalog) + the
  schema-driven run form.
- **Fleet + search widgets** — fabric topology diagram, fleet inventory
  (serials + CSV export), transceiver inventory, IP/MAC search.
- **Per-switch read widgets** + **AI Console viz blocks**.
- **Activity Log** — `GET /api/audit`.
- **Server Settings** — MCP base URL, Ollama, OpenAI key.

## Run it

```bash
# Backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
MCP_BASE_URL=http://127.0.0.1:8000 .venv/bin/uvicorn main:app --host 0.0.0.0 --port 5174

# Frontend (dev)
cd frontend
npm install
npm run dev            # talks to the backend; no login screen

# Frontend (prod build served by the backend)
cd frontend && npm run build     # backend serves frontend/dist at /
```

Docker: `docker compose up` (set `MCP_BASE_URL`; no credentials needed).

## Verify

```bash
# Backend unit tests (no service needed)
cd backend && .venv/bin/python -m pytest -q

# Integration smoke (needs the backend running + a reachable community server)
cd backend && BASE_URL=http://127.0.0.1:5174 .venv/bin/python -m tests.smoke
```

## Refreshing the tool catalog

The typed-invoke layer is generated from a checked-in snapshot of the
community catalog (`frontend/src/lib/generated/toolCatalog.snapshot.json`).
To refresh after the community server's catalog changes:

```bash
# fetch the bare /tools array from the community server and rewrite the snapshot,
# then regenerate the TS types:
#   (snapshot shape: {generated_at, count, tools:[{name, description, input_schema}]})
cd frontend && npm run gen-tools
```

---

*See [`README.md`](README.md) for an overview and [`DEPLOY.md`](DEPLOY.md)
for the Docker deployment guide.*
