"""
Agent loop — read-only investigation skills via OpenAI tool-use.

V1 ships exactly one skill (`fabric-health-investigation`) and runs as a
bounded function-calling loop:

  user query
    ↓
  build messages = [system: skill body + rules, user: query]
  loop (≤ MAX_TURNS):
    ↓ POST /chat/completions with tools=<allowlist>
    ↓ if model returns tool_calls → invoke each via mcp_post('/invoke', …)
    ↓ append the results as tool messages
    ↓ if model returns content (no tool_calls) → that's the synthesis; stop
  return { trace, synthesis }

Hard rules enforced server-side (not relying on model honesty):
  • Tool calls outside the skill's `allowed_tools` are refused.
  • Hard caps on turns and total tool invocations.
  • Per-tool-call timeout.
  • Read-only: no path that creates plans or invokes mutating tools.

This module is intentionally self-contained — it imports a few helpers
from main.py at call time but exposes a single async entry point so
main.py can wire a thin /api/agent/investigate endpoint over it.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx


# ── Bounds ────────────────────────────────────────────────────────────────────
MAX_TURNS = 10          # max model turns (one turn = one chat completion call)
MAX_TOOL_CALLS = 25     # max tool invocations across the whole investigation
TOOL_CALL_TIMEOUT_S = 30
LLM_TIMEOUT_S = 60


# Skill loader extracted to agent/skills.py.
from .skills import _SKILLS_DIR, _SKILL_CACHE, _parse_frontmatter, load_skill, list_skills  # noqa: F401


# ── Tool schema → OpenAI function specs ───────────────────────────────────────
# We map each allowed tool to a minimal OpenAI function spec. The MCP server's
# tool catalog is rich, but for V1 we keep arg schemas terse and let the model
# pass through the dict; the host validates server-side.

# ── Live tool catalog (auto-derived from MCP server /api/tools) ─────────────
# Catalog fetch + JSON-Schema → OpenAI-function-spec projection moved to
# core/tool_catalog.py so other callers (admin tools UI, schema-driven
# input forms) can share the cache. Re-exported under the historical
# private names so existing call sites in this file don't churn.
from core.tool_catalog import (
    get_tool_catalog,
    project_to_openai_spec as _project_to_openai_spec,
    project_to_tools_array,
)


async def tools_for_skill_async(
    skill: Dict[str, Any],
    fetch_catalog,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Build the OpenAI `tools` array from the skill's allowlist by pulling
    the live MCP catalog. Returns (tool_specs, missing_tool_names) so the
    caller can warn if the skill references a tool the server doesn't expose.

    Thin wrapper over core.tool_catalog.project_to_tools_array — adds the
    skill-specific hints binding.
    """
    hints = skill.get("tool_hints") or {}
    if not isinstance(hints, dict):
        hints = {}
    return await project_to_tools_array(
        fetch_catalog,
        list(skill.get("allowed_tools", [])),
        hints=hints,
    )


# Tools that talk directly to a switch over RESTCONF — they don't accept a
# `site` parameter (the site is inferred from the IP). Don't auto-inject site.
_NO_SITE_TOOLS: set = {
    "restconf_get_bgp_summary",
    "restconf_get_interface_all",
    "restconf_show_firmware_version",
}


# Legacy hand-coded fallback. Kept ONLY as a fallback if the catalog fetch
# fails at runtime (network blip during the agent loop), so investigations
# can still run with a small known-good subset. Auto-generated specs from
# the live catalog are the primary path.
_TOOL_SPECS: Dict[str, Dict[str, Any]] = {
    "fabric_get_fabrics_health": {
        "description": "Per-fabric health summary across all fabrics. Tier-1.",
        "parameters": {
            "type": "object",
            "properties": {
                "site": {"type": "string", "description": "Optional XCO site id (multi-site)."},
            },
        },
    },
    "fabric_get_fabric_health_summary": {
        "description": "Tier-2 composite: rich global + per-fabric health summary. Combines fabrics-health, fabric-health, and per-device rollup. Best single starting call when investigating a specific fabric.",
        "parameters": {
            "type": "object",
            "properties": {
                "fabric_name": {"type": "string", "description": "Optional: scope to one fabric."},
                "site": {"type": "string"},
            },
        },
    },
    "fabric_get_fabrics": {
        "description": "List all fabrics with type, stage, and device summary.",
        "parameters": {"type": "object", "properties": {"site": {"type": "string"}}},
    },
    "fabric_get_fabric_overview": {
        "description": "Tier-2: compact fabric overview (headline + optional errors/devices summary).",
        "parameters": {
            "type": "object",
            "properties": {
                "fabric_name": {"type": "string"},
                "site": {"type": "string"},
            },
            "required": ["fabric_name"],
        },
    },
    "fabric_get_fabric_errors_summary": {
        "description": "Tier-2: fabric configuration/deployment errors summary for one fabric.",
        "parameters": {
            "type": "object",
            "properties": {
                "fabric_name": {"type": "string"},
                "site": {"type": "string"},
            },
            "required": ["fabric_name"],
        },
    },
    "inventory_getswitches": {
        "description": "List all switches across the inventory (IP, name, role, fabric, firmware).",
        "parameters": {"type": "object", "properties": {"site": {"type": "string"}}},
    },
    "inventory_get_fabric_switches_summary": {
        "description": "Tier-2: list switches that belong to a specific fabric (preferred when scoped).",
        "parameters": {
            "type": "object",
            "properties": {
                "fabric_name": {"type": "string"},
                "site": {"type": "string"},
            },
            "required": ["fabric_name"],
        },
    },
    "inventory_get_switch_health_status": {
        "description": "Per-switch health: reachability, CPU, memory. One IP at a time.",
        "parameters": {
            "type": "object",
            "properties": {
                "switch_ip": {"type": "string"},
                "site": {"type": "string"},
            },
            "required": ["switch_ip"],
        },
    },
    "inventory_get_device_health_rollup": {
        "description": "Tier-2: explains which devices are driving fabric health up or down. Use BEFORE per-switch probes when multiple devices flagged.",
        "parameters": {
            "type": "object",
            "properties": {
                "fabric_name": {"type": "string"},
                "site": {"type": "string"},
            },
        },
    },
    "faultmanager_get_alarm_summary": {
        "description": "Counts of active alarms grouped by severity (CRITICAL/MAJOR/MINOR/INFO).",
        "parameters": {"type": "object", "properties": {"site": {"type": "string"}}},
    },
    "fault_get_active_alarms_top": {
        "description": "Tier-2: top ACTIVE alarms by severity with the resources they affect.",
        "parameters": {
            "type": "object",
            "properties": {
                "fabric_name": {"type": "string"},
                "severity": {"type": "string", "description": "CRITICAL | MAJOR | MINOR | INFO"},
                "limit": {"type": "integer"},
                "site": {"type": "string"},
            },
        },
    },
    "fault_get_alarm_details_with_context": {
        "description": "Tier-2: explain ONE alarm — what it is, what it impacts, related resources.",
        "parameters": {
            "type": "object",
            "properties": {
                "alarm_id": {"type": "string"},
                "site": {"type": "string"},
            },
            "required": ["alarm_id"],
        },
    },
    "restconf_get_bgp_summary": {
        "description": "BGP neighbor status via direct RESTCONF. PARAM SHAPE: pass {\"switch_ips\": [\"10.x.y.z\"]} (array, plural) for one or more switches, OR {\"fabric_name\": \"...\"} for a whole fabric. Do NOT pass `switch_ip` (singular). RESTCONF tools do NOT accept `site`.",
        "parameters": {
            "type": "object",
            "properties": {
                "switch_ips": {"type": "array", "items": {"type": "string"}, "description": "List of switch management IPs."},
                "fabric_name": {"type": "string", "description": "Alternative: scope to a fabric instead of explicit IPs."},
            },
        },
    },
    "restconf_get_interface_all": {
        "description": "All interfaces on ONE switch via RESTCONF. PARAM: {\"switch_ip\": \"10.x.y.z\"} (singular). RESTCONF tools do NOT accept `site`.",
        "parameters": {
            "type": "object",
            "properties": {"switch_ip": {"type": "string"}},
            "required": ["switch_ip"],
        },
    },
    "restconf_show_firmware_version": {
        "description": "Firmware version on ONE switch via RESTCONF. PARAM: {\"switch_ip\": \"10.x.y.z\"} (singular). RESTCONF tools do NOT accept `site`.",
        "parameters": {
            "type": "object",
            "properties": {"switch_ip": {"type": "string"}},
            "required": ["switch_ip"],
        },
    },
}


def _tools_for_skill_fallback(skill: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fallback: build the tools array from the legacy hand-coded _TOOL_SPECS.
    Used only when the live catalog fetch fails. The primary path is
    `tools_for_skill_async` (auto-derived from MCP /api/tools)."""
    tools: List[Dict[str, Any]] = []
    for name in skill["allowed_tools"]:
        spec = _TOOL_SPECS.get(name)
        if not spec:
            continue
        tools.append({
            "type": "function",
            "function": {
                "name": name,
                "description": spec["description"],
                "parameters": spec["parameters"],
            },
        })
    return tools


# ── Per-skill pre-loop hooks ────────────────────────────────────────────────
# Extracted to agent/resolvers.py in task #92 — target discovery, MCT-partner
# detection, RESTCONF reachability probes, hardware-fingerprint comparison.
from .resolvers import (  # noqa: F401
    _extract_fabric_names,
    _extract_switches_per_fabric,
    _count_switches_per_fabric,
    _resolve_target_for_post_upgrade,
    _resolve_for_pre_upgrade_check,
    _resolve_for_pre_rma_check,
    _PRE_LOOP_HOOKS,
)


# ── Post-synthesis verdict validation ────────────────────────────────────────
# Extracted to agent/verdict.py in task #92.
from .verdict import (  # noqa: F401
    _CHECKLIST_ROW_RE,
    _extract_synthesis_check_verdicts,
    _ALARM_HEALTH_CHECK_ROW,
    _compute_overall_verdict_from_checklist,
    _VERDICT_SUMMARY_RULES,
    _extract_summary_block,
    _check_summary_matches_overall,
    _check_skill1_summary_freshness,
    _detect_verdict_mismatches,
)




async def run_investigation(
    *,
    query: str,
    skill_name: str,
    token: str,
    site: Optional[str],
    invoke_tool,              # async fn(tool_name, inputs, token) → result dict
    openai_chat_completions,  # async fn(messages, tools, max_tokens, temperature) → raw response dict
    fetch_catalog=None,       # async fn() → MCP /tools catalog (list of {name, description, input_schema})
    on_event=None,            # optional async fn(event_dict) → None — called for each trace step as it happens (streaming)
    max_turns: int = MAX_TURNS,         # override the model-turn cap (chat delegation uses a lower value)
    max_tool_calls: int = MAX_TOOL_CALLS,  # override the total tool-call cap
) -> Dict[str, Any]:
    """Run one investigation. Returns:
        {
          "skill": "...",
          "trace": [ {step, role, ...}, ... ],
          "synthesis": "markdown",       # empty if the loop hit a hard cap
          "stop_reason": "...",
          "tool_calls": int,
          "turns": int,
          "elapsed_ms": int,
        }
    """
    t0 = time.monotonic()
    skill = load_skill(skill_name)
    if not skill["read_only"]:
        # Defensive: this V1 only supports read-only skills.
        return {
            "skill": skill_name,
            "trace": [],
            "synthesis": "",
            "stop_reason": "skill_not_read_only",
            "tool_calls": 0,
            "turns": 0,
            "elapsed_ms": 0,
        }

    allowed: set[str] = set(skill["allowed_tools"])

    # Build the OpenAI tools array — primary path is auto-derived from the
    # live MCP catalog; fall back to the hand-coded _TOOL_SPECS dict only if
    # catalog fetch fails so an investigation can still run.
    tools: List[Dict[str, Any]] = []
    catalog_missing: List[str] = []
    catalog_error: Optional[str] = None
    if fetch_catalog is not None:
        try:
            tools, catalog_missing = await tools_for_skill_async(skill, fetch_catalog)
        except Exception as exc:
            catalog_error = f"{type(exc).__name__}: {str(exc)[:160]}"
    if not tools:
        # Catalog unreachable or returned nothing — fall back.
        tools = _tools_for_skill_fallback(skill)

    site_hint = f"\n\nThe operator's currently selected XCO site is: {site!r}. Pass site={site!r} on every tool call." if site else ""

    messages: List[Dict[str, Any]] = [
        {
            "role": "system",
            "content": skill["body"] + site_hint,
        },
    ]

    # Skill-specific pre-loop resolution. For skills where the model has
    # shown it can hallucinate or refuse on obvious data (e.g. target
    # fabric discovery for post-firmware-upgrade-verification), we compute
    # the answer here and inject it BOTH as system context (informational)
    # AND as a directive appended to the user query (the model follows
    # user instructions far more reliably than system messages).
    pre_resolve_result: Optional[Dict[str, str]] = None
    pre_loop_hook = _PRE_LOOP_HOOKS.get(skill_name) or _PRE_LOOP_HOOKS.get(skill["name"])
    if pre_loop_hook is not None:
        try:
            pre_resolve_result = await pre_loop_hook(
                query=query, site=site, invoke_tool=invoke_tool, token=token,
            )
        except Exception as exc:
            pre_resolve_result = {
                "context_msg": f"PRE-RESOLVE ERROR: {type(exc).__name__}: {str(exc)[:140]}",
                "query_directive": "",
            }
    if pre_resolve_result:
        ctx = pre_resolve_result.get("context_msg") or ""
        if ctx:
            messages.append({"role": "system", "content": ctx})
        directive = pre_resolve_result.get("query_directive") or ""
        if directive:
            query = query + directive

    messages.append({"role": "user", "content": query})

    trace: List[Dict[str, Any]] = []
    tool_calls_total = 0
    turn = 0
    synthesis = ""
    stop_reason = "ok"

    # Track host-computed verdicts as preprocessors fire. Used post-synthesis
    # to detect when the model wrote a verdict that contradicts the data.
    computed_verdicts: Dict[str, str] = {}

    # Helper: append to trace + (optionally) emit a streaming event. We use
    # this everywhere instead of bare trace.append so the streaming endpoint
    # gets each step as it happens, not in one batch at the end.
    async def emit(event: Dict[str, Any]) -> None:
        trace.append(event)
        if on_event is not None:
            try:
                await on_event(event)
            except Exception:
                # An on_event failure must NEVER break the loop. If the
                # consumer's connection drops mid-stream, we still want to
                # finish and have the audit log record completion.
                pass

    # Note where the tool specs came from so the user can see in the trace.
    if catalog_error:
        await emit({
            "step": 0, "role": "system", "kind": "catalog_fallback",
            "text": f"Live MCP catalog fetch failed ({catalog_error}); using hand-coded fallback specs.",
        })
    elif fetch_catalog is not None:
        n_specs = len(tools)
        msg = f"Loaded {n_specs} tool spec(s) from live MCP catalog"
        if catalog_missing:
            msg += f"; skill referenced {len(catalog_missing)} tool(s) not in catalog: {catalog_missing}"
        await emit({"step": 0, "role": "system", "kind": "catalog_loaded", "text": msg})

    # Surface the pre-resolution in the trace so the user can confirm the
    # hook fired with the right resolution. The display preview is just the
    # context block + a one-line summary of the directive — the model sees
    # the full versions in `messages`.
    if pre_resolve_result:
        ctx_text = pre_resolve_result.get("context_msg") or ""
        directive_text = (pre_resolve_result.get("query_directive") or "").strip()
        # Pull the first imperative line of the directive for a clean preview.
        directive_preview = ""
        if directive_text:
            for ln in directive_text.split("\n"):
                ln = ln.strip()
                if ln and not ln.startswith("[") and len(ln) > 8:
                    directive_preview = ln
                    break
        preview_lines = ctx_text.split("\n")[:8]
        if directive_preview:
            preview_lines.append("→ " + directive_preview[:200])
        await emit({
            "step": 0, "role": "system", "kind": "pre_resolve",
            "text": "\n".join(preview_lines),
        })

        # If the pre-loop hook pre-ran any tools (e.g. firmware_check_storage
        # for the pre-upgrade-check skill), emit those as their own trace
        # events so the user can see the host did the work, not the model.
        pre_run_storage = pre_resolve_result.get("pre_run_storage_trace")
        if pre_run_storage:
            await emit({
                "step": 0, "role": "system", "kind": "pre_run_tool",
                "tool": pre_run_storage.get("tool"),
                "text": (
                    f"Host pre-ran {pre_run_storage.get('tool')} on "
                    f"{pre_run_storage.get('n_devices')} device(s). "
                    f"Verdict: {pre_run_storage.get('verdict')}. "
                    f"{pre_run_storage.get('summary')}"
                ),
            })
        if pre_resolve_result.get("pre_run_storage_error"):
            await emit({
                "step": 0, "role": "system", "kind": "pre_run_tool_error",
                "text": f"Pre-run firmware_check_storage failed: {pre_resolve_result['pre_run_storage_error']}",
            })

    while turn < max_turns:
        turn += 1
        try:
            resp = await openai_chat_completions(
                messages=messages,
                tools=tools,
                max_tokens=1500,
                temperature=0.2,
            )
        except Exception as exc:
            stop_reason = "llm_error"
            await emit({"step": turn, "role": "system", "kind": "llm_error", "error": str(exc)[:300]})
            break

        if "error" in resp:
            stop_reason = "llm_error"
            await emit({"step": turn, "role": "system", "kind": "llm_error", "error": str(resp.get("error")) + ": " + str(resp.get("body") or resp.get("message", ""))[:300]})
            break

        choice = resp.get("choices", [{}])[0]
        msg = choice.get("message", {}) or {}
        finish = choice.get("finish_reason")
        tool_calls = msg.get("tool_calls") or []

        # Always append the model's message (so the next turn has the same chain)
        # OpenAI requires the assistant message be present before tool messages.
        messages.append({
            "role": "assistant",
            "content": msg.get("content") or "",
            "tool_calls": tool_calls or None,
        })

        # Trace what the model said (thinking/intent)
        if msg.get("content"):
            await emit({"step": turn, "role": "assistant", "kind": "thought", "text": msg["content"][:1200]})

        if not tool_calls:
            # Model produced final answer
            synthesis = (msg.get("content") or "").strip()
            stop_reason = finish or "stop"
            break

        # Execute each tool call this turn
        for tc in tool_calls:
            if tool_calls_total >= max_tool_calls:
                stop_reason = "max_tool_calls"
                break
            tool_calls_total += 1
            fn = tc.get("function") or {}
            fn_name = fn.get("name", "")
            try:
                fn_args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                fn_args = {}
            tc_id = tc.get("id", f"call_{tool_calls_total}")

            if fn_name not in allowed:
                err = f"Tool {fn_name!r} is not in this skill's allowlist; refusing."
                await emit({"step": turn, "role": "tool", "kind": "tool_refused", "tool": fn_name, "args": fn_args, "error": err})
                messages.append({
                    "role": "tool", "tool_call_id": tc_id, "name": fn_name,
                    "content": json.dumps({"error": "tool_not_allowed", "detail": err}),
                })
                continue

            # Inject site hint if not provided — but only for tools that
            # actually accept it (RESTCONF tools don't, they speak directly
            # to a switch by IP and would 400 on an unknown param).
            if site and "site" not in fn_args and fn_name not in _NO_SITE_TOOLS:
                fn_args = {**fn_args, "site": site}

            await emit({"step": turn, "role": "tool", "kind": "tool_call", "tool": fn_name, "args": fn_args})

            try:
                tool_result = await _bounded(invoke_tool(fn_name, fn_args, token), TOOL_CALL_TIMEOUT_S)
            except TimeoutError:
                tool_result = {"error": "timeout", "detail": f"Tool {fn_name} exceeded {TOOL_CALL_TIMEOUT_S}s"}
            except Exception as exc:
                tool_result = {"error": "tool_exception", "detail": str(exc)[:300]}

            # Run every applicable tool-result preprocessor in sequence.
            # Each one strips/translates server-side BEFORE the model sees
            # the payload (the LLM has shown repeatedly that data-level
            # signals beat prompt instructions). New skills extend this
            # by appending to _TOOL_RESULT_PREPROCESSORS — no loop changes.
            processed_result = tool_result
            for pp in _TOOL_RESULT_PREPROCESSORS:
                if not pp.applies_to(fn_name):
                    continue
                processed_result, event = pp.process(fn_name, processed_result)
                if event:
                    await emit({
                        "step": turn, "role": "system", "kind": pp.kind,
                        **event,
                    })

            # Capture host-computed check verdicts so we can validate the
            # final synthesis against them.
            if fn_name in _ALARM_TOOL_NAMES:
                inner = processed_result
                if isinstance(inner.get("result"), dict):
                    inner = inner["result"].get("payload", inner)
                if isinstance(inner.get("payload"), dict):
                    inner = inner["payload"]
                summ_block = inner.get("summary") if isinstance(inner, dict) else None
                if isinstance(summ_block, dict):
                    cv = summ_block.get("_agent_check_verdict_alarm_health")
                    if isinstance(cv, str):
                        computed_verdicts["alarm_health"] = cv
                        computed_verdicts["alarm_health_reason"] = (
                            summ_block.get("_agent_check_verdict_alarm_health_reason") or ""
                        )
                    sv = summ_block.get("_agent_verdict")
                    if isinstance(sv, str):
                        computed_verdicts["severity_verdict"] = sv
                    fr = summ_block.get("_agent_alarms_freshness")
                    if isinstance(fr, str):
                        computed_verdicts["alarm_freshness"] = fr

            payload_for_model = _shrink_for_model(processed_result)
            await emit({"step": turn, "role": "tool", "kind": "tool_result", "tool": fn_name, "result_preview": _summary_preview(tool_result)})
            messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "name": fn_name,
                "content": json.dumps(payload_for_model, default=str)[:12000],
            })

        if tool_calls_total >= MAX_TOOL_CALLS:
            stop_reason = "max_tool_calls"
            break

    if turn >= MAX_TURNS and not synthesis:
        stop_reason = "max_turns"

    # Force-synthesis fallback: if we ran out of turns or tool calls before
    # the model produced a final report, ask it once more — without tools —
    # to synthesize from what it already has. This guarantees the user gets
    # a useful answer even on bounded runs.
    if not synthesis and stop_reason in ("max_turns", "max_tool_calls"):
        messages.append({
            "role": "user",
            "content": (
                "You hit the investigation budget. Stop calling tools. "
                "Synthesize a final report from the data you ALREADY have, "
                "in the exact Markdown format defined in your system prompt. "
                "If something is unknown, say so explicitly — do not invent."
            ),
        })
        try:
            resp = await openai_chat_completions(
                messages=messages,
                tools=[],   # no tools — force a textual answer
                max_tokens=1500,
                temperature=0.2,
            )
            if "error" not in resp:
                forced = (resp.get("choices", [{}])[0].get("message", {}) or {}).get("content", "").strip()
                if forced:
                    synthesis = forced
                    await emit({"step": turn + 1, "role": "assistant", "kind": "forced_synthesis", "text": forced[:1200]})
        except Exception as exc:
            await emit({"step": turn + 1, "role": "system", "kind": "forced_synthesis_error", "error": str(exc)[:200]})

    # ── Post-synthesis verdict validation ────────────────────────────────────
    # If the model wrote a checklist verdict that contradicts the host-
    # computed verdict, force ONE rewrite with explicit corrections. This
    # catches the failure mode where the model fabricates a FAIL with
    # invented justification ("Active alarms present") on data that says
    # otherwise.
    if synthesis and computed_verdicts:
        mismatches = _detect_verdict_mismatches(skill["name"], synthesis, computed_verdicts)
        # Always emit a trace event saying the validator ran — this lets the
        # user see in the trace whether the validator fired and what it
        # decided. (Without this, debugging "did the rewrite happen?" was
        # guesswork.)
        await emit({
            "step": turn + 1, "role": "system", "kind": "validator_ran",
            "text": (
                f"Post-synthesis validator: skill={skill['name']!r}, "
                f"computed_verdicts={computed_verdicts!r}, "
                f"mismatches_found={len(mismatches)}"
                + (
                    " — proceeding to corrective rewrite."
                    if mismatches else " — synthesis matches computed verdicts."
                )
            ),
        })
        if mismatches:
            def _summarize(m: Dict[str, str]) -> str:
                kind = m.get("kind", "check_row")
                if kind == "check_row":
                    return (
                        f"row {m.get('row')} ({m.get('check', 'check')}): "
                        f"claimed {m.get('claimed')}, host-computed {m.get('computed')}"
                    )
                if kind == "summary_overall":
                    return f"Summary contradicts checklist (expected '{m.get('computed')}')"
                if kind == "summary_freshness":
                    return (
                        f"Summary asserts active state but freshness=all_stale "
                        f"({m.get('claimed_phrase', '')!r})"
                    )
                return m.get("reason", "verdict mismatch")
            await emit({
                "step": turn + 1, "role": "system", "kind": "verdict_mismatch",
                "text": (
                    "Detected synthesis/data mismatch: "
                    + "; ".join(_summarize(m) for m in mismatches)
                    + ". Forcing rewrite."
                ),
            })
            correction_lines = [
                "Your draft synthesis contradicts host-computed authoritative",
                "verdicts and/or contains an internally-inconsistent Summary.",
                "Rewrite the FULL report using the corrections below:",
                "",
            ]
            for m in mismatches:
                kind = m.get("kind", "check_row")
                if kind == "check_row":
                    correction_lines.append(
                        f"- Checklist row {m.get('row')} ({m.get('check')}): your draft "
                        f"said '{m.get('claimed')}' but the authoritative verdict from "
                        f"the data is '{m.get('computed')}'. Reason: {m.get('reason')}. "
                        f"USE '{m.get('computed')}' as the Result column for that row."
                    )
                elif kind == "summary_overall":
                    correction_lines.append(
                        f"- Summary line is inconsistent with the checklist. The "
                        f"checklist supports overall verdict '{m.get('computed')}'. "
                        f"{m.get('reason')} Rewrite the Summary line to match — "
                        f"and update Findings, Likely root cause / Likely blockers, "
                        f"and Recommended next steps so they don't contradict "
                        f"the Summary."
                    )
                elif kind == "summary_freshness":
                    correction_lines.append(
                        f"- Summary uses the phrase '{m.get('claimed_phrase')}' but "
                        f"the alarms are all stale (pre-existing, >24h old). "
                        f"{m.get('reason')}"
                    )
                else:
                    correction_lines.append(f"- {m.get('reason') or 'Verdict mismatch.'}")
            correction_lines.append("")
            correction_lines.append(
                "Update the entire report — Summary, Findings, Likely root "
                "cause / Likely blockers, and Recommended next steps — to be "
                "INTERNALLY CONSISTENT with the corrected verdict(s). For "
                "example, if the corrected overall verdict is 'verified with "
                "advisory' or 'ready with caveats', the Likely blockers / "
                "Likely root cause section should say 'N/A — no blockers'. "
                "Do NOT mention this correction process in the report — "
                "produce it as if you had used the correct verdicts the "
                "first time."
            )
            messages.append({
                "role": "assistant",
                "content": synthesis,
                "tool_calls": None,
            })
            messages.append({
                "role": "user",
                "content": "\n".join(correction_lines),
            })
            try:
                resp = await openai_chat_completions(
                    messages=messages,
                    tools=[],   # no tools — pure rewrite
                    max_tokens=1800,
                    temperature=0.1,
                )
                if "error" not in resp:
                    rewritten = (resp.get("choices", [{}])[0].get("message", {}) or {}).get("content", "").strip()
                    if rewritten:
                        synthesis = rewritten
                        await emit({
                            "step": turn + 1, "role": "assistant",
                            "kind": "verdict_corrected_synthesis",
                            "text": rewritten[:1200],
                        })
            except Exception as exc:
                await emit({
                    "step": turn + 1, "role": "system", "kind": "verdict_correction_error",
                    "error": str(exc)[:200],
                })

            # Fallback: even after the LLM rewrite, the model sometimes
            # reintroduces the wrong verdict. Apply deterministic text fixes
            # for the check-row Result column — most surgical, least risky.
            still_wrong = _detect_verdict_mismatches(skill["name"], synthesis, computed_verdicts)
            row_mismatches = [m for m in still_wrong if m.get("kind") == "check_row"]
            if row_mismatches:
                fixed = synthesis
                for m in row_mismatches:
                    try:
                        row_n = int(m.get("row", "0"))
                    except ValueError:
                        continue
                    new_v = m.get("computed", "").upper()
                    if not new_v or row_n <= 0:
                        continue
                    # Replace the Result column on this specific row. Pattern
                    # matches the row's pipe-delimited cells; replaces only the
                    # 3rd cell (Result). Tolerant of varying whitespace.
                    pat = re.compile(
                        r"(\|\s*" + str(row_n) + r"\s*\|[^|\n]+\|\s*)(?:PASS|FAIL|ADVISORY|SKIP)(\s*\|)",
                        re.IGNORECASE,
                    )
                    fixed_new = pat.sub(r"\g<1>" + new_v + r"\g<2>", fixed, count=1)
                    if fixed_new != fixed:
                        fixed = fixed_new
                if fixed != synthesis:
                    await emit({
                        "step": turn + 1, "role": "system", "kind": "verdict_text_patched",
                        "text": (
                            "LLM rewrite still had wrong check-row verdicts; "
                            f"applied deterministic text fix to {len(row_mismatches)} "
                            "row(s). Final synthesis is the patched text."
                        ),
                    })
                    synthesis = fixed

    return {
        "skill": skill["name"],
        "skill_meta": {
            "name": skill["name"],
            "description": skill.get("description", ""),
            "read_only": skill.get("read_only", True),
            "allowed_tools": skill.get("allowed_tools", []),
        },
        "bounds": {
            "max_turns": MAX_TURNS,
            "max_tool_calls": MAX_TOOL_CALLS,
            "tool_call_timeout_s": TOOL_CALL_TIMEOUT_S,
            "llm_timeout_s": LLM_TIMEOUT_S,
        },
        "trace": trace,
        "synthesis": synthesis,
        "stop_reason": stop_reason,
        "tool_calls": tool_calls_total,
        "turns": turn,
        "elapsed_ms": int((time.monotonic() - t0) * 1000),
        # If the skill is proposal-capable AND the synthesis ends with a
        # fenced ```proposal {...} block, extract it for the host to render
        # an Approve & Execute card. None when no proposal (refused or skill
        # isn't proposal-capable).
        #
        # The extractor stamps the proposal with `emitted_at` (UTC ISO8601)
        # so the approve endpoint can refuse stale proposals — a defense
        # against the "operator left the tab open overnight, lab state
        # drifted, mutation no longer makes sense" case. See main.py's
        # approve handler for the expiry check.
        "proposal": extract_proposal(synthesis) if skill.get("proposal_capable") else None,
    }


# Proposal extraction extracted to agent/proposal.py.
from .proposal import _PROPOSAL_BLOCK_RE, extract_proposal  # noqa: F401


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _bounded(coro, seconds: int):
    import asyncio
    return await asyncio.wait_for(coro, timeout=seconds)


# ── Tool-result filters / preprocessors ──────────────────────────────────────
# Extracted to agent/filters.py in task #92 — see that module for the alarm
# stripping, BGP normalizer, firmware-storage verdict injector, and the
# `_TOOL_RESULT_PREPROCESSORS` registry the loop walks for each tool call.
from .filters import (  # noqa: F401
    _RESOLVED_ALARM_PATTERNS,
    _is_resolved_alarm_message,
    _classify_group_age,
    _sample_is_resolved,
    _SEVERITY_RANK,
    _compute_verdict_from_groups,
    _filter_resolved_alarms,
    _normalize_bgp_summary,
    _ToolResultPreprocessor,
    _ALARM_TOOL_NAMES,
    _alarm_filter_pp,
    _bgp_normalizer_pp,
    _firmware_storage_pp,
    _TOOL_RESULT_PREPROCESSORS,
    _shrink_for_model,
    _summary_preview,
)


