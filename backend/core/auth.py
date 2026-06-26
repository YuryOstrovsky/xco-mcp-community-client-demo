# Auth — no authentication.
#
# The community MCP server requires NO authentication: no OAuth2, no
# client-credentials token exchange, no bearer tokens, no JWT, no scopes.
# (Its /invoke and /tools endpoints ignore an Authorization header
# entirely.)
#
# This module provides no-op shims so the read-only endpoints + helpers
# that still reference them import and type-check cleanly. NOTHING here
# enforces identity — there is none.

from __future__ import annotations

from typing import Any, Dict, List


# ── Inbound "auth" — no-op ───────────────────────────────────────────
async def require_bearer() -> str:
    """No-op inbound dependency. The community client has no login, so
    callers need no token and no Authorization header is required.

    Returns an empty string so the (many) endpoints that still accept a
    ``token: str = Depends(require_bearer)`` param and forward it to the
    ``mcp_*`` helpers keep working — the community server ignores it.
    """
    return ""


# ── JWT helpers — no identity in the community edition ───────────────
def decode_jwt_payload(token: str) -> Dict[str, Any]:
    """No identity to decode — always empty claims."""
    return {}


def caller_scopes(token: str) -> set:
    """No scopes — the community server is SAFE_READ only, unscoped."""
    return set()


def filter_tools_by_token(tools: List[Dict[str, Any]], token: str) -> List[Dict[str, Any]]:
    """No scope filtering — every (read-only) tool is visible."""
    return list(tools)
