# Auto-derived MCP tool catalog with 10-min cache.
#
# The MCP server's /api/tools is the source of truth for what tools exist
# and what shape their inputs take. Hand-maintained tool tables drift —
# we hit this in agent v1 (wrong names, wrong param shapes). Auto-derive
# instead.
#
# This module:
#   • get_tool_catalog(fetch)   — cached {name: tool_record} view of /api/tools
#   • project_to_openai_spec()  — JSON Schema → OpenAI function-call spec
#   • project_to_tools_array()  — convenience wrapper (catalog + project)
#
# Used by `agent.py` to build the per-skill OpenAI tool array. Also
# usable by any other caller that needs "current MCP tool catalog,
# cached" — e.g. an admin tools-explorer UI, or input-form generator
# (frontend lib/toolSchema.ts is the consumer-side pair).
#
# Cache is in-process, not Redis: a fresh catalog on every backend
# restart costs one HTTP round trip and is bounded.

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple


# 10 min — long enough to amortize, short enough to pick up server
# tool catalog changes after a deploy.
_CATALOG_TTL_S = 600

_catalog_cache: Dict[str, Any] = {"at": 0.0, "by_name": {}}


# Type of the fetch callable: an async fn that returns the raw response
# from MCP's /api/tools. Caller injects this so this module stays
# decoupled from auth + httpx specifics.
FetchCatalogFn = Callable[[], Awaitable[Any]]


async def get_tool_catalog(fetch_catalog: FetchCatalogFn) -> Dict[str, Dict[str, Any]]:
    """Return {tool_name: tool_record} from the MCP server's /api/tools.
    Cached for _CATALOG_TTL_S seconds.

    Tool record shape: {name, description, input_schema} (MCP standard).
    """
    now = time.monotonic()
    if _catalog_cache["by_name"] and (now - _catalog_cache["at"] < _CATALOG_TTL_S):
        return _catalog_cache["by_name"]
    raw = await fetch_catalog()
    tools = raw if isinstance(raw, list) else (raw.get("tools") or raw.get("items") or [])
    by_name: Dict[str, Dict[str, Any]] = {}
    for t in tools:
        if isinstance(t, dict) and isinstance(t.get("name"), str):
            by_name[t["name"]] = t
    _catalog_cache["by_name"] = by_name
    _catalog_cache["at"] = now
    return by_name


def project_to_openai_spec(
    tool_record: Dict[str, Any],
    hint: Optional[str] = None,
) -> Dict[str, Any]:
    """Project an MCP tool catalog entry to an OpenAI tool-use function spec.
    The MCP `input_schema` is already JSON Schema, which is exactly what
    OpenAI's `parameters` expects — projection is mostly a rename.

    `hint`, when given, is prepended to the tool description so it's the
    first thing the model reads. Skills use this to inject per-tool
    guidance (e.g. 'pass switch_ips PLURAL').
    """
    name = tool_record.get("name", "")
    desc = tool_record.get("description", "") or ""
    if hint:
        desc = f"{hint.strip()}\n\n{desc}"
    params = tool_record.get("input_schema") or {"type": "object", "properties": {}}
    # OpenAI requires `parameters.type == "object"` even for tools with no inputs.
    if not isinstance(params, dict) or params.get("type") != "object":
        params = {"type": "object", "properties": {}}
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc[:1024],  # keep descriptions reasonable
            "parameters": params,
        },
    }


async def project_to_tools_array(
    fetch_catalog: FetchCatalogFn,
    tool_names: List[str],
    hints: Optional[Dict[str, str]] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Convenience: fetch catalog, project the named tools to OpenAI specs.
    Returns (specs, missing_names) so callers can warn about tools the
    server doesn't expose.
    """
    catalog = await get_tool_catalog(fetch_catalog)
    hints = hints or {}
    specs: List[Dict[str, Any]] = []
    missing: List[str] = []
    for name in tool_names:
        rec = catalog.get(name)
        if rec is None:
            missing.append(name)
            continue
        specs.append(project_to_openai_spec(rec, hint=hints.get(name)))
    return specs, missing
