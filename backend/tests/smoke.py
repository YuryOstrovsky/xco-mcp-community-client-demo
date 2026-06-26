#!/usr/bin/env python3
"""Endpoint smoke test (community edition) — hit every surviving endpoint,
check it returns HTTP 2xx + no `error` field where applicable.
Run after every service restart that involved a refactor:

    cd backend && BASE_URL=http://127.0.0.1:5174 .venv/bin/python -m tests.smoke

The community client has NO authentication — there is no token to mint and
no Authorization header is sent. (The enterprise original minted a
service-account token via core.auth.token_cache and asserted no-auth gates;
both are gone.)

Catches regressions like the OPENAI_MODEL NameError that escaped
/api/health-only verification because the bug only fired on the /api/nl
branch.

Exit code 0 = all green; non-zero = at least one failure. Designed to run
in <10s. Requires the community backend running and pointed at a reachable
community MCP server (MCP_BASE_URL).
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

import httpx


BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:5174").rstrip("/")
TIMEOUT = 30.0


# ── Validators ──────────────────────────────────────────────────────
def _ok_router_status(d: Dict[str, Any]) -> Optional[str]:
    if "deterministic" not in d:
        return "missing 'deterministic' key"
    if "openai_model" not in d:
        return "missing 'openai_model' (PEP 562 regression?)"
    return None


def _ok_nl(d: Dict[str, Any]) -> Optional[str]:
    if d.get("error"):
        err = d["error"]
        msg = err.get("message") or err.get("error") or str(err) if isinstance(err, dict) else str(err)
        return f"backend returned error: {msg[:200]}"
    if not d.get("picked"):
        return "no tool was picked"
    return None


def _ok_tools(d: Any) -> Optional[str]:
    if not isinstance(d, list):
        return f"expected list, got {type(d).__name__}"
    if len(d) < 10:
        return f"suspiciously few tools: {len(d)}"
    return None


def _ok_agent_skills(d: Any) -> Optional[str]:
    """Agent skills list must include the read-only investigation skills
    shipped in the community edition. Regression check: if we lose a skill
    file, or the loader stops parsing frontmatter, this catches it."""
    if not isinstance(d, dict) or "skills" not in d:
        return f"missing 'skills' key — got {type(d).__name__}"
    skills = d["skills"]
    if not isinstance(skills, list) or len(skills) < 1:
        return "expected non-empty 'skills' list"
    names = {s.get("name") for s in skills if isinstance(s, dict)}
    must_have = {"fabric-health-investigation", "xco-health-check"}
    missing = must_have - names
    if missing:
        return f"missing required skill(s): {sorted(missing)}"
    # The community edition ships NO proposal_capable skills — every skill
    # must be read-only. A skill flipping to proposal_capable here would
    # mean a mutation-driving skill leaked back in.
    leaked = [s.get("name") for s in skills if isinstance(s, dict) and s.get("proposal_capable")]
    if leaked:
        return f"proposal_capable skill(s) present in community edition: {sorted(leaked)}"
    return None


CASES: List[Tuple[str, str, str, Optional[Dict[str, Any]], list]] = [
    # ── Health + meta ────────────────────────────────────────────
    ("health",          "GET",  "/api/health",          None, []),
    ("router-status",   "GET",  "/api/router-status",   None, [_ok_router_status]),
    ("client-settings", "GET",  "/api/client-settings", None, []),
    ("openai-status",   "GET",  "/api/openai-status",   None, []),
    ("whoami",          "GET",  "/api/whoami",          None, []),
    ("tools",           "GET",  "/api/tools",           None, [_ok_tools]),

    # ── NL routing — deterministic + force_tool (no LLM key needed) ──
    ("nl deterministic", "POST", "/api/nl",
        {"text": "show fabric health", "llm_mode": "deterministic"}, [_ok_nl]),
    ("nl force_tool",    "POST", "/api/nl",
        {"text": "Run fabric_get_fabrics.", "force_tool": "fabric_get_fabrics",
         "force_inputs": {}, "include_raw": True}, [_ok_nl]),

    # ── Agent skills (read-only investigation registry) ──────────
    ("agent skills list", "GET", "/api/agent/skills", None, [_ok_agent_skills]),
]


async def run_one(
    client: httpx.AsyncClient,
    label: str, method: str, path: str,
    body: Optional[Dict[str, Any]],
    validators: list,
) -> Tuple[bool, str]:
    """Returns (ok, message). No auth header — the community server needs none."""
    try:
        if method == "GET":
            r = await client.get(BASE_URL + path)
        else:
            r = await client.post(BASE_URL + path, json=body)
    except Exception as e:
        return False, f"request raised: {type(e).__name__}: {str(e)[:200]}"
    if not (200 <= r.status_code < 300):
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    try:
        data = r.json()
    except Exception as e:
        return False, f"non-JSON response: {str(e)[:120]}"
    for v in validators:
        err = v(data)
        if err:
            return False, err
    return True, "ok"


async def main() -> int:
    total = len(CASES)
    print(f"smoke test (community) → {BASE_URL}")
    print(f"  {total} checks, no auth, timeout {TIMEOUT}s each")
    print()

    passed = 0
    failed: List[Tuple[str, str]] = []
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for label, method, path, body, validators in CASES:
            ok, msg = await run_one(client, label, method, path, body, validators)
            marker = "✓" if ok else "✗"
            print(f"  {marker} {label:24}  {method:4} {path:32}  {msg if not ok else ''}")
            if ok:
                passed += 1
            else:
                failed.append((label, msg))

    print()
    if failed:
        print(f"FAIL — {len(failed)} of {total} checks failed:")
        for label, msg in failed:
            print(f"  • {label}: {msg}")
        return 1
    print(f"PASS — all {total} checks green")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
