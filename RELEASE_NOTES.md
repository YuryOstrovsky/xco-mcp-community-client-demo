# XCO MCP Community Client Demo — v1.0.0

Reference/demo UI for the XCO MCP Community Server.

This is **not a product**. It is unsupported, auth-free, read-only, and intended
only for **localhost or trusted management networks**. See the network-exposure
warning in the [README](README.md).

## What it includes

- Web UI for the community MCP server
- Natural-language console
- Live tools browser
- Fleet and per-switch read-only widgets
- Activity (audit) log
- Optional OpenAI / Ollama routing support

## Requirements

- A running **XCO MCP Community Server**
  (https://github.com/YuryOstrovsky/xco-mcp-community-server) — see its
  [v1.0.0 release](https://github.com/YuryOstrovsky/xco-mcp-community-server/releases/tag/v1.0.0)
- `MCP_BASE_URL` pointing to that server
- No user login or `Authorization` header from the client

## 🚀 Getting started

**Full guide:** [DEPLOY.md](https://github.com/YuryOstrovsky/xco-mcp-community-client-demo/blob/v1.0.0/DEPLOY.md) ·
**Overview:** [README](https://github.com/YuryOstrovsky/xco-mcp-community-client-demo/blob/v1.0.0/README.md)

Quick version (using the attached image; the community MCP server must already be running):

```bash
# 1. Load the prebuilt image
docker load -i xco-mcp-client-community-1.0.0.tar.gz

# 2. Run it, pointing MCP_BASE_URL at your community MCP server.
#    --add-host lets the container reach a server published on the host.
docker run -d --name xco-mcp-client -p 5174:5174 --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -e MCP_BASE_URL=http://host.docker.internal:8000 \
  -v xco-mcp-audit:/app/data \
  xco-mcp-client-community:1.0.0

# 3. Open the UI
curl http://localhost:5174/api/health     # {"status":"ok", ...}
# then browse to http://localhost:5174/
```

> ⚠️ **No login / no authorization** — run on localhost or a trusted network
> only. The image contains no credentials. Full deploy (reverse proxy,
> persistence, networking) is in
> [DEPLOY.md](https://github.com/YuryOstrovsky/xco-mcp-community-client-demo/blob/v1.0.0/DEPLOY.md).

## Tested with

| Item | Version |
|---|---|
| Client image | `xco-mcp-client-community:1.0.0` |
| MCP server | `v1.0.0` |
| Python (container) | 3.11.15 |
| Node | 20.20.0 |
| Docker | 29.3.1 |
| Test date | 2026-06-27 |

## Test evidence

| Check | Result |
|---|---|
| Backend `pytest` | PASS (148 tests) |
| Frontend build (`npm run build`) | PASS |
| Frontend tests (`npm test`) | PASS (98 tests) |
| Docker build | PASS |
| `/api/health` | PASS |
| `/api/tools` (non-empty) | PASS (271 tools) |
| Integration smoke (`tests.smoke`) | PASS (8/8) |

## Caveats

- No login / no authorization layer
- Do not expose directly to the public internet
- Anyone with access to the UI can invoke read-only MCP tools through the
  configured server
- Optional OpenAI integration may incur API usage
- Community / demo support only — **no Extreme GTAC**
