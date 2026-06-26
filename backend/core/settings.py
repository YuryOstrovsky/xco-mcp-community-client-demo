# Runtime-mutable client configuration + on-disk persistence.
#
# `_client_config` is a process-wide dict. Anything that needs the current
# MCP base URL or the optional Ollama settings reads it from here. The keys
# can be updated at runtime via PATCH /api/client-settings — readers always
# see the freshest value because they read the same dict.
#
# There are NO authentication credentials — the config is just the MCP
# server URL plus optional Ollama settings.
#
# Persistence: PATCH writes through to client_settings.json so settings
# survive container restarts. Env vars are the SEED used on a fresh
# deployment; the JSON file is the source of truth once it exists.

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

from .paths import CLIENT_SETTINGS_PATH

# ── Env-derived defaults ─────────────────────────────────────────────
# Point at the auth-free community MCP server (conventionally :8000).
# Override with the MCP_BASE_URL env var, or at runtime via the UI's
# Server Settings panel. No OAuth2 credentials are used — the community
# server requires no authentication.
MCP_BASE_URL: str = os.getenv("MCP_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


# ── Runtime-mutable client config (single source of truth) ───────────
# Only the MCP server URL + optional Ollama settings. (The OpenAI key/model
# live in core/llm.py.)
_client_config: Dict[str, Any] = {
    "mcp_base_url": MCP_BASE_URL,
    "ollama_enabled": os.getenv("OLLAMA_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on"),
    "ollama_base_url": os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
    "ollama_model": os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct").strip(),
}


# ── Persistence ──────────────────────────────────────────────────────
# Keys exposed via PATCH — anything outside this set stays in-memory
# only (avoids leaking unrelated runtime state if _client_config grows).
PERSIST_KEYS = (
    "mcp_base_url",
    "ollama_enabled", "ollama_base_url", "ollama_model",
)


def load_persisted_client_settings() -> Dict[str, Any]:
    """Read runtime-updatable client settings from disk if present. Returns
    {} on missing/unreadable. Stays quiet on failure — this runs before
    the logger is configured, so noisy output would spam stderr."""
    try:
        path = Path(CLIENT_SETTINGS_PATH)
        if not path.exists():
            return {}
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def persist_client_settings() -> None:
    """Write runtime _client_config to disk atomically (tmp + rename) with
    0600 perms. Called by PATCH /api/client-settings after each update so
    changes survive container restarts. Best-effort — a write failure
    must not block the API response."""
    try:
        path = Path(CLIENT_SETTINGS_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        to_save = {k: _client_config[k] for k in PERSIST_KEYS if k in _client_config}
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(to_save, f, indent=2)
        try:
            os.chmod(tmp, 0o600)
        except Exception:
            pass
        tmp.replace(path)
    except Exception:
        pass


# Apply persisted overrides on top of env-derived _client_config. After
# this, the file (not env vars) is the source of truth — env vars are
# only the SEED used when the file doesn't exist yet.
for _k, _v in load_persisted_client_settings().items():
    if _k in _client_config:
        _client_config[_k] = _v
