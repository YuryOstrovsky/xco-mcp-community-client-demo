"""Proposal extraction — pulls the structured ```proposal``` JSON block
out of a proposal_capable skill's synthesis and normalizes it to
always carry a `steps[]` list. Single-step proposals (skills #5-#9)
and chained proposals (skill #10+) both come out of this with the
same downstream shape.

Public surface:
  extract_proposal(synthesis) → dict | None
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── Proposal extraction (mutation-driven skills) ──────────────────────────────
# Proposal-capable skills (e.g. safe-fabric-cleanup) end their synthesis with
# a fenced JSON block:
#
#   ```proposal
#   {"tool": "...", "inputs": {...}, "rollback": {...}, "desc": "...",
#    "why": "...", "risk": "low|medium|high"}
#   ```
#
# Or, when refused:
#
#   ```no_proposal
#   {"reason": "..."}
#   ```
#
# The host passes the extracted dict to the operator approval UI; on
# approval, it goes through mutation_gate.execute_confirmed_mutation
# (which uses the Plans flow — same path chat-confirmed mutations take).

_PROPOSAL_BLOCK_RE = re.compile(
    r"```proposal\s*\n(\{.*?\})\s*\n```",
    re.DOTALL | re.IGNORECASE,
)


def extract_proposal(synthesis: str) -> Optional[Dict[str, Any]]:
    """Return the proposal dict from a synthesis ending with a ```proposal``` block,
    or None if the block is missing / malformed / refused (```no_proposal```).
    Refused proposals return None — the synthesis text still surfaces the reason.

    Accepts two shapes:
      1. Single-step (skills #5-#9): {tool, inputs, rollback, desc, why, risk}
      2. Chained (skill #10+): {steps: [{tool, inputs, ...}], desc, why, risk}

    For uniformity downstream, both shapes get NORMALIZED to always carry a
    steps list — a single-step proposal becomes one-element steps. The
    original top-level tool/inputs are preserved for back-compat with the
    existing ProposalCard rendering (which still reads them) and approve
    endpoint (which prefers steps when present)."""
    if not synthesis:
        return None
    m = _PROPOSAL_BLOCK_RE.search(synthesis)
    if not m:
        return None
    raw = m.group(1)
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    # Either a top-level tool OR a non-empty steps list is required.
    has_tool = "tool" in parsed
    steps = parsed.get("steps") if isinstance(parsed.get("steps"), list) else None
    if not has_tool and not steps:
        return None
    # Normalize: ensure steps is always present. Single-step proposals get
    # a synthesized one-element steps list. Chained proposals without a
    # top-level tool get the first step's tool surfaced (so ProposalCard's
    # header rendering still works without per-shape branching).
    if not steps:
        steps = [{
            "tool": parsed["tool"],
            "inputs": parsed.get("inputs", {}),
            "rollback": parsed.get("rollback"),
            "desc": parsed.get("desc", ""),
        }]
        parsed["steps"] = steps
    else:
        # Per-step desc cap so the UI doesn't get a step description
        # with a 10KB blob. Cap at 200 chars per step — same shape the
        # top-level desc gets.
        for st in steps:
            if isinstance(st, dict) and "desc" in st and isinstance(st["desc"], str):
                st["desc"] = st["desc"][:200]
        if not has_tool:
            # Surface the first step's tool at the top level so existing
            # callers reading `proposal.tool` keep working.
            parsed["tool"] = steps[0].get("tool", "")
    # Defensive: cap free-text fields so a malicious skill output can't
    # render an enormous proposal card.
    for k in ("desc", "why"):
        if k in parsed and isinstance(parsed[k], str):
            parsed[k] = parsed[k][:300]
    # Stamp the proposal with an emission timestamp (UTC ISO8601).
    # The approve endpoint uses this to enforce a max-age window.
    from datetime import datetime, timezone
    parsed["emitted_at"] = datetime.now(timezone.utc).isoformat()
    return parsed


