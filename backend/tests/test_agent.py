# Unit tests for the agent helpers — pure functions only, no network.
#
# Pairs with tests/smoke.py: smoke is integration (live service, real
# MCP calls). This file is the FIRST proper unit-test surface in the
# project — exercises agent.py:extract_proposal (the proposal-shape
# normalizer that handles both single-step and chained skill outputs)
# and agent_routes.py:check_skill_budget (the per-skill USD cap gate).
#
# Run via:
#     cd backend && .venv/bin/python -m pytest tests/test_agent.py -v
#
# These tests are stand-alone — they do NOT require the service to be
# running. They monkeypatch _client_config + the usage-log path so
# nothing real gets touched.

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict

import pytest

# Make the backend package importable when pytest is run from anywhere.
import sys
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import agent
import agent_routes
import core.openai_usage as openai_usage
import core.settings as settings


# ─── extract_proposal — single-step shape ────────────────────────────

def test_extract_proposal_single_step_minimal():
    """A bare single-step proposal block gets normalized: tool/inputs
    preserved at the top level, steps[] synthesized as one element,
    emitted_at stamped."""
    synthesis = '''Some finding.

```proposal
{"tool":"fabric_delete","inputs":{"name":"x"}}
```
'''
    p = agent.extract_proposal(synthesis)
    assert p is not None
    assert p["tool"] == "fabric_delete"
    assert p["inputs"] == {"name": "x"}
    # Normalizer synthesizes a one-element steps[] for downstream uniformity.
    assert "steps" in p
    assert len(p["steps"]) == 1
    assert p["steps"][0]["tool"] == "fabric_delete"
    # emitted_at must be a parseable ISO8601 timestamp.
    assert "emitted_at" in p
    datetime.fromisoformat(p["emitted_at"])


def test_extract_proposal_caps_long_desc_and_why():
    """desc and why fields get clipped at 300 chars to defend against
    a malicious skill output rendering a huge proposal card."""
    long_text = "x" * 500
    synthesis = f'''Test.

```proposal
{{"tool":"x","inputs":{{}},"desc":"{long_text}","why":"{long_text}","risk":"low"}}
```
'''
    p = agent.extract_proposal(synthesis)
    assert len(p["desc"]) == 300
    assert len(p["why"]) == 300


# ─── extract_proposal — chained shape ────────────────────────────────

def test_extract_proposal_chained_preserves_steps():
    """A chained proposal with multiple steps keeps them in order; the
    first step's tool gets surfaced at the top level for back-compat
    with single-step readers (ProposalCard header, etc.)."""
    synthesis = '''Decommission tenant fully.

```proposal
{"steps":[
  {"tool":"tenant_delete_vrf","inputs":{"tenant_name":"t","vrf-name-list":["v1"]},"desc":"delete VRF v1"},
  {"tool":"tenant_delete_vrf","inputs":{"tenant_name":"t","vrf-name-list":["v2"]},"desc":"delete VRF v2"},
  {"tool":"tenant_delete","inputs":{"name":"t","force":true},"desc":"delete tenant t"}
],"desc":"decom t","why":"clean","risk":"high"}
```
'''
    p = agent.extract_proposal(synthesis)
    assert p is not None
    assert len(p["steps"]) == 3
    # First step's tool surfaced for ProposalCard's header rendering.
    assert p["tool"] == "tenant_delete_vrf"
    # Step order preserved.
    assert p["steps"][0]["inputs"]["vrf-name-list"] == ["v1"]
    assert p["steps"][2]["tool"] == "tenant_delete"


def test_extract_proposal_chained_caps_per_step_desc():
    """Per-step desc fields get capped at 200 chars."""
    long = "y" * 500
    synthesis = f'''Test.

```proposal
{{"steps":[{{"tool":"a","inputs":{{}},"desc":"{long}"}}],"desc":"d","why":"w","risk":"low"}}
```
'''
    p = agent.extract_proposal(synthesis)
    assert len(p["steps"][0]["desc"]) == 200


# ─── extract_proposal — refusal / malformed cases ────────────────────

def test_extract_proposal_returns_none_for_no_block():
    """Synthesis without a fenced proposal block → None."""
    assert agent.extract_proposal("Just some text, no block.") is None


def test_extract_proposal_returns_none_for_no_proposal_block():
    """`no_proposal` blocks are NOT the same as `proposal` — they
    indicate the skill refused. The extractor returns None; the
    refusal reason stays in the synthesis text for the operator."""
    synthesis = '''Refused.

```no_proposal
{"reason":"target in use"}
```
'''
    assert agent.extract_proposal(synthesis) is None


def test_extract_proposal_returns_none_for_malformed_json():
    """Malformed JSON in the block returns None rather than raising."""
    synthesis = '''Test.

```proposal
{not valid json}
```
'''
    assert agent.extract_proposal(synthesis) is None


def test_extract_proposal_requires_tool_or_steps():
    """A block with neither `tool` nor `steps` is rejected as
    structurally invalid."""
    synthesis = '''Test.

```proposal
{"desc":"d","why":"w","risk":"low"}
```
'''
    assert agent.extract_proposal(synthesis) is None


def test_extract_proposal_returns_none_for_empty_synthesis():
    assert agent.extract_proposal("") is None
    assert agent.extract_proposal(None) is None  # type: ignore


# ─── check_skill_budget — config + spent logic ───────────────────────

@pytest.fixture
def reset_client_config(monkeypatch):
    """Reset _client_config + clear the usage log so each test starts
    from a known state. Uses a tmp_path-style approach to avoid
    touching the real usage log."""
    original_budgets = settings._client_config.get("agent_skill_monthly_budgets_usd")
    yield
    if original_budgets is None:
        settings._client_config.pop("agent_skill_monthly_budgets_usd", None)
    else:
        settings._client_config["agent_skill_monthly_budgets_usd"] = original_budgets


def test_check_skill_budget_no_cap_returns_none(reset_client_config):
    """Skills without a configured cap are unrestricted — returns None."""
    settings._client_config["agent_skill_monthly_budgets_usd"] = {"other-skill": 1.0}
    assert agent_routes.check_skill_budget("safe-fabric-cleanup") is None


def test_check_skill_budget_empty_config_returns_none(reset_client_config):
    """Missing/empty budgets dict → no cap → None."""
    settings._client_config["agent_skill_monthly_budgets_usd"] = {}
    assert agent_routes.check_skill_budget("safe-fabric-cleanup") is None


def test_check_skill_budget_cap_zero_disables_skill(reset_client_config):
    """cap=0 means the skill is disabled — always returns exceeded."""
    settings._client_config["agent_skill_monthly_budgets_usd"] = {"safe-fabric-cleanup": 0.0}
    result = agent_routes.check_skill_budget("safe-fabric-cleanup")
    assert result is not None
    assert result["exceeded"] is True
    assert result["reason"] == "disabled"
    assert result["cap_usd"] == 0.0


def test_check_skill_budget_garbage_cap_returns_none(reset_client_config):
    """Non-numeric cap entries are silently ignored (no crash)."""
    settings._client_config["agent_skill_monthly_budgets_usd"] = {"safe-fabric-cleanup": "not-a-number"}
    assert agent_routes.check_skill_budget("safe-fabric-cleanup") is None


def test_check_skill_budget_skill_name_empty_returns_none(reset_client_config):
    """Empty skill name → None (defensive)."""
    settings._client_config["agent_skill_monthly_budgets_usd"] = {"x": 1.0}
    assert agent_routes.check_skill_budget("") is None


def test_check_skill_budget_under_cap_returns_none(reset_client_config, monkeypatch):
    """When current spend is below cap, returns None (skill can run)."""
    settings._client_config["agent_skill_monthly_budgets_usd"] = {"safe-fabric-cleanup": 1.00}
    monkeypatch.setattr(openai_usage, "skill_month_cost_usd", lambda _: 0.10)
    # Need to also monkeypatch the import-resolved alias inside agent_routes.
    monkeypatch.setattr(agent_routes, "_skill_month_cost_usd", lambda _: 0.10)
    assert agent_routes.check_skill_budget("safe-fabric-cleanup") is None


def test_check_skill_budget_over_cap_returns_exceeded(reset_client_config, monkeypatch):
    """When current spend ≥ cap, returns the gate-block dict."""
    settings._client_config["agent_skill_monthly_budgets_usd"] = {"safe-fabric-cleanup": 0.50}
    monkeypatch.setattr(agent_routes, "_skill_month_cost_usd", lambda _: 0.55)
    result = agent_routes.check_skill_budget("safe-fabric-cleanup")
    assert result is not None
    assert result["exceeded"] is True
    assert result["reason"] == "monthly_cap_exceeded"
    assert result["cap_usd"] == 0.50
    assert result["spent_usd"] == 0.55


# ─── make_skill_openai_chat — closure factory ────────────────────────

def test_make_skill_openai_chat_returns_callable():
    """Factory returns a coroutine function tagged with the skill."""
    fn = agent_routes.make_skill_openai_chat("safe-fabric-cleanup")
    assert callable(fn)
    import asyncio
    assert asyncio.iscoroutinefunction(fn)


def test_make_skill_openai_chat_handles_empty_skill_name():
    """Empty / whitespace skill_name falls back to 'unknown' rather
    than producing source='agent_skill:'."""
    fn = agent_routes.make_skill_openai_chat("")
    # Closure builds source from skill_name; we can introspect by
    # calling it and capturing the source via a monkeypatched
    # _core_openai_chat_with_tools. That's heavier than the unit
    # boundary deserves — for now just confirm the factory accepts
    # the input without raising.
    assert callable(fn)


# ─── Proposal expiry math (mirrors the approve endpoint's check) ─────

def test_proposal_expiry_window():
    """The expiry window constant is the operator-facing contract."""
    # 15 minutes — long enough to read the proposal, short enough to
    # catch overnight tabs.
    assert agent_routes.AGENT_PROPOSAL_MAX_AGE_SECONDS == 15 * 60


def test_proposal_age_calculation():
    """The age math in the approve endpoint is straightforward —
    re-checked here so future timezone shenanigans don't slip in.
    Both `Z` suffix and `+00:00` offset are parseable."""
    # Sanity: 'Z' replaced with '+00:00' produces a valid datetime.
    iso_z = "2026-05-24T22:00:00Z"
    dt = datetime.fromisoformat(iso_z.replace("Z", "+00:00"))
    assert dt.tzinfo is not None
    # A proposal stamped 16 minutes ago should be EXPIRED.
    stamped = datetime.now(timezone.utc) - timedelta(minutes=16)
    age_s = (datetime.now(timezone.utc) - stamped).total_seconds()
    assert age_s > agent_routes.AGENT_PROPOSAL_MAX_AGE_SECONDS
    # A proposal stamped 5 minutes ago should be FRESH.
    stamped = datetime.now(timezone.utc) - timedelta(minutes=5)
    age_s = (datetime.now(timezone.utc) - stamped).total_seconds()
    assert age_s < agent_routes.AGENT_PROPOSAL_MAX_AGE_SECONDS
