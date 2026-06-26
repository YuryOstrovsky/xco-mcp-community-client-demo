from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import time
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Reads backend/.env if present (and/or EnvironmentFile via systemd)
from pathlib import Path
# Load .env from this backend directory (stable regardless of CWD)
load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)

# `_client_config` is THE single source of truth for runtime-updatable
# backend config (MCP URL + Ollama) — a PATCH lands everywhere at once.
from core.settings import (  # noqa: F401
    MCP_BASE_URL,
    _client_config,
    load_persisted_client_settings as _load_persisted_client_settings,
    persist_client_settings as _persist_client_settings,
)

# ── Audit log ─────────────────────────────────────────────────────────────────
# AUDIT_LOG_PATH lives in core.paths so every module that reads/writes under
# the same volume mount lands on the same path.
# (Service starts uvicorn from backend/ — top-level module loads, NOT
# a package, so we use absolute imports from sibling dirs, not `from .core`.)
from core.paths import AUDIT_LOG_PATH, CLIENT_SETTINGS_PATH, OPENAI_USAGE_LOG_PATH

# ── OpenAI usage log (for cost tracking) ─────────────────────────────────────
# JSONL log + price table + aggregator live in core.openai_usage so the
# daily-cost-cap check (later in this file) and the cost-tracking section
# call the same code.
from core.openai_usage import (
    OPENAI_PRICING_USD_PER_1M,
    price_for_model as _price_for_model,
    log_openai_usage as _log_openai_usage,
    read_openai_usage_window as _read_openai_usage_window,
    aggregate_openai_usage as _aggregate_openai_usage,
    skill_month_cost_usd as _skill_month_cost_usd,
)

# The audit handler is attached at import time inside core.audit, so importing
# it is enough to install the JSONL FileHandler on the `mcp.audit` logger.
from core.audit import audit_log as _audit_log, logger, audit as _audit  # noqa: F401


# Optional local LLM via Ollama
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = (os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct") or "qwen2.5:3b-instruct").strip()
OLLAMA_ENABLED = (os.getenv("OLLAMA_ENABLED", "0") or "0").strip().lower() in ("1", "true", "yes", "on")

# Optional cloud LLM via OpenAI-compatible API.
# OPENAI_* constants + the runtime key state + the chat helpers live in
# core.llm. We import the module (not the names) so callers in main.py
# must write `_llm.OPENAI_MODEL` explicitly — that's the single source of
# truth and always reflects the current runtime value. (Re-exporting the
# names at module level would let a runtime key change go unseen by bare-name
# lookups inside main.py — keep the `_llm.` prefix.)
import core.llm as _llm

# Optional: let Ollama extract structured list filters ("Option 4").
# When enabled, the backend will ask the LLM to produce structured filter clauses
# (field/op/value) and only fall back to regex parsing if the LLM output is invalid.
OLLAMA_FILTERS_ENABLED = (os.getenv("OLLAMA_FILTERS_ENABLED", "0") or "0").strip().lower() in ("1", "true", "yes", "on")
# NOTE: default is OFF to avoid adding latency to interactive UI actions; enable explicitly for Console NL filtering.
OLLAMA_MAX_FIELDS_FOR_FILTERS = int(os.getenv("OLLAMA_MAX_FIELDS_FOR_FILTERS", "25"))
OLLAMA_MAX_FILTER_CLAUSES = int(os.getenv("OLLAMA_MAX_FILTER_CLAUSES", "6"))
OLLAMA_MAX_TOKENS_FILTERS = int(os.getenv("OLLAMA_MAX_TOKENS_FILTERS", "160"))
OLLAMA_TIMEOUT_FILTERS_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_FILTERS_SECONDS", "20.0"))

app = FastAPI(title="MCP Client Demo Backend", version="0.2")

# Frontend static dist path (for serving built UI)
_BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = str((_BACKEND_DIR.parent / "frontend" / "dist").resolve())

# ── Mounted feature routers ──────────────────────────────────────────
# The read-only agent investigation router is wired below.


# -----------------------------
# Models
# -----------------------------
class InvokeReq(BaseModel):
    tool: str
    inputs: Dict[str, Any] = {}


class NLReq(BaseModel):
    text: str
    include_raw: bool = False
    force_tool: Optional[str] = None
    force_inputs: Optional[Dict[str, Any]] = None
    # LLM routing: "auto" (deterministic first, then LLM), "off" (deterministic only), "ollama" (force Ollama), "openai" (force OpenAI)
    llm_mode: str = "auto"
    max_candidates: int = 25


# InvestigateReq + the other agent request models live with their
# endpoints in backend/agent_routes.py.


# -----------------------------
# Auth — the community edition has no authentication.
# -----------------------------
# core.auth holds no-op shims: `require_bearer` is a no-op dependency (no
# token required); the JWT/scope helpers return empty/identity values.
from core.auth import (  # noqa: F401
    require_bearer,
    decode_jwt_payload as _decode_jwt_payload,
    caller_scopes as _caller_scopes,
    filter_tools_by_token as _filter_tools_by_token,
)


# -----------------------------
# MCP proxy helpers (mcp_get/post/put/patch/delete) live in core.mcp_client.
# invoke_tool stays here because it short-circuits the virtual-composite tool
# (`inventory_get_switch_inventory_overview`) which calls back into helpers
# defined later in this file.
# -----------------------------
from core.mcp_client import mcp_get, mcp_post, mcp_put, mcp_patch, mcp_delete  # noqa: F401


async def invoke_tool(tool: str, inputs: Dict[str, Any], token: Optional[str] = None) -> Any:
    """Invoke the upstream MCP server tool via MCP_BASE_URL /invoke.

    Never raises — HTTP/connection errors are returned as a structured
    result so resp.raw always has content for the UI to display.
    """
    body = {"tool": tool, "inputs": inputs or {}}
    switch_ip = (inputs or {}).get("switch_ip")
    # inventory_get_switch_inventory_overview is a CLIENT-side virtual tool
    # (composed here, not on the MCP server). /api/invoke special-cases it;
    # mirror that here so callers that go through invoke_tool don't get a 404.
    if tool == "inventory_get_switch_inventory_overview":
        try:
            payload = await _virtual_inventory_overview(inputs or {}, token=token)
            return {"session_id": str(uuid.uuid4()), "result": {"tool": tool, "status": 200, "payload": payload}}
        except Exception:
            pass  # fall through to the upstream attempt (will surface a real error)
    try:
        return await mcp_post("/invoke", body, token=token)
    except HTTPException as e:
        # MCP server returned a 4xx/5xx — wrap it in the standard result shape
        # so the frontend Raw tab shows real content instead of null.
        detail: str = str(e.detail or "")
        is_timeout = bool(re.search(r"timeout|timed.out|connect.*error|max retries", detail, re.I))
        error_type = "connect_timeout" if is_timeout else "http_error"
        return {
            "session_id": None,
            "result": {
                "tool": tool,
                "status": e.status_code,
                "payload": {
                    "meta": {
                        "tool": tool,
                        "switch_ip": switch_ip,
                        "ok": False,
                        "source": "direct_switch_restconf",
                        "error_type": error_type,
                        "error": detail,
                        "http_status": e.status_code,
                    },
                    "summary": {"signals": {"restconf_ok": False}},
                    "items": [],
                    "warnings": [detail[:300]],
                },
            },
        }
    except Exception as e:
        # Network-level error (DNS, connection refused, httpx timeout, etc.)
        detail = repr(e)
        is_timeout = bool(re.search(r"timeout|timed.out|connect.*error|max retries", detail, re.I))
        error_type = "connect_timeout" if is_timeout else "network_error"
        return {
            "session_id": None,
            "result": {
                "tool": tool,
                "status": 0,
                "payload": {
                    "meta": {
                        "tool": tool,
                        "switch_ip": switch_ip,
                        "ok": False,
                        "source": "direct_switch_restconf",
                        "error_type": error_type,
                        "error": detail,
                        "http_status": 0,
                    },
                    "summary": {"signals": {"restconf_ok": False}},
                    "items": [],
                    "warnings": [detail[:300]],
                },
            },
        }



# -----------------------------
# Virtual composite tools (client-backend)
# -----------------------------
VIRTUAL_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "inventory_get_switch_inventory_overview",
        "description": (
            "Switch inventory overview (client composite): merges chassis_name/role from inventory_getswitches "
            "with fabric/firmware/mac/discovery fields from inventory_get_switches_widget_table. "
            "Also returns model_counts for charts."
        ),
        "category": "inventory",
        "required_scope": "mcp:read",
        "input_schema": {
            "type": "object",
            "properties": {
                "max_items": {"type": "integer", "default": 200},
                "include_raw": {"type": "boolean", "default": False},
            },
            "required": [],
        },
    },
]


from nl.list_filters import _pick_str  # noqa: F401


def _get_payload_items(resp: Any) -> List[Dict[str, Any]]:
    try:
        outer = (resp or {}).get("result", {}).get("payload", {})
        # All MCP responses are double-nested: result.payload.payload.items
        inner = outer.get("payload") if isinstance(outer, dict) else None
        payload = inner if isinstance(inner, dict) else outer
        items = payload.get("items") if isinstance(payload, dict) else None
        if isinstance(items, list):
            return [x for x in items if isinstance(x, dict)]
    except Exception:
        pass
    return []


async def _virtual_inventory_overview(inputs: Dict[str, Any], token: Optional[str] = None) -> Dict[str, Any]:
    """Build merged switch inventory payload for the UI."""
    max_items = int((inputs or {}).get("max_items", 200))
    include_raw = bool((inputs or {}).get("include_raw", False))

    # Run both upstream calls in parallel to halve latency
    base_resp, enrich_resp = await asyncio.gather(
        invoke_tool("inventory_getswitches", {}, token=token),
        invoke_tool(
            "inventory_get_switches_widget_table",
            {"max_items": max_items, "include_raw": include_raw, "fabric_all": True},
            token=token,
        ),
    )

    base_items = _get_payload_items(base_resp)
    enr_items = _get_payload_items(enrich_resp)

    by_id: Dict[str, Dict[str, Any]] = {}
    by_ip: Dict[str, Dict[str, Any]] = {}
    for it in enr_items:
        _id = it.get("id")
        if _id is not None:
            by_id[str(_id)] = it
        ip = _pick_str(it.get("ip_address"), it.get("ip"), it.get("management_ip"), it.get("mgmt_ip"))
        if ip:
            by_ip[ip] = it

    # If base is empty but enrichment has data, use enrichment as the primary list
    primary_items = base_items if base_items else enr_items

    merged: List[Dict[str, Any]] = []
    for it in primary_items:
        mid = it.get("id")
        ip = _pick_str(it.get("ip_address"), it.get("ip"), it.get("management_ip"), it.get("mgmt_ip"))

        extra = None
        if base_items:  # only look up enrichment when base was the primary
            if mid is not None and str(mid) in by_id:
                extra = by_id[str(mid)]
            elif ip and ip in by_ip:
                extra = by_ip[ip]

        m = dict(it)
        if isinstance(extra, dict):
            # Copy enrich fields if base missing
            for k, v in extra.items():
                if k not in m or m[k] in (None, "", []):
                    m[k] = v

        # Normalize preferred model SKU display
        m["model_display"] = _pick_str(m.get("chassis_name"), m.get("chassisName"), m.get("chassis-name"))

        merged.append(m)

    merged = merged[:max_items]

    counts: Dict[str, int] = {}
    for it in merged:
        sku = _pick_str(it.get("model_display")) or "Unknown"
        counts[sku] = counts.get(sku, 0) + 1

    model_counts = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)

    return {
        "summary": {
            "count": len(merged),
            "model_counts": model_counts,
        },
        "items": merged,
    }


# -----------------------------
# Client-side list filtering (NL → list filtering)
# -----------------------------
# Filter clause extraction + application + LLM-extractor heuristic live in
# backend/nl/list_filters.py; used by the /api/nl endpoint below.
from nl.list_filters import (  # noqa: F401
    extract_filter_clauses,
    resolve_and_apply_filters,
    recompute_model_counts,
    _should_attempt_llm_filters,
)


# -----------------------------
# Tool catalog cache
# -----------------------------
_TOOLS_CACHE: Dict[str, Any] = {"ts": 0.0, "tools": []}


async def get_tools_cached(ttl_s: int = 60, token: Optional[str] = None) -> List[Dict[str, Any]]:
    now = time.time()
    if _TOOLS_CACHE["tools"] and (now - float(_TOOLS_CACHE["ts"]) < ttl_s):
        return list(_TOOLS_CACHE["tools"])
    tools = await mcp_get("/tools", token=token)
    if not isinstance(tools, list):
        tools = []
    # Append virtual tools (client-backend composites) so UI/NL routing can use them
    try:
        existing = {t.get("name") for t in tools if isinstance(t, dict)}
        for vt in VIRTUAL_TOOLS:
            if vt.get("name") not in existing:
                tools.append(vt)
    except Exception:
        pass
    _TOOLS_CACHE["tools"] = tools
    _TOOLS_CACHE["ts"] = now
    return list(tools)


# -----------------------------
# Deterministic routing (fast path)
# -----------------------------
# The big ROUTES + RESTCONF tables (regex → tool name) and the intent
# detectors (is_restconf_intent, is_switch_inventory_intent, etc.) live in
# backend/nl/deterministic.py — pure data + simple regex helpers.
# `pick_tool_deterministic` below stays in main.py because it needs the
# live `_TOOLS_CACHE` for the bare-tool-name shortcut.
from nl.deterministic import (  # noqa: F401
    ROUTES,
    RESTCONF_TOOLS,
    is_restconf_intent,
    is_switch_inventory_intent,
    pick_restconf_tool,
    _GENERIC_HEALTH_TOOLS,
    _RESTCONF_TOPIC_ROUTES,
)

# Matches text that IS a tool name, optionally wrapped as "Run <name>" or "Run <name>."
_BARE_TOOL_NAME_RE = re.compile(
    r"^\s*(?:run\s+)?([a-z][a-z0-9_]+)\s*\.?\s*$", re.I
)

def pick_tool_deterministic(text: str) -> Optional[str]:
    # 0) Exact tool-name shortcut: user typed just the name (or "Run <name>.").
    #    Validate against the cached tool list so random snake_case strings don't match.
    m = _BARE_TOOL_NAME_RE.match(text or "")
    if m:
        candidate = m.group(1).lower()
        known = {(t.get("name") or "").lower() for t in (_TOOLS_CACHE.get("tools") or []) if t}
        if candidate in known:
            return candidate

    # Device-direct (RESTCONF) intent takes priority over all generic routes
    # so "show interfaces on switch 10.x.x.x" never falls into inventory/health tools.
    if is_restconf_intent(text or ""):
        return pick_restconf_tool(text or "")
    for pat, tool in ROUTES:
        if pat.search(text or ""):
            return tool
    return None


# ── LLM-pick helpers (backend/nl/llm_pick.py) ──
# Used by the in-main callers: the natural_language endpoint and the
# example-running endpoints.
from nl.llm_pick import (  # noqa: F401
    score_tool,
    top_tool_candidates,
    tokenize,
    llm_select_tool_ollama,
    llm_explain_ollama,
    llm_select_tool_openai,
    llm_explain_openai,
)

# OpenAI-key helpers — used by the in-main callsites (status/whoami/explain
# endpoints + natural_language dispatch).
from core.llm import (  # noqa: F401
    get_openai_key as _get_openai_key,
    openai_chat as _openai_chat,
)

# Tool-input extractors (fabric/tenant name resolution + RESTCONF
# switch_ip pull) live in backend/nl/extract.py.
from nl.extract import (  # noqa: F401
    _clean_name,
    _extract_after_keyword,
    extract_inputs,
)

# Console summary builder (backend/nl/summary.py).
from nl.summary import build_console_summary  # noqa: F401



async def llm_extract_filters_ollama(user_text: str, sample_item: Dict[str, Any]) -> Dict[str, Any]:
    """Return {"clauses":[...], "explanation": "..."} or {"error": "..."}.
    Never raises. Uses Ollama structured outputs when available.
    """
    if not (OLLAMA_ENABLED and OLLAMA_FILTERS_ENABLED):
        return {"error": "ollama_filters_disabled"}

    try:
        elapsed_ms: Optional[int] = None
        timeout_s = float(OLLAMA_TIMEOUT_FILTERS_SECONDS)
        keymap = _flatten_keypaths(sample_item)
        # Build a compact, high-signal allowed field list (keep prompts small to avoid timeouts).
        raw_fields = [p for p in keymap.values() if isinstance(p, str)]
        # Prefer shallow/simple paths first (e.g., "asn", "role", "name", "fabric.fabric_name")
        def _field_rank(p: str) -> tuple:
            depth = p.count(".")
            return (depth, len(p), p)
        fields = sorted(list(set(raw_fields)), key=_field_rank)
        if len(fields) > OLLAMA_MAX_FIELDS_FOR_FILTERS:
            fields = fields[:OLLAMA_MAX_FIELDS_FOR_FILTERS]

        allowed_ops = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with"]

        # Use /api/chat with format="json" to force well-formed JSON.
        system_msg = (
            "You extract structured filters to apply to a list of JSON objects. "
            "Return ONLY a JSON object (no markdown, no prose) with keys: "
            "clauses (array) and optional explanation (string)."
        )

        user_msg = (
            "Create filter clauses from the user's request.\n"
            f"Allowed fields: {json.dumps(fields, ensure_ascii=False)}\n"
            f"Allowed ops: {', '.join(allowed_ops)}\n"
            f"Max clauses: {OLLAMA_MAX_FILTER_CLAUSES}\n\n"
            "Output JSON shape:\n"
            '{"clauses":[{"field":"<field>","op":"<op>","value":<value>}, ...],"explanation":"..."}\n\n'
            "Rules:\n"
            "- field must be one of Allowed fields (or an obvious alias).\n"
            "- op must be one of Allowed ops.\n"
            "- value should be a number if the user used a number; otherwise a string.\n"
            '- If no filtering requested, return {"clauses":[]}.\n\n'
            f"User request: {user_text}\n"
        )

        payload = {
            "model": OLLAMA_MODEL,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            "options": {
                "temperature": 0.1,
                "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "2048")),
                "num_predict": int(OLLAMA_MAX_TOKENS_FILTERS),
            },
        }

        t0 = time.time()
        timeout = httpx.Timeout(
            timeout=timeout_s,
            connect=min(5.0, timeout_s),
            read=timeout_s,
            write=timeout_s,
            pool=timeout_s,
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
        elapsed_ms = int((time.time() - t0) * 1000)

        if r.status_code >= 400:
            return {"error": "ollama_filters_http", "status": r.status_code, "body": (r.text or "")[:400]}

        data = r.json() if r.content else {}
        content = ""
        if isinstance(data, dict):
            # /api/chat
            msg = data.get("message")
            if isinstance(msg, dict):
                content = (msg.get("content") or "").strip()
            # /api/generate fallback (just in case)
            if not content:
                content = (data.get("response") or "").strip()

        if not content:
            return {"error": "ollama_filters_empty"}

        # content should be JSON; handle occasional "JSON as a string" cases.
        parsed: Any
        try:
            parsed = json.loads(content)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
        except Exception:
            # Last-resort: extract the first {...} block.
            jm = re.search(r"\{.*\}", content, re.S)
            if not jm:
                return {"error": "ollama_filters_bad_json", "body": content[:400]}
            parsed = json.loads(jm.group(0))

        if not isinstance(parsed, dict):
            return {"error": "ollama_filters_bad_json", "body": content[:400]}

        clauses = parsed.get("clauses")
        if clauses is None and isinstance(parsed.get("filters"), list):
            clauses = parsed.get("filters")

        if not isinstance(clauses, list):
            return {"error": "ollama_filters_no_clauses", "body": content[:400]}

        cleaned: List[Dict[str, Any]] = []
        for c in clauses[:OLLAMA_MAX_FILTER_CLAUSES]:
            if not isinstance(c, dict):
                continue
            field = c.get("field")
            op = c.get("op")
            val = c.get("value")
            if not isinstance(field, str) or not field.strip():
                continue
            if not isinstance(op, str) or op.strip().lower() not in allowed_ops:
                continue
            cleaned.append({"field": field.strip(), "op": op.strip().lower(), "value": val})

        return {
            "clauses": cleaned,
            "explanation": parsed.get("explanation") if isinstance(parsed.get("explanation"), str) else "",
        }
    except Exception as e:
        return {
            "error": "ollama_filters_exception",
            "message": str(e)[:400],
            "type": type(e).__name__,
        }
# -----------------------------
# Summarization helpers
# -----------------------------
def cheap_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    payload = (result.get("result") or {}).get("payload") or {}
    inner = payload.get("payload") if isinstance(payload, dict) else None
    payload2 = inner if isinstance(inner, dict) else (payload if isinstance(payload, dict) else {})

    out: Dict[str, Any] = {}
    for k in ("headline", "summary", "warnings", "signals", "counts", "groups", "recommendations", "next_actions"):
        if k in payload2:
            out[k] = payload2[k]

    if not out and isinstance(payload2, dict):
        out["keys"] = sorted(list(payload2.keys()))[:50]
    return out


# -----------------------------
# API
# -----------------------------

# -- Login: REMOVED. The community MCP server has no /oauth/token endpoint
#    and requires no authentication, so there is no login flow. The frontend
#    boots straight into the dashboard with no bearer token.


# -- Health (open — useful for load-balancer probes) ---------------------------
@app.get("/api/health")
async def health():
    try:
        return await mcp_get("/health")
    except Exception:
        return {"ok": True, "note": "MCP /health not reachable", "mcp_base": MCP_BASE_URL}


@app.get("/api/router-status")
async def router_status(token: str = Depends(require_bearer)):
    """Reasoning-router availability flags for any authenticated user.

    Used by the Cross-Fabric → Architecture view to render the
    "thinking" panel next to the Workbench card. Three flags:

      deterministic  — the regex/keyword router. Always true; it's the
                       fallback path and runs first on every request.
      openai_enabled — true if an OpenAI key is configured (either via
                       env or via the runtime /api/openai-key setter).
      ollama_enabled — true if Ollama routing is turned on in client
                       config (admin toggle in /api/client-settings).

    No secrets returned — just availability booleans. Non-admin users
    can call this so the diagram works for everyone, not just ops.
    """
    return {
        "deterministic": True,
        "openai_enabled": bool(_get_openai_key()),
        "ollama_enabled": bool(_client_config.get("ollama_enabled", False)),
        "openai_model": _llm.OPENAI_MODEL,
        "ollama_model": _client_config.get("ollama_model", ""),
    }


# -- Client Settings (MCP client backend config) ------------------------------
@app.get("/api/client-settings")
async def get_client_settings(token: str = Depends(require_bearer)):
    return {
        "mcp_base_url": _client_config["mcp_base_url"],
        "ollama_enabled": _client_config["ollama_enabled"],
        "ollama_base_url": _client_config["ollama_base_url"],
        "ollama_model": _client_config["ollama_model"],
        "openai_key_set": bool(_get_openai_key()),
        "openai_model": _llm.OPENAI_MODEL,
    }

@app.patch("/api/client-settings")
async def patch_client_settings(req: Request, token: str = Depends(require_bearer)):
    """Update the MCP server URL and/or Ollama settings, persist to disk."""
    body = await req.json()
    updated = {}
    for key in ["mcp_base_url", "ollama_enabled", "ollama_base_url", "ollama_model"]:
        if key in body:
            val = body[key]
            if key in ("mcp_base_url", "ollama_base_url"):
                val = str(val).rstrip("/")
            elif key == "ollama_enabled":
                val = val.strip().lower() in ("1", "true", "yes", "on") if isinstance(val, str) else bool(val)
            _client_config[key] = val
            updated[key] = val
    # Write the new state to disk so it survives container restarts.
    _persist_client_settings()
    _audit("client.settings_update", sub=_decode_jwt_payload(token).get("sub"), changes=updated, persisted=True)
    return {"ok": True, "updated": updated, "persisted": True}


@app.post("/api/client-settings/test-mcp")
async def test_mcp_connection(token: str = Depends(require_bearer)):
    """Test connectivity to the configured MCP server."""
    try:
        r = await mcp_get("/health")
        return {"ok": True, "mcp_base_url": _client_config["mcp_base_url"], "response": r}
    except Exception as e:
        return {"ok": False, "mcp_base_url": _client_config["mcp_base_url"], "error": str(e)[:300]}


# -- OpenAI key management -----------------------------------------------------
class OpenAIKeyReq(BaseModel):
    api_key: str = ""
    model: str = ""

@app.post("/api/openai-key")
async def set_openai_key(req: OpenAIKeyReq, token: str = Depends(require_bearer)):
    # Mutate the runtime state in core.llm — that's the single source of
    # truth everyone reads from.
    _llm.set_runtime_key(req.api_key)
    _llm.set_runtime_model(req.model)
    return {"ok": True, "has_key": bool(_get_openai_key()), "model": _llm.OPENAI_MODEL}

@app.get("/api/openai-status")
async def openai_status(token: str = Depends(require_bearer)):
    return {"has_key": bool(_get_openai_key()), "model": _llm.OPENAI_MODEL}


@app.get("/api/whoami")
async def whoami(token: str = Depends(require_bearer)):
    """Static identity — the community edition has no authentication. Returns
    a stable answer for any frontend code that still probes identity."""
    return {
        "sub": "operator",
        "role": "operator",
        "scope": "",
        "scopes": [],
        "exp": None,
    }


@app.get("/api/tools")
async def tools(token: str = Depends(require_bearer)):
    all_tools = await get_tools_cached(ttl_s=60, token=token)
    return _filter_tools_by_token(all_tools, token)


# /api/sites: REMOVED. The community edition is strictly single-XCO — there
# is no multi-site registry and no `site` routing key anywhere.


@app.post("/api/invoke")
async def invoke(req: InvokeReq, token: str = Depends(require_bearer)):
    claims = _decode_jwt_payload(token)
    sub = claims.get("sub", "unknown")
    role = claims.get("role", "unknown")
    t0 = time.monotonic()
    try:
        if req.tool == "inventory_get_switch_inventory_overview":
            payload = await _virtual_inventory_overview(req.inputs or {}, token=token)
            result = {
                "session_id": str(uuid.uuid4()),
                "result": {"tool": req.tool, "status": 200, "payload": payload},
            }
        else:
            result = await mcp_post("/invoke", {"tool": req.tool, "inputs": req.inputs}, token=token)
        _audit("tool.invoke_ok", sub=sub, role=role, tool=req.tool,
               latency_ms=round((time.monotonic() - t0) * 1000))
        return result
    except HTTPException as exc:
        _audit("tool.invoke_fail", sub=sub, role=role, tool=req.tool,
               latency_ms=round((time.monotonic() - t0) * 1000),
               status=exc.status_code, error=str(exc.detail)[:200])
        raise
    except Exception as exc:
        _audit("tool.invoke_fail", sub=sub, role=role, tool=req.tool,
               latency_ms=round((time.monotonic() - t0) * 1000),
               error=str(exc)[:200])
        raise


# -----------------------------
# Agent: read-only investigation skills
# -----------------------------
import agent as _agent


# ── Agent endpoints (backend/agent_routes.py) ─
# The /api/agent/* endpoints + the per-skill helpers (budget gate, openai
# chat factory, webhook fire, invoke_tool / fetch_catalog adapters) live
# in a single APIRouter that we wire here.
from agent_routes import router as _agent_router
app.include_router(_agent_router)


@app.get("/api/audit")
async def audit_log(
    n: int = Query(default=100, ge=1, le=2000),
    token: str = Depends(require_bearer),
):
    """Return the last *n* audit records from the JSONL log."""
    log_path = Path(AUDIT_LOG_PATH)
    if not log_path.exists():
        return []

    lines = log_path.read_text(encoding="utf-8").splitlines()
    recent = lines[-n:] if len(lines) > n else lines

    records: List[Dict[str, Any]] = []
    for line in recent:
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            pass

    records.reverse()  # newest first
    return records


# Examples (kept simple for demo)
def load_local_examples() -> List[str]:
    out: List[str] = []
    if os.path.exists("examples.md"):
        with open("examples.md", "r", encoding="utf-8") as f:
            out += re.findall(r">\s*\"(.*?)\"", f.read())
    # De-dupe
    seen = set()
    uniq = []
    for s in out:
        s = (s or "").strip()
        if s and s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def categorize_example(s: str) -> str:
    t = (s or "").lower()
    if "fabric" in t:
        return "Fabrics"
    if "tenant" in t or "epg" in t:
        return "Tenant/EPG"
    if "alarm" in t or "alert" in t or "fault" in t:
        return "Alarms"
    if "cert" in t or "expir" in t:
        return "Certificates"
    if "platform" in t or "health" in t:
        return "Platform"
    return "General"


def infer_tool_for_example(text: str) -> Optional[str]:
    m = re.search(r"\bRun\s+([a-z0-9_]+)\b", text or "", re.I)
    if m:
        return m.group(1)
    return pick_tool_deterministic(text)


@app.get("/api/examples")
async def examples(_token: str = Depends(require_bearer)):
    ex = load_local_examples()
    items = []
    for e in ex:
        tool = infer_tool_for_example(e)
        inputs = extract_inputs(e, tool) if tool else {}
        items.append({"text": e, "category": categorize_example(e), "tool": tool, "inputs": inputs})
    return {"items": items, "categories": sorted(list({i["category"] for i in items}))}


@app.get("/api/examples/random")
async def examples_random(
    category: Optional[str] = Query(default=None),
    _token: str = Depends(require_bearer),
):
    ex = load_local_examples()
    if not ex:
        return {"example": "Show fabrics health.", "tool": "fabric_get_fabrics_health", "inputs": {}}

    candidates = [e for e in ex if infer_tool_for_example(e) is not None]
    if category:
        candidates = [e for e in candidates if categorize_example(e) == category]

    if not candidates:
        choice = random.choice(ex)
        return {"example": choice}

    choice = random.choice(candidates)
    tool = infer_tool_for_example(choice)
    inputs = extract_inputs(choice, tool) if tool else {}
    return {"example": choice, "tool": tool, "inputs": inputs}



# ---- Console summary helpers (UI-compat) --------------------------------------



@app.post("/api/nl")
async def natural_language(req: NLReq, token: str = Depends(require_bearer)):
    t0 = time.time()

    # Default explain skeleton
    llm_meta: Dict[str, Any] = {"enabled": OLLAMA_ENABLED, "model": OLLAMA_MODEL, "base_url": OLLAMA_BASE_URL}
    candidates_names: List[str] = []
    llm_reason: Optional[str] = None
    det_tool: Optional[str] = None
    det_inputs: Dict[str, Any] = {}

    try:
        # 1) Forced tool (from buttons/examples): never uses LLM
        if req.force_tool:
            tool = req.force_tool
            inputs = req.force_inputs or {}
            router = "forced"
        else:
            want_llm = (req.llm_mode or "auto").strip().lower()

            # 2) Deterministic routing (fast) - always computed, but may be used only as fallback
            det_tool = pick_tool_deterministic(req.text)
            det_inputs = extract_inputs(req.text, det_tool) if det_tool else {}

            use_openai = want_llm == "openai" or (want_llm == "auto" and not det_tool and _get_openai_key())
            use_ollama = (not use_openai) and (want_llm == "ollama" or (want_llm == "auto" and not det_tool))

            tool = None
            inputs = {}

            # 3) LLM routing (optional) — OpenAI preferred if key available, else Ollama
            if use_openai:
                if not _get_openai_key():
                    llm_meta = {**llm_meta, "error": "openai_no_key", "message": "No OpenAI API key configured"}
                else:
                    tools_all = await get_tools_cached(token=token)
                    cand = top_tool_candidates(req.text, tools_all, k=max(5, min(int(req.max_candidates), 50)))
                    candidates_names = [t.get("name") for t in cand if t.get("name")]
                    pick = await llm_select_tool_openai(req.text, cand)
                    if "error" in pick:
                        llm_meta = {**llm_meta, **pick}
                        llm_reason = "llm_failed"
                    else:
                        tool = pick.get("tool")
                        inputs = pick.get("inputs") if isinstance(pick.get("inputs"), dict) else {}
                        llm_reason = pick.get("explanation") or None
            elif use_ollama:
                if not OLLAMA_ENABLED:
                    llm_meta = {**llm_meta, "error": "ollama_disabled", "message": "OLLAMA_ENABLED is false"}
                else:
                    tools_all = await get_tools_cached(token=token)
                    cand = top_tool_candidates(req.text, tools_all, k=max(5, min(int(req.max_candidates), 50)))
                    candidates_names = [t.get("name") for t in cand if t.get("name")]

                    pick = await llm_select_tool_ollama(req.text, cand)
                    if "error" in pick:
                        llm_meta = {**llm_meta, **pick}
                        llm_reason = "llm_failed"
                    else:
                        tool = pick.get("tool")
                        inputs = pick.get("inputs") if isinstance(pick.get("inputs"), dict) else {}
                        llm_reason = pick.get("explanation") or None

            # 4) Choose final tool: prefer LLM choice when available, else deterministic
            llm_provider = "openai" if use_openai else "ollama"
            if tool:
                router = llm_provider
                # LLM may omit fabric/tenant names; enrich only for scoped tools
                try:
                    inputs = {**extract_inputs(req.text, tool), **(inputs or {})}
                except Exception:
                    pass
            elif det_tool:
                tool = det_tool
                inputs = det_inputs
                router = f"{llm_provider}_fallback" if (want_llm in ("ollama", "openai")) else "deterministic"
            else:
                # No deterministic match. For demo UX, fall back to a safe broad overview instead of returning "unknown".
                t = req.text or ""
                if re.search(r"\b(system|environment|platform|cluster)\b", t, re.I) and re.search(r"\b(unhealthy|down|degraded|problem|issue|wrong)\b", t, re.I):
                    tool = "system_get_ha_and_node_health_summary"
                    inputs = {}
                elif re.search(r"\b(unhealthy|down|degraded|problem|issue|wrong)\b", t, re.I):
                    tool = "monitor_get_health"
                    inputs = {}
                else:
                    # Generic safe default when mapping fails
                    tool = "monitor_get_health"
                    inputs = {}
                router = "deterministic_fallback"


        # 4.5) Guardrail override: if the request looks like switch/device inventory but the router
        # picked a generic health tool, force the inventory overview tool instead.
        # Skip the guardrail entirely when device-direct (RESTCONF) intent is present — those
        # queries contain "switch" + an IP but should never be redirected to inventory.
        if tool:
            try:
                if (
                    (tool in _GENERIC_HEALTH_TOOLS or tool.startswith("monitor_"))
                    and is_switch_inventory_intent(req.text)
                    and not is_restconf_intent(req.text)   # ← don't clobber RESTCONF picks
                ):
                    tool = "inventory_get_switch_inventory_overview"
                    # Always keep inputs minimal; allow deterministic extractor to add scope if needed
                    inputs = {**({"max_items": 200}), **(extract_inputs(req.text, tool) or {}), **(inputs or {})}
                    router = (router + "+guardrail") if isinstance(router, str) else "guardrail"
            except Exception:
                pass


        # 4.6) Guard: RESTCONF tool selected but no switch_ip extracted → clear error, don't invoke.
        _has_switch_ip = bool((inputs or {}).get("switch_ip"))
        if tool and tool in RESTCONF_TOOLS and not _has_switch_ip:
            _missing_ip_msg = (
                "Tool '" + tool + "' requires a switch IP address, but none was found in your request. "
                "Please include an IP address, e.g.: 'show lldp on 10.1.2.3'"
            )
            return {
                "picked": {"tool": tool, "inputs": inputs},
                "summary": {},
                "raw": None,
                "assistant_text": None,
                "error": {"error": "missing_switch_ip", "message": _missing_ip_msg},
                "explain": {
                    "user_text": req.text,
                    "router": router,
                    "selected": tool,
                    "deterministic": {"tool": det_tool, "inputs": det_inputs},
                },
            }

        # 5) Invoke selected tool (if any)
        result = None
        error = None
        if tool:
            try:
                if tool == "inventory_get_switch_inventory_overview":
                    # Merge req.include_raw into inputs so the virtual tool passes it
                    # through to inventory_get_switches_widget_table.  Without this,
                    # the sub-call always uses include_raw=False regardless of what
                    # the user toggled in the UI.
                    virt_inputs = {**(inputs or {}), "include_raw": req.include_raw}
                    payload = await _virtual_inventory_overview(virt_inputs, token=token)
                    result = {
                        "session_id": str(uuid.uuid4()),
                        "result": {"tool": tool, "status": 200, "payload": payload},
                    }
                else:
                    # Multi-switch fan-out (e.g. restconf_get_arp_table's
                    # string-or-array `switch_ip`) is handled upstream by the
                    # MCP server — no client-side orchestration needed.
                    result = await invoke_tool(tool, inputs, token=token)
            except Exception as e:
                error = {"error": "invoke_failed", "type": type(e).__name__, "message": str(e), "repr": repr(e)[:400]}
        else:
            error = {"error": "no_match", "message": "No suitable tool matched the request."}

        # Build a compact human answer for the UI

        # 5.5) Client-side filtering for list-style results
        # Option 4: prefer LLM-extracted filters, then fall back to regex parsing.
        filters_applied = None
        try:
            if isinstance(result, dict):
                payload = (result.get("result") or {}).get("payload")
                if isinstance(payload, dict):
                    items = payload.get("items")
                    if isinstance(items, list) and items and all(isinstance(x, dict) for x in items):
                        before_n = len(items)

                        # ---- 1) LLM filter extraction (preferred) ----
                        llm_filters_meta: Dict[str, Any] = {
                            "attempted": False,
                            "enabled": bool(OLLAMA_ENABLED and OLLAMA_FILTERS_ENABLED),
                            "should_attempt": bool(_should_attempt_llm_filters(req.text)),
                        }
                        llm_clauses: List[Dict[str, Any]] = []

                        if llm_filters_meta["enabled"] and llm_filters_meta["should_attempt"]:
                            llm_filters_meta["attempted"] = True
                            llm_pick = await llm_extract_filters_ollama(req.text, items[0])

                            if isinstance(llm_pick, dict) and isinstance(llm_pick.get("clauses"), list):
                                llm_clauses = [c for c in llm_pick.get("clauses") if isinstance(c, dict)]
                                llm_filters_meta.update({
                                    "used": True,
                                    "explanation": llm_pick.get("explanation") or None,
                                })
                            else:
                                llm_filters_meta.update({
                                    "used": False,
                                    "error": (llm_pick.get("error") if isinstance(llm_pick, dict) else "unknown"),
                                    "message": (llm_pick.get("message") if isinstance(llm_pick, dict) else None),
                                    "type": (llm_pick.get("type") if isinstance(llm_pick, dict) else None),
                                    "status": (llm_pick.get("status") if isinstance(llm_pick, dict) else None),
                                    "body": (llm_pick.get("body") if isinstance(llm_pick, dict) else None),
                                })

                        applied = False

                        if llm_clauses:
                            filtered_items, resolved = resolve_and_apply_filters(items, llm_clauses)
                            # Safety net: if the LLM filter zeroes out a non-empty list it almost
                            # certainly misread a display/column query as a filter — skip it.
                            if resolved and (len(filtered_items) > 0 or before_n == 0):
                                after_n = len(filtered_items)
                                payload["items"] = filtered_items
                                if tool == "inventory_get_switch_inventory_overview":
                                    if isinstance(payload.get("summary"), dict):
                                        payload["summary"]["count"] = after_n
                                        payload["summary"]["model_counts"] = recompute_model_counts(filtered_items)

                                filters_applied = {
                                    "source": "ollama",
                                    "llm": llm_filters_meta,
                                    "extracted": llm_clauses,
                                    "resolved": resolved,
                                    "before": before_n,
                                    "after": after_n,
                                }
                                applied = True

                        # ---- 2) Regex fallback ----
                        if not applied:
                            clauses = extract_filter_clauses(req.text)
                            if clauses:
                                filtered_items, resolved = resolve_and_apply_filters(items, clauses)
                                if resolved:
                                    after_n = len(filtered_items)
                                    payload["items"] = filtered_items
                                    if tool == "inventory_get_switch_inventory_overview":
                                        if isinstance(payload.get("summary"), dict):
                                            payload["summary"]["count"] = after_n
                                            payload["summary"]["model_counts"] = recompute_model_counts(filtered_items)

                                    filters_applied = {
                                        "source": "regex",
                                        "llm": llm_filters_meta,
                                        "extracted": clauses,
                                        "resolved": resolved,
                                        "before": before_n,
                                        "after": after_n,
                                    }

        except Exception:
            filters_applied = None



        headline = None
        try:
            headline = result.get("result", {}).get("payload", {}).get("payload", {}).get("headline")
        except Exception:
            headline = None

        answer = headline.strip() if isinstance(headline, str) and headline.strip() else (
            (f"Ran **{tool}**." if tool else "No tool selected.")
        )

        assistant_text = None
        llm_explain_meta: Dict[str, Any] = {}
        if req.llm_mode == "openai" and _get_openai_key() and tool and error is None:
            llm_explain_meta = {"enabled": True, "provider": "openai", "model": _llm.OPENAI_MODEL}
            exp = await llm_explain_openai(req.text, tool, inputs, result)
            if isinstance(exp, dict) and exp.get("text"):
                assistant_text = exp.get("text")
                llm_explain_meta["used"] = True
            else:
                llm_explain_meta["used"] = False
                if isinstance(exp, dict):
                    llm_explain_meta.update({k: exp.get(k) for k in ["error", "status", "body", "message", "type", "repr"] if exp.get(k) is not None})
        elif req.llm_mode == "ollama" and OLLAMA_ENABLED and tool and error is None:
            llm_explain_meta = {"enabled": True, "provider": "ollama", "model": OLLAMA_MODEL, "base_url": OLLAMA_BASE_URL}
            exp = await llm_explain_ollama(req.text, tool, inputs, result)
            if isinstance(exp, dict) and exp.get("text"):
                assistant_text = exp.get("text")
                llm_explain_meta["used"] = True
            else:
                llm_explain_meta["used"] = False
                if isinstance(exp, dict):
                    llm_explain_meta.update({k: exp.get(k) for k in ["error", "status", "body", "message", "type", "repr"] if exp.get(k) is not None})
        explain = {
            "user_text": req.text,
            "router": router,
            "selected": {"tool": tool, "inputs": inputs},
            "deterministic": {"tool": det_tool, "inputs": det_inputs},
            "candidates": candidates_names,
            "llm": {**llm_meta, **({"reason": llm_reason} if llm_reason else {})},
            "llm_explain": llm_explain_meta,
             "filters_applied": filters_applied,
        }

        
        # UI expects:
        #   - raw: full /invoke envelope (session_id/result/...)
        #   - summary: stable object for quick rendering
        invoked_payload = None
        if isinstance(result, dict):
            try:
                invoked_payload = (result.get("result") or {}).get("payload") or {}
                if isinstance(invoked_payload, dict):
                    invoked_payload = invoked_payload.get("payload")
            except Exception:
                invoked_payload = None

        return {
            "picked": {"tool": tool, "inputs": inputs} if tool else None,
            "summary": build_console_summary(tool or "", invoked_payload),
            "raw": result,
            "assistant_text": assistant_text,
            "answer": answer,
            "error": error,
            "explain": explain,
            "elapsed_ms": int((time.time() - t0) * 1000),
        }
    except Exception as e:
        # Never throw a FastAPI HTTPException here; keep shape stable for the UI/CLI.
        return {
            "picked": None,
            "answer": "NL router failed.",
            "result": None,
            "error": {"error": "nl_exception", "type": type(e).__name__, "message": str(e), "repr": repr(e)[:400]},
            "explain": {"user_text": req.text, "router": "error", "llm": llm_meta},
            "elapsed_ms": int((time.time() - t0) * 1000),
        }


# Plans pipeline + mutation ledger + the Tier-4 admin endpoints
# (clients / RBAC / webhooks / multi-site registry) have been REMOVED
# from the community edition.


@app.get("/api/suggest")
async def get_suggestions(
    last_tool: str = Query(...),
    limit: int = Query(default=5, ge=1, le=20),
    token: str = Depends(require_bearer),
):
    return await mcp_get(f"/suggest?last_tool={last_tool}&limit={limit}", token=token)


# The static-UI mount that serves the built frontend follows.


if os.path.isdir(FRONTEND_DIST):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    async def ui_root():
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

    @app.get("/{path:path}")
    async def ui_fallback(path: str):
        if path.startswith("api/") or path == "api":
            raise HTTPException(status_code=404, detail="Not Found")
        p = os.path.join(FRONTEND_DIST, path)
        if os.path.isfile(p):
            return FileResponse(p)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
else:
    print(f"[WARN] Frontend dist not found at: {FRONTEND_DIST}. Run: cd ../frontend && npm run build")
