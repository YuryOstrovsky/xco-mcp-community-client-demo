# Contributing

Thanks for your interest in the XCO MCP Community Client Demo! This is a
**demonstration / reference** client for the community-grade XCO MCP server.
Contributions that keep it simple, read-only, and easy to learn from are
very welcome.

## Ground rules

- This client is **read-only and authentication-free** by design. Please
  don't add mutation flows, login/auth, or enterprise-only subsystems —
  those are intentionally out of scope (see [COMMUNITY.md](COMMUNITY.md)).
- Keep changes small and focused. One logical change per pull request.
- Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

See [README.md](README.md) for the full dev setup. In short:

```bash
# Backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
MCP_BASE_URL=http://127.0.0.1:8000 .venv/bin/uvicorn main:app --port 5174

# Frontend
cd frontend
npm install
npm run dev
```

You'll need a reachable community XCO MCP server (no credentials required).

## Before you open a PR

Run the checks locally — CI ([`.github/workflows/verify.yml`](.github/workflows/verify.yml))
runs the same:

```bash
# Backend unit tests
cd backend && .venv/bin/python -m pytest -q

# Frontend build + unit tests
cd frontend && npm run build && npm test
```

If you changed backend behavior and have a community server running, the
integration smoke test is a good extra check:

```bash
cd backend && BASE_URL=http://127.0.0.1:5174 .venv/bin/python -m tests.smoke
```

## Code style

- **Python**: follow the surrounding style; keep route handlers thin and put
  shared logic in `backend/core/` or the relevant per-domain module.
- **TypeScript/React**: don't add large presentational code to `App.tsx` —
  put reusable UI in `frontend/src/components/` and feature views in
  `frontend/src/features/<domain>/`. Prefer typed tool calls via
  `lib/typedInvoke.ts` where the tool name is a compile-time literal.
- New presentational components should add a `<Name>.test.tsx` next to the
  source.

## Reporting bugs / requesting features

Open an issue using the templates in
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE). For anything
security-related, see [SECURITY.md](SECURITY.md) — please don't file public
issues for vulnerabilities.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
