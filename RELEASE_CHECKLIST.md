# Release Checklist

Run these checks before tagging or publishing a release. This is a
demo/reference client, so the bar is lighter than the MCP server — but a
published image should still build cleanly, pass its tests, and talk to a real
community MCP server.

## Required checks

- [ ] **Backend unit tests pass**
  ```bash
  cd backend
  python -m pytest -q
  ```
- [ ] **Frontend builds successfully**
  ```bash
  cd frontend
  npm run build
  ```
- [ ] **Frontend tests pass**
  ```bash
  cd frontend
  npm test
  ```
- [ ] **Docker image builds successfully**
  ```bash
  docker build -t xco-mcp-client-community:<tag> .
  ```
- [ ] **Container starts and `/api/health` is OK**
  ```bash
  curl http://localhost:5174/api/health
  ```
- [ ] **`/api/tools` returns a non-empty catalog** from a real community MCP server
  ```bash
  curl -s http://localhost:5174/api/tools | python -c "import sys,json;print(len(json.load(sys.stdin)))"
  ```
- [ ] **Integration smoke passes** against a running backend + reachable community MCP server
  ```bash
  cd backend
  BASE_URL=http://127.0.0.1:5174 python -m tests.smoke
  ```

## Release notes should include

- Client image tag
- Tested community MCP server version / tag
- Tested Python / Node / Docker versions
- Test date
- Backend test summary
- Frontend build / test summary
- Integration smoke-test summary
- Docker image tarball + SHA256, if distributing as a tarball

See [RELEASE_NOTES.md](RELEASE_NOTES.md) for the template and the most recent
release.
