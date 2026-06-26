# Unit tests for nl/summary.py — Console summary builder.
#
# Single function under test: build_console_summary(tool, payload).
# Reshapes raw tool payloads into the stable {summary, warnings,
# recommendations, next_actions} shape the Console UI expects.
#
# Three composition paths to cover:
#   1. Explicit Tier-2 payload (preferred): summary block + signals.warnings +
#      recommendations + next_actions (dicts → friendly strings).
#   2. Heuristic offender extraction: groups[].drivers[] OR
#      offenders/unhealthy_devices/devices/drivers lists.
#   3. Per-tool fabric-health enrichment: KPI + synthesized next_actions
#      with the fabric name plugged in.
#
# Run via:
#     cd backend && .venv/bin/python -m pytest tests/test_nl_summary.py -v

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from nl.summary import build_console_summary


# ─── Output shape ────────────────────────────────────────────────────

def test_returns_stable_keys_for_any_input():
    out = build_console_summary("any_tool", None)
    assert set(out.keys()) == {"tool", "summary", "warnings", "recommendations", "next_actions"}
    assert out["tool"] == "any_tool"
    assert isinstance(out["summary"], dict)
    assert isinstance(out["warnings"], list)
    assert isinstance(out["recommendations"], list)
    assert isinstance(out["next_actions"], list)


def test_empty_payload_returns_skeleton():
    out = build_console_summary("x", None)
    assert out["summary"] == {}
    assert out["warnings"] == []
    assert out["recommendations"] == []
    assert out["next_actions"] == []


def test_non_dict_payload_returns_skeleton():
    out = build_console_summary("x", [1, 2, 3])
    assert out["summary"] == {}
    assert out["warnings"] == []


# ─── Tier-2 explicit summary block ───────────────────────────────────

def test_explicit_summary_block_passes_through():
    payload = {"summary": {"headline": "All systems normal", "kpis": {"unhealthy": 0}}}
    out = build_console_summary("monitor_get_health", payload)
    assert out["summary"]["headline"] == "All systems normal"
    assert out["summary"]["kpis"]["unhealthy"] == 0


def test_headline_fallback_from_message_or_status():
    """When there's no summary block, pull a headline from message/status."""
    out = build_console_summary("x", {"message": "fabric down"})
    assert out["summary"]["headline"] == "fabric down"

    out2 = build_console_summary("x", {"status": "degraded"})
    assert out2["summary"]["headline"] == "degraded"


def test_signals_warnings_appended():
    payload = {"signals": {"warnings": ["BGP flap", "CPU 95%"]}}
    out = build_console_summary("x", payload)
    assert "BGP flap" in out["warnings"]
    assert "CPU 95%" in out["warnings"]


def test_recommendations_pulled_from_payload():
    payload = {"recommendations": ["Check BGP", "Restart pod"]}
    out = build_console_summary("x", payload)
    assert out["recommendations"] == ["Check BGP", "Restart pod"]


def test_next_actions_strings_passthrough():
    payload = {"next_actions": ["Run X", "Run Y"]}
    out = build_console_summary("x", payload)
    assert out["next_actions"] == ["Run X", "Run Y"]


def test_next_actions_dicts_converted_to_friendly_strings():
    """Dict-shaped next_actions get reformatted as
    'reason  (Run `tool` with {...})' so the UI doesn't show raw JSON."""
    payload = {"next_actions": [
        {"reason": "Check BGP neighbors", "tool": "restconf_get_bgp_summary", "inputs": {"switch_ip": "10.1.1.1"}},
    ]}
    out = build_console_summary("x", payload)
    assert len(out["next_actions"]) == 1
    text = out["next_actions"][0]
    assert "Check BGP neighbors" in text
    assert "restconf_get_bgp_summary" in text
    assert "10.1.1.1" in text


def test_next_actions_dict_without_reason_still_renders():
    """Dict without reason falls back to 'Run `tool` with {...}'."""
    payload = {"next_actions": [{"tool": "x", "inputs": {"a": 1}}]}
    out = build_console_summary("foo", payload)
    text = out["next_actions"][0]
    assert text.startswith("Run `x`")
    assert '"a":1' in text  # compact JSON


def test_next_actions_dict_uses_action_or_name_as_fallback():
    """Tool name can come from 'tool', 'name', or 'action' field."""
    out = build_console_summary("foo", {"next_actions": [{"name": "do_thing"}]})
    assert "do_thing" in out["next_actions"][0]

    out2 = build_console_summary("foo", {"next_actions": [{"action": "do_other"}]})
    assert "do_other" in out2["next_actions"][0]


# ─── Offender extraction ────────────────────────────────────────────

def test_extracts_offenders_from_groups_drivers():
    """Pattern A: device health rollup → groups[].drivers[]."""
    payload = {
        "groups": [
            {
                "drivers": [
                    {"hostname": "leaf1", "ip": "10.1.1.1", "severity": "critical", "reason": "down"},
                    {"hostname": "leaf2", "ip": "10.1.1.2", "severity": "major", "reason": "flapping"},
                ],
            },
        ],
    }
    out = build_console_summary("inventory_get_device_health_rollup", payload)
    top = next(w for w in out["warnings"] if w.startswith("Top offenders:"))
    assert "leaf1" in top
    assert "10.1.1.1" in top
    assert "critical" in top


def test_extracts_offenders_from_top_level_offenders_list():
    """Pattern B: top-level 'offenders' / 'unhealthy_devices' / 'devices' list."""
    payload = {"offenders": [
        {"hostname": "spine1", "severity": "warning", "reason": "high temp"},
    ]}
    out = build_console_summary("x", payload)
    top = next(w for w in out["warnings"] if w.startswith("Top offenders:"))
    assert "spine1" in top
    assert "high temp" in top


def test_offender_extraction_limit():
    """Caps at 3 offenders to avoid flooding the UI."""
    payload = {"offenders": [
        {"hostname": f"h{i}", "severity": "critical"} for i in range(10)
    ]}
    out = build_console_summary("x", payload)
    top = next(w for w in out["warnings"] if w.startswith("Top offenders:"))
    # Splits on ", " — should yield ≤ 3 entries
    after_colon = top.split("Top offenders:", 1)[1]
    entries = [e.strip() for e in after_colon.split(",") if e.strip()]
    assert len(entries) <= 3


def test_no_offenders_no_warning_appended():
    """Empty offenders list shouldn't add a 'Top offenders:' warning."""
    out = build_console_summary("x", {"offenders": []})
    assert not any(w.startswith("Top offenders:") for w in out["warnings"])


# ─── Fabric-health enrichment ───────────────────────────────────────

def test_fabric_health_surfaces_unhealthy_count_as_kpi():
    payload = {"unhealthy_count": 7}
    out = build_console_summary("fabric_get_fabric_health_summary", payload)
    assert out["summary"]["kpis"]["unhealthy_count"] == 7


def test_fabric_health_synthesizes_next_actions_when_tool_has_none():
    payload = {"fabric_name": "DC"}
    out = build_console_summary("fabric_get_fabric_health_summary", payload)
    assert len(out["next_actions"]) == 3
    assert any("fabric_get_fabric_health_summary" in a for a in out["next_actions"])
    assert any("fabric_get_execution_list" in a for a in out["next_actions"])
    assert any("fabric_get_event_history_list" in a for a in out["next_actions"])
    assert all("DC" in a for a in out["next_actions"])


def test_fabric_health_picks_filter_fabric_name():
    """Looks under 'filter.fabric_name' first, then 'fabric_name', then 'name'."""
    payload = {"filter": {"fabric_name": "MyFab"}}
    out = build_console_summary("fabric_get_fabric_health_summary", payload)
    assert all("MyFab" in a for a in out["next_actions"])


def test_fabric_health_falls_back_to_DC_when_no_name():
    payload = {}
    out = build_console_summary("fabric_get_fabric_health_summary", payload)
    # Default 'DC' is the fallback fabric name used in the action template
    assert all("DC" in a for a in out["next_actions"])


def test_fabric_health_does_not_override_existing_next_actions():
    """If the tool already provided next_actions, don't synthesize."""
    payload = {"fabric_name": "DC", "next_actions": ["custom action"]}
    out = build_console_summary("fabric_get_fabric_health_summary", payload)
    assert out["next_actions"] == ["custom action"]


def test_fabric_health_enrichment_only_for_listed_tools():
    """Other tools don't get the unhealthy_count KPI or synthesized actions."""
    payload = {"unhealthy_count": 5}
    out = build_console_summary("monitor_get_health", payload)
    assert "kpis" not in out["summary"]
    assert out["next_actions"] == []
