# Thin HTTP wrappers over the upstream MCP server (mcp_get / mcp_post /
# mcp_put / mcp_patch / mcp_delete).
#
# Community edition: the upstream MCP server requires NO authentication,
# so these send NO Authorization header. The enterprise original forwarded
# the caller's bearer token (or a shared OAuth2 service-account token from
# TokenCache) and retried once on 401 — all of that is gone.
#
# The `token` parameter is retained (and ignored) only so the existing
# call sites that pass `token=token` keep working without edits.
#
# `invoke_tool` is NOT here — it lives in main.py because it short-circuits
# the virtual composite tool which still wraps main-only helpers.

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx
from fastapi import HTTPException

from .settings import _client_config


async def mcp_get(path: str, token: Optional[str] = None) -> Any:
    """GET against the MCP server (no auth)."""
    url = f"{_client_config['mcp_base_url']}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, detail=r.text)
    return r.json()


async def mcp_post(path: str, payload: Dict[str, Any], token: Optional[str] = None) -> Any:
    """POST against the MCP server (no auth)."""
    url = f"{_client_config['mcp_base_url']}{path}"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(url, json=payload)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, detail=r.text)
    return r.json()


async def mcp_delete(path: str, token: Optional[str] = None) -> Any:
    """DELETE against the MCP server (no auth)."""
    url = f"{_client_config['mcp_base_url']}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.delete(url)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, detail=r.text)
    try:
        return r.json()
    except Exception:
        return {"ok": True}


async def mcp_put(path: str, payload: Dict[str, Any], token: Optional[str] = None) -> Any:
    """PUT against the MCP server (no auth)."""
    url = f"{_client_config['mcp_base_url']}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.put(url, json=payload)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, detail=r.text)
    return r.json()


async def mcp_patch(path: str, payload: Dict[str, Any], token: Optional[str] = None) -> Any:
    """PATCH against the MCP server (no auth)."""
    url = f"{_client_config['mcp_base_url']}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.patch(url, json=payload)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, detail=r.text)
    return r.json()
