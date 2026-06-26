# Agent routes — read-only investigation.
#
# Provides the bounded, read-only investigation endpoints.
#
# Endpoints provided:
#   • GET  /api/agent/skills              — skill registry metadata
#   • POST /api/agent/investigate         — bounded read-only run (non-streaming)
#   • POST /api/agent/investigate/stream  — SSE-streaming variant
#
# Module-level helpers (named without underscores when intentionally
# exposed for testing — see backend/tests/test_agent.py):
#   • AGENT_PROPOSAL_MAX_AGE_SECONDS  — proposal-expiry cap (15 min)
#   • check_skill_budget(name)        — per-skill monthly USD gate
#   • make_skill_openai_chat(name)    — factory: skill-tagged LLM closure
#   • fire_proposal_webhook(...)      — best-effort outbound webhook (inert
#                                       unless agent_proposal_webhook_url set)
#   • agent_invoke_tool(tool, inputs, token) — MCP-call adapter
#   • agent_fetch_catalog(token)      — /tools fetch for the agent loop

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.audit import audit as _audit, logger
from core.auth import require_bearer, decode_jwt_payload as _decode_jwt_payload
from core.settings import _client_config
from core.mcp_client import mcp_get, mcp_post
from core.openai_usage import (
    skill_month_cost_usd as _skill_month_cost_usd,
    read_openai_usage_window as _read_openai_usage_window,
)
import core.llm as _llm
from core.llm import openai_chat_with_tools as _core_openai_chat_with_tools

import agent as _agent


router = APIRouter()


# ─── Request models ────────────────────────────────────────────────────

class InvestigateReq(BaseModel):
    query: str
    skill: str


# ─── Module-level helpers ──────────────────────────────────────────────

# Max age between proposal emission and operator approval. Older than
# this and the approve endpoint refuses with HTTP 409 — the operator
# must re-run the investigation because lab state may have drifted.
AGENT_PROPOSAL_MAX_AGE_SECONDS = 15 * 60


async def fire_proposal_webhook(
    skill: str, source: str, payload: Dict[str, Any],
) -> None:
    """Best-effort POST of a proposal-emission event to the configured
    outbound webhook (agent_proposal_webhook_url in client_settings).
    Slack-compatible shape; failures audited but never raise."""
    url = (_client_config.get("agent_proposal_webhook_url") or "").strip()
    if not url:
        return  # disabled — no-op
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, json=payload)
        if r.status_code >= 400:
            _audit("agent.webhook_send_fail", skill=skill, source=source,
                   status=r.status_code, error=r.text[:200])
            logger.warning("agent proposal webhook → HTTP %s", r.status_code)
        else:
            _audit("agent.webhook_sent", skill=skill, source=source, status=r.status_code)
    except Exception as exc:
        _audit("agent.webhook_send_fail", skill=skill, source=source,
               error=str(exc)[:200])
        logger.warning("agent proposal webhook failed: %s", exc)


def check_skill_budget(skill_name: str) -> Optional[Dict[str, Any]]:
    """Per-skill monthly USD budget check. Returns a dict with
    {cap_usd, spent_usd, exceeded, reason} when the skill is OVER
    budget — caller should refuse the run. Returns None when no cap
    is configured (skill is unrestricted) or when the cap has room.

    Budgets live in client_settings under `agent_skill_monthly_budgets_usd`
    as a dict {<skill_name>: <usd_cap>}. cap=0.0 disables the skill
    entirely; missing skills have no cap."""
    if not skill_name:
        return None
    budgets = _client_config.get("agent_skill_monthly_budgets_usd") or {}
    if not isinstance(budgets, dict):
        return None
    cap = budgets.get(skill_name)
    if cap is None:
        return None
    try:
        cap_f = float(cap)
    except (TypeError, ValueError):
        return None
    if cap_f <= 0.0:
        return {"cap_usd": 0.0, "spent_usd": 0.0, "exceeded": True, "reason": "disabled"}
    spent = _skill_month_cost_usd(skill_name)
    if spent >= cap_f:
        return {"cap_usd": round(cap_f, 4), "spent_usd": round(spent, 4),
                "exceeded": True, "reason": "monthly_cap_exceeded"}
    return None


def make_skill_openai_chat(skill_name: str):
    """Factory: returns an LLM-call closure tagged with the specific
    skill name. So a run of `safe-fabric-cleanup` writes usage records
    with source="agent_skill:safe-fabric-cleanup". The aggregator's
    by_source bucket then yields per-skill totals for free."""
    safe_skill = (skill_name or "").strip() or "unknown"
    src = f"agent_skill:{safe_skill}"

    async def _impl(messages: list, tools: list, max_tokens: int, temperature: float) -> dict:
        return await _core_openai_chat_with_tools(
            messages, tools, max_tokens, temperature,
            timeout=_agent.LLM_TIMEOUT_S, source=src,
        )
    return _impl


async def agent_invoke_tool(tool: str, inputs: Dict[str, Any], token: str) -> Dict[str, Any]:
    """Adapter that routes the agent's tool call through the same path
    as /api/invoke (so audit + auth behave identically). Read-only by
    intent — enforced by the skill's allowlist server-side."""
    if tool == "inventory_get_switch_inventory_overview":
        # Lazy import to break the circular dep: main.py owns this
        # virtual composite (shared with the regular /api/invoke path)
        # and we don't want to invert the import direction just for
        # one tool. Documented exception to the "no lazy imports" rule.
        from main import _virtual_inventory_overview
        payload = await _virtual_inventory_overview(inputs or {}, token=token)
        return {"session_id": str(uuid.uuid4()), "result": {"tool": tool, "status": 200, "payload": payload}}
    return await mcp_post("/invoke", {"tool": tool, "inputs": inputs}, token=token)


async def agent_fetch_catalog(token: str):
    """Fetch the live MCP /tools catalog so the agent loop can
    auto-derive OpenAI function specs."""
    return await mcp_get("/tools", token=token)


# ─── Endpoints ─────────────────────────────────────────────────────────

@router.get("/api/agent/skills")
async def list_agent_skills(token: str = Depends(require_bearer)):
    """List available investigation skills (metadata only)."""
    return {"skills": _agent.list_skills()}


@router.post("/api/agent/investigate/stream")
async def agent_investigate_stream(req: InvestigateReq, token: str = Depends(require_bearer)):
    """Run an investigation and stream each step as it happens (SSE)."""
    from core.sse import queue_stream, sse_response

    claims = _decode_jwt_payload(token)
    sub = claims.get("sub", "unknown")
    role = claims.get("role", "unknown")
    t0 = time.monotonic()

    budget = check_skill_budget(req.skill)
    if budget and budget.get("exceeded"):
        _audit("agent.skill_budget_blocked", sub=sub, role=role, skill=req.skill,
               cap_usd=budget.get("cap_usd"), spent_usd=budget.get("spent_usd"),
               reason=budget.get("reason"))
        raise HTTPException(
            status_code=429,
            detail=(
                f"Skill '{req.skill}' is over its monthly budget "
                f"(spent ${budget.get('spent_usd', 0):.4f} of ${budget.get('cap_usd', 0):.4f} cap). "
                "Adjust agent_skill_monthly_budgets_usd in client settings to raise."
            ) if budget.get("reason") == "monthly_cap_exceeded" else
            (f"Skill '{req.skill}' is disabled (budget=0 in client settings)."),
        )

    async def _fetch_catalog_for_this_run():
        return await agent_fetch_catalog(token)

    async def runner(emit):
        try:
            result = await _agent.run_investigation(
                query=req.query, skill_name=req.skill, token=token, site=None,
                invoke_tool=agent_invoke_tool,
                openai_chat_completions=make_skill_openai_chat(req.skill),
                fetch_catalog=_fetch_catalog_for_this_run,
                on_event=emit,
            )
            await emit({"kind": "done", **result})
            _audit("agent.investigate_ok", sub=sub, role=role, skill=req.skill,
                   query=req.query[:200],
                   tool_calls=result.get("tool_calls"),
                   turns=result.get("turns"),
                   stop_reason=result.get("stop_reason"),
                   latency_ms=result.get("elapsed_ms"),
                   streamed=True)
            proposal = result.get("proposal")
            if proposal:
                await fire_proposal_webhook(req.skill, "interactive", {
                    "text": f"🤖 Agent proposal — {req.skill} suggested {proposal.get('tool')}: {proposal.get('desc', '')}",
                    "skill": req.skill, "source": "interactive",
                    "operator": sub, "query": req.query[:200],
                    "proposal": proposal,
                })
        except FileNotFoundError as exc:
            await emit({"kind": "error", "error": str(exc), "status": 404})
        except Exception as exc:
            _audit("agent.investigate_fail", sub=sub, role=role, skill=req.skill,
                   latency_ms=round((time.monotonic() - t0) * 1000),
                   error=str(exc)[:200], streamed=True)
            raise

    return sse_response(queue_stream(runner))


@router.post("/api/agent/investigate")
async def agent_investigate(req: InvestigateReq, token: str = Depends(require_bearer)):
    """Run a bounded read-only investigation loop and return the synthesis."""
    claims = _decode_jwt_payload(token)
    sub = claims.get("sub", "unknown")
    role = claims.get("role", "unknown")
    t0 = time.monotonic()

    budget = check_skill_budget(req.skill)
    if budget and budget.get("exceeded"):
        _audit("agent.skill_budget_blocked", sub=sub, role=role, skill=req.skill,
               cap_usd=budget.get("cap_usd"), spent_usd=budget.get("spent_usd"),
               reason=budget.get("reason"))
        raise HTTPException(
            status_code=429,
            detail=(
                f"Skill '{req.skill}' is over its monthly budget "
                f"(spent ${budget.get('spent_usd', 0):.4f} of ${budget.get('cap_usd', 0):.4f} cap)."
            ) if budget.get("reason") == "monthly_cap_exceeded" else
            (f"Skill '{req.skill}' is disabled (budget=0 in client settings)."),
        )

    try:
        async def _fetch_catalog_for_this_run():
            return await agent_fetch_catalog(token)

        result = await _agent.run_investigation(
            query=req.query, skill_name=req.skill, token=token, site=None,
            invoke_tool=agent_invoke_tool,
            openai_chat_completions=make_skill_openai_chat(req.skill),
            fetch_catalog=_fetch_catalog_for_this_run,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        _audit("agent.investigate_fail", sub=sub, role=role, skill=req.skill,
               latency_ms=round((time.monotonic() - t0) * 1000),
               error=str(exc)[:200])
        raise HTTPException(status_code=500, detail=str(exc)[:300])

    _audit("agent.investigate_ok", sub=sub, role=role, skill=req.skill,
           query=req.query[:200],
           tool_calls=result.get("tool_calls"),
           turns=result.get("turns"),
           stop_reason=result.get("stop_reason"),
           latency_ms=result.get("elapsed_ms"))

    proposal = result.get("proposal")
    if proposal:
        await fire_proposal_webhook(req.skill, "interactive", {
            "text": f"🤖 Agent proposal — {req.skill} suggested {proposal.get('tool')}: {proposal.get('desc', '')}",
            "skill": req.skill, "source": "interactive",
            "operator": sub, "query": req.query[:200],
            "proposal": proposal,
        })
    return result
