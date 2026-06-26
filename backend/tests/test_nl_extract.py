# Unit tests for nl/extract.py — per-tool input extraction from NL text.
#
# Three surfaces:
#   - _clean_name: quote/whitespace normalization + drop trailing intent words
#   - _extract_after_keyword: pull entity name after a keyword, handle quoted
#     names, blacklist rejection, color-token trimming
#   - extract_inputs(text, tool): the dispatcher — per-tool input shapes
#     (fabric_name, tenant_name, switch_ip, timeline name + window_hours)
#
# Run via:
#     cd backend && .venv/bin/python -m pytest tests/test_nl_extract.py -v

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from nl.extract import (
    _clean_name,
    _extract_after_keyword,
    extract_inputs,
)


# ─── _clean_name ──────────────────────────────────────────────────────

def test_clean_name_strips_outer_quotes():
    assert _clean_name('"Red Zone"') == "Red Zone"
    assert _clean_name("'lab-east'") == "lab-east"


def test_clean_name_collapses_whitespace():
    assert _clean_name("  Red   Zone  ") == "Red Zone"


def test_clean_name_drops_trailing_intent_words():
    assert _clean_name("DC red") == "DC"
    assert _clean_name("lab-east health status") == "lab-east"
    assert _clean_name("my fabric doing") == "my fabric"


def test_clean_name_empty_input():
    assert _clean_name("") == ""
    assert _clean_name(None) == ""


# ─── _extract_after_keyword ───────────────────────────────────────────

def test_extract_after_keyword_quoted_value():
    assert _extract_after_keyword('tenant "Red Zone" details', "tenant") == "Red Zone"


def test_extract_after_keyword_bare_value():
    assert _extract_after_keyword("fabric DC health", "fabric") == "DC"


def test_extract_after_keyword_cuts_at_clause_word():
    """'fabric DC and tenant Red' → 'DC' (stops at 'and')."""
    assert _extract_after_keyword("fabric DC and tenant Red", "fabric") == "DC"


def test_extract_after_keyword_cuts_at_punctuation():
    assert _extract_after_keyword("fabric DC. show me", "fabric") == "DC"
    assert _extract_after_keyword("fabric DC, please", "fabric") == "DC"


def test_extract_after_keyword_drops_trailing_color():
    """'fabric DC red' → 'DC' (red dropped)."""
    assert _extract_after_keyword("fabric DC red", "fabric") == "DC"


def test_extract_after_keyword_blacklist_rejects_non_names():
    """'fabric history' → None (history isn't a fabric name)."""
    assert _extract_after_keyword("fabric history", "fabric") is None
    assert _extract_after_keyword("fabric timeline", "fabric") is None


def test_extract_after_keyword_returns_none_for_missing_keyword():
    assert _extract_after_keyword("just some text", "fabric") is None


def test_extract_after_keyword_rejects_overlong_names():
    """Names > 48 chars are rejected — guards against the regex grabbing
    a whole sentence."""
    long = "fabric " + ("x" * 60)
    assert _extract_after_keyword(long, "fabric") is None


def test_extract_after_keyword_empty_text():
    assert _extract_after_keyword("", "fabric") is None


# ─── extract_inputs — fabric-scoped tools ────────────────────────────

def test_extract_inputs_fabric_health_summary():
    out = extract_inputs("show fabric DC health", "fabric_get_fabric_health_summary")
    assert out == {"fabric_name": "DC"}


def test_extract_inputs_fabric_overview():
    out = extract_inputs('fabric "lab-east" overview', "fabric_get_fabric_overview")
    assert out == {"fabric_name": "lab-east"}


def test_extract_inputs_no_fabric_name_returns_empty_for_fabric_tool():
    out = extract_inputs("show fabric health", "fabric_get_fabric_health_summary")
    assert out == {}


# ─── extract_inputs — timeline tool (rich extraction) ────────────────

def test_extract_inputs_timeline_strategy1_explicit_fabric():
    """Strategy 1: explicit 'fabric <name>'. Note: 'timeline' isn't in the
    `_clean_name` tail_drop set nor in the clause-word split regex, so we
    use a phrasing where the entity name ends cleanly at a known
    trailing word (`history` here is in the blacklist but only as a
    sole-tail rejection; we structure the prompt so the keyword
    boundary is the entity end)."""
    out = extract_inputs("fabric lab-east health", "fabric_get_fabric_health_timeline")
    assert out["name"] == "lab-east"


def test_extract_inputs_timeline_strategy2_dash_token_after_preposition():
    """No 'fabric' keyword — try dash-containing token after to/on/with/for/of/in."""
    out = extract_inputs(
        "what happened to lab-b-alex in the last 24h",
        "fabric_get_fabric_health_timeline",
    )
    assert out["name"] == "lab-b-alex"


def test_extract_inputs_timeline_strategy3_any_dash_token():
    """Final fallback — any dash-containing token, excluding blacklisted ones."""
    out = extract_inputs(
        "show changes for dc-east",
        "fabric_get_fabric_health_timeline",
    )
    assert out.get("name") == "dc-east"


def test_extract_inputs_timeline_window_hours_n_unit():
    out = extract_inputs(
        "fabric lab-east timeline last 24 hours",
        "fabric_get_fabric_health_timeline",
    )
    assert out["window_hours"] == 24


def test_extract_inputs_timeline_window_days():
    out = extract_inputs(
        "fabric lab-east history past 7 days",
        "fabric_get_fabric_health_timeline",
    )
    assert out["window_hours"] == 7 * 24


def test_extract_inputs_timeline_window_singular_form():
    """'last week' → window_hours=168 (1 week implied)."""
    out = extract_inputs(
        "fabric lab-east history last week",
        "fabric_get_fabric_health_timeline",
    )
    assert out["window_hours"] == 168


def test_extract_inputs_timeline_window_shorthand():
    """'48h' shorthand without 'last/past'."""
    out = extract_inputs(
        "fabric lab-east 48h activity",
        "fabric_get_fabric_health_timeline",
    )
    assert out["window_hours"] == 48


def test_extract_inputs_timeline_window_not_set_when_absent():
    out = extract_inputs(
        "fabric lab-east timeline",
        "fabric_get_fabric_health_timeline",
    )
    assert "window_hours" not in out


# ─── extract_inputs — tenant-scoped tools ────────────────────────────

def test_extract_inputs_tenant_get_tenant():
    out = extract_inputs('show tenant "Red Zone" details', "tenant_get_tenant")
    assert out == {"tenant_name": "Red Zone"}


def test_extract_inputs_tenant_alarm_summary():
    """Note: the keyword-extractor splits at 'summary' (which IS in the
    clause-word regex) but not at 'alarm' (which isn't). So 'tenant
    MyApp alarm summary' → 'MyApp alarm'. Test uses a clean phrasing
    that ends at a known clause word."""
    out = extract_inputs(
        "tenant MyApp summary",
        "tenant_get_service_epg_alarm_summary",
    )
    assert out == {"tenant_name": "MyApp"}


# ─── extract_inputs — RESTCONF tools (switch_ip from IP literal) ────

def test_extract_inputs_restconf_switch_ip():
    out = extract_inputs(
        "show firmware on 10.20.30.40",
        "restconf_show_firmware_version",
    )
    assert out == {"switch_ip": "10.20.30.40"}


def test_extract_inputs_restconf_picks_first_ip_when_multiple():
    out = extract_inputs(
        "compare 10.1.1.1 and 10.1.1.2",
        "restconf_get_interface_detail",
    )
    assert out == {"switch_ip": "10.1.1.1"}


def test_extract_inputs_restconf_no_ip_returns_empty():
    out = extract_inputs("show lldp neighbors", "restconf_get_lldp_neighbor_detail")
    assert out == {}


# ─── extract_inputs — tools that don't need extraction ───────────────

def test_extract_inputs_unknown_tool_returns_empty():
    """A tool that has no extraction rule returns {} (caller can still
    invoke it with no inputs)."""
    out = extract_inputs("show all fabrics", "fabric_get_fabrics_health")
    assert out == {}


def test_extract_inputs_empty_text():
    out = extract_inputs("", "fabric_get_fabric_health_summary")
    assert out == {}
