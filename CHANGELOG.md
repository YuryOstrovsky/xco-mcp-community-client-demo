# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

Initial public release of the XCO MCP Community Client Demo — a lean,
read-only, authentication-free web client for the community-grade XCO MCP
server.

### Added
- **AI Console** — natural-language routing (`/api/nl`): deterministic regex
  first, optional OpenAI / Ollama tool-pick.
- **Tools browser** — live MCP catalog with a schema-driven input form.
- **Read-only investigations** — bounded LLM tool-use loops over the read
  catalog (5 skills: fabric-health, pre-/post-firmware checks, pre-RMA,
  XCO health).
- **Per-switch widgets** — typed viewers for RESTCONF / inventory payloads.
- **Activity log** — `/api/audit`.
- **Server Settings** — MCP server URL + optional Ollama / OpenAI config.
- Single-container Docker image + deployment guide ([DEPLOY.md](DEPLOY.md)).
- CI (`.github/workflows/verify.yml`): backend pytest + frontend build/tests.

[Unreleased]: https://github.com/YuryOstrovsky/xco-mcp-community-client-demo/commits/main
[0.1.0]: https://github.com/YuryOstrovsky/xco-mcp-community-client-demo/releases/tag/v0.1.0
