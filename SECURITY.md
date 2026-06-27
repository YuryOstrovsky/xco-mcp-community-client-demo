# Security Policy

## Scope

This is **demonstration / reference software** for evaluating the
community-grade XCO MCP server. It is **not** a supported production product.
By design it is read-only and performs no authentication — it should be run
against a trusted community MCP server on a trusted network, not exposed
directly to the public internet.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Instead, report privately via GitHub:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (GitHub private vulnerability reporting).

If private reporting is unavailable, contact the repository owner through
their GitHub profile.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a minimal example helps).
- The affected component (backend endpoint, frontend, Docker image, etc.).

We'll acknowledge your report as soon as we reasonably can and work with you on
a fix. As a demo project there are no formal SLAs, but credible reports are
taken seriously.

## Good to know

- The client sends **no `Authorization` header** to the MCP server. The
  image/repo must not contain baked-in credentials. Optional LLM integrations
  (OpenAI / Ollama) may use API keys supplied via env or the UI; those are never
  committed and are gitignored. Treat access to the UI and runtime data
  directory as sensitive.
- Persisted data may include audit logs and client settings. Treat `/app/data`
  as operationally sensitive.
