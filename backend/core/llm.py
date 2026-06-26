# LLM helpers — OpenAI chat completions (with + without function-calling).
#
# Two entry points:
#   • openai_chat(messages, ...)             — plain chat completions
#   • openai_chat_with_tools(messages, ...)  — same, but the function-calling
#                                              variant the agent loop drives
#
# Both go through the same HTTP path (POST {base}/chat/completions) and
# both record token usage via core.openai_usage so the daily-cost-cap +
# the admin /api/admin/openai-usage endpoint both see the same numbers.
#
# Runtime key handling: env var seeds OPENAI_API_KEY at import; the
# frontend can override at runtime via /api/openai-key (which calls
# set_runtime_key()). get_openai_key() resolves runtime-first, env-second.
# Same pattern for the model — operators can pick a different model from
# the UI without a service restart.

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

from .openai_usage import log_openai_usage


# ── Env-derived defaults ─────────────────────────────────────────────
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Runtime-mutable key — frontend sets via /api/openai-key without restart.
_openai_runtime_key: str = ""


def set_runtime_key(api_key: str) -> None:
    """Update the runtime OpenAI key. Called by the /api/openai-key endpoint."""
    global _openai_runtime_key
    _openai_runtime_key = (api_key or "").strip()


def set_runtime_model(model: str) -> None:
    """Update the runtime OpenAI model. Empty string is ignored (preserves
    whatever was set before / the env default)."""
    global OPENAI_MODEL
    model = (model or "").strip()
    if model:
        OPENAI_MODEL = model


def get_openai_key() -> str:
    """Resolve the active OpenAI key — runtime override beats env default."""
    return _openai_runtime_key or OPENAI_API_KEY


# Default LLM timeout for function-calling calls; the agent loop overrides
# this with its own LLM_TIMEOUT_S value (typically 60s) by passing timeout=.
DEFAULT_LLM_TIMEOUT_S: float = 60.0


async def openai_chat(
    messages: List[Dict[str, Any]],
    max_tokens: int = 512,
    temperature: float = 0.2,
    *,
    source: str = "chat",
) -> Dict[str, Any]:
    """Call OpenAI-compatible chat completions. Returns {"content": str} or {"error": ...}.

    `source` is recorded in the usage log so we can break costs down per call
    site (chat / tool_router / explain / agent_skill / etc.).
    """
    key = get_openai_key()
    if not key:
        return {"error": "openai_no_key", "message": "No OpenAI API key configured"}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {"model": OPENAI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{OPENAI_BASE_URL}/chat/completions", json=payload, headers=headers)
        if r.status_code >= 400:
            return {"error": "openai_http", "status": r.status_code, "body": r.text[:400]}
        data = r.json()
        # Record token usage for cost tracking. Best-effort — never raises.
        usage = data.get("usage") or {}
        log_openai_usage(
            model=data.get("model") or OPENAI_MODEL,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            source=source,
        )
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        return {"content": content}
    except Exception as e:
        return {"error": "openai_exception", "message": str(e)[:200]}


async def openai_chat_with_tools(
    messages: list,
    tools: list,
    max_tokens: int,
    temperature: float,
    *,
    timeout: Optional[float] = None,
    source: str = "agent_skill",
) -> dict:
    """OpenAI chat-completions with function-calling. Returns the raw response
    dict (or {"error": ...}) — the agent loop reads choices[0].message itself.
    Logs usage under the given source (default 'agent_skill').
    """
    key = get_openai_key()
    if not key:
        return {"error": "openai_no_key", "message": "No OpenAI API key configured. Set it in the AI Console (⚙)."}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload: Dict[str, Any] = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    try:
        async with httpx.AsyncClient(timeout=timeout or DEFAULT_LLM_TIMEOUT_S) as client:
            r = await client.post(f"{OPENAI_BASE_URL}/chat/completions", json=payload, headers=headers)
        if r.status_code >= 400:
            return {"error": "openai_http", "status": r.status_code, "body": r.text[:400]}
        data = r.json()
        usage = data.get("usage") or {}
        log_openai_usage(
            model=data.get("model") or OPENAI_MODEL,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            source=source,
        )
        return data
    except Exception as e:
        return {"error": "openai_exception", "message": str(e)[:200]}
