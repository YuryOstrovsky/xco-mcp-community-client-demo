"""
NL Console summary builder.

After /api/nl invokes the picked tool, this module turns the tool's
payload into the stable shape the Console UI expects:

  {
    headline?: str,
    kpis?: {k: number},
    warnings?: [str],
    recommendations?: [str],
    next_actions?: [str],
  }

Three sources are combined:
  1. The tool's own `summary` block (preferred when present).
  2. `signals.warnings` + `recommendations` + `next_actions` from the
     tool's response envelope.
  3. Heuristic "top offenders" extracted from common list shapes
     (groups[].drivers[], offenders, unhealthy_devices, devices).

Plus a per-tool enrichment hook — currently only the fabric-health
tools get one (surface unhealthy_count as a KPI, synthesize friendly
next-action suggestions when the tool didn't provide any).

Extracted from backend/main.py in task #95.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List


def build_console_summary(tool: str, payload: Any) -> Dict[str, Any]:
    """
    Return a stable shape for the Console UI (Summary/Charts).

    Frontend expects:
      summary: { headline?: str, kpis?: {k: number}, warnings?: [str], recommendations?: [str], next_actions?: [str] }
    """
    summary_obj: Dict[str, Any] = {}
    warnings: List[str] = []
    recommendations: List[str] = []
    next_actions: List[str] = []

    def _json(v: Any) -> str:
        try:
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            return str(v)

    def _pretty_inputs(inputs: Any) -> str:
        if not isinstance(inputs, dict) or not inputs:
            return "{}"
        return _json(inputs)

    def _action_to_text(a: Any) -> str:
        if isinstance(a, str):
            return a
        if not isinstance(a, dict):
            return str(a)
        reason = a.get("reason") or a.get("why") or a.get("message") or ""
        t = a.get("tool") or a.get("name") or a.get("action") or "run_tool"
        inputs = a.get("inputs") or {}
        if reason:
            return f"{reason}  (Run `{t}` with { _pretty_inputs(inputs) })"
        return f"Run `{t}` with { _pretty_inputs(inputs) }"

    def _extract_offenders(p: Any, limit: int = 3) -> List[str]:
        if not isinstance(p, dict):
            return []
        offenders: List[str] = []

        # Pattern A: device health rollup -> groups[].drivers[]
        groups = p.get("groups")
        if isinstance(groups, list):
            for g in groups:
                if isinstance(g, dict) and isinstance(g.get("drivers"), list):
                    for d in g["drivers"]:
                        if not isinstance(d, dict):
                            continue
                        hn = d.get("hostname") or d.get("name") or d.get("id")
                        ip = d.get("ip")
                        sev = d.get("severity") or d.get("health") or d.get("status")
                        reason = d.get("reason")
                        parts = [str(x) for x in [hn, f"({ip})" if ip else None, sev] if x]
                        line = " ".join(parts)
                        if reason:
                            line += f" — {reason}"
                        offenders.append(line)
                        if len(offenders) >= limit:
                            return offenders

        # Pattern B: any list under common keys
        for key in ["offenders", "unhealthy_devices", "devices", "drivers"]:
            lst = p.get(key)
            if isinstance(lst, list):
                for d in lst:
                    if not isinstance(d, dict):
                        continue
                    hn = d.get("hostname") or d.get("name") or d.get("id")
                    ip = d.get("ip") or d.get("mgmt_ip")
                    sev = d.get("severity") or d.get("health") or d.get("status")
                    reason = d.get("reason")
                    parts = [str(x) for x in [hn, f"({ip})" if ip else None, sev] if x]
                    line = " ".join(parts)
                    if reason:
                        line += f" — {reason}"
                    offenders.append(line)
                    if len(offenders) >= limit:
                        return offenders

        return offenders[:limit]

    # -------------------------
    # Prefer explicit Tier-2 payload structure
    # -------------------------
    if isinstance(payload, dict):
        if isinstance(payload.get("summary"), dict):
            summary_obj = payload["summary"]
        else:
            # Heuristics: preserve a useful headline + a few counters
            headline = payload.get("headline") or payload.get("message") or payload.get("status")
            if isinstance(headline, str):
                summary_obj["headline"] = headline

        # Signals
        sig = payload.get("signals")
        if isinstance(sig, dict):
            ws = sig.get("warnings")
            if isinstance(ws, list):
                warnings.extend([str(x) for x in ws if x])

        # Recommendations
        recs = payload.get("recommendations")
        if isinstance(recs, list):
            recommendations.extend([str(x) for x in recs if x])

        # Next actions (convert dicts to friendly strings so UI doesn't show raw JSON)
        na = payload.get("next_actions")
        if isinstance(na, list):
            next_actions.extend([_action_to_text(x) for x in na if x])

        # Add "top offenders" hint if present anywhere
        offenders = _extract_offenders(payload, limit=3)
        if offenders:
            warnings.append("Top offenders: " + ", ".join(offenders))

    # -------------------------
    # Tool-specific enrichment (helps demo feel smart even without LLM)
    # -------------------------
    if tool in ("fabric_get_fabric_health_summary", "fabric_get_fabrics_health", "fabric_get_fabric_health"):
        # Try to surface a small KPI if present
        if isinstance(payload, dict):
            unhealthy = payload.get("unhealthy_count")
            if isinstance(unhealthy, (int, float)):
                summary_obj.setdefault("kpis", {})
                if isinstance(summary_obj["kpis"], dict):
                    summary_obj["kpis"]["unhealthy_count"] = int(unhealthy)

        # Provide friendly next actions if tool didn't already provide any
        if not next_actions:
            # Prefer fabric_name (this is what your deterministic router already uses)
            fab = None
            if isinstance(payload, dict):
                fab = (payload.get("filter") or {}).get("fabric_name") or payload.get("fabric_name") or payload.get("name")
            if not fab:
                fab = "DC"
            next_actions.extend([
                f"Get quick root-cause hints (Run `fabric_get_fabric_health_summary` with {_json({'fabric_name': fab, 'include_errors': True})}).",
                f"Check recent executions (Run `fabric_get_execution_list` with {_json({'fabric_name': fab})}).",
                f"Review fabric events (Run `fabric_get_event_history_list` with {_json({'fabric_name': fab})}).",
            ])

    # Ensure stable keys for the UI
    out = {
        "tool": tool,
        "summary": summary_obj,
        "warnings": warnings,
        "recommendations": recommendations,
        "next_actions": next_actions,
    }
    return out
