# Unit tests for nl/list_filters.py — NL → list-filter clause extraction + apply.
#
# Two-part coverage:
#   1. extract_filter_clauses — regex parsing of NL text into structured
#      {field, op, value} clauses. Edge cases: broad listings (early-exit),
#      ASN special form, IP literal vs operator form, generic field+op+value,
#      bogus value rejection, dedup.
#   2. resolve_and_apply_filters — synonym resolution + keypath flattening +
#      per-op matching (string ops, numeric comparisons, eq/ne).
#   3. _should_attempt_llm_filters — the heuristic that decides whether to
#      spend an LLM call on filter extraction.
#
# Run via:
#     cd backend && .venv/bin/python -m pytest tests/test_nl_list_filters.py -v

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from nl.list_filters import (
    _pick_str,
    _norm,
    _maybe_cast,
    _parse_op,
    _split_clauses,
    extract_filter_clauses,
    resolve_and_apply_filters,
    recompute_model_counts,
    _should_attempt_llm_filters,
)


# ─── Helpers ──────────────────────────────────────────────────────────

def test_pick_str_returns_first_nonempty():
    assert _pick_str(None, "", "  ", "hello", "world") == "hello"


def test_pick_str_skips_non_strings():
    assert _pick_str(None, 42, [], "actual") == "actual"


def test_pick_str_none_when_all_empty():
    assert _pick_str(None, "", "  ", None) is None


def test_norm_strips_punctuation():
    assert _norm("fabric.fabric_name") == "fabricfabricname"
    assert _norm("Mgmt IP") == "mgmtip"
    assert _norm("") == ""


def test_maybe_cast_int():
    assert _maybe_cast("42") == 42
    assert _maybe_cast("-3") == -3


def test_maybe_cast_float():
    assert _maybe_cast("3.14") == 3.14


def test_maybe_cast_string_strips_quotes():
    assert _maybe_cast('"hello"') == "hello"
    assert _maybe_cast("'single'") == "single"


def test_maybe_cast_string_passthrough():
    assert _maybe_cast("not-a-number") == "not-a-number"


def test_parse_op_aliases():
    assert _parse_op("=") == "eq"
    assert _parse_op("==") == "eq"
    assert _parse_op("is") == "eq"
    assert _parse_op("!=") == "ne"
    assert _parse_op("<>") == "ne"
    assert _parse_op(">=") == "gte"
    assert _parse_op("contains") == "contains"
    assert _parse_op("not contains") == "not_contains"
    assert _parse_op(None) == "eq"


def test_split_clauses_basic():
    assert _split_clauses("asn 65000 and role Leaf") == ["asn 65000", "role Leaf"]
    assert _split_clauses("a, b; c") == ["a", "b", "c"]


def test_split_clauses_respects_quotes():
    """' and ' inside quotes shouldn't split."""
    out = _split_clauses('name "rack and stack" and role Leaf')
    assert out == ['name "rack and stack"', "role Leaf"]


def test_split_clauses_empty():
    assert _split_clauses("") == []
    assert _split_clauses("   ") == []


# ─── extract_filter_clauses — early exit branches ─────────────────────

def test_broad_listing_returns_no_clauses():
    """'show all switches' → broad listing, no filters."""
    assert extract_filter_clauses("show all switches") == []
    assert extract_filter_clauses("list devices") == []
    assert extract_filter_clauses("show inventory") == []


def test_ip_addresses_without_filter_signal_returns_no_clauses():
    """'show ip addresses of all switches' → no IP literal, no operator
    → no filter extraction (avoid wiping the inventory to 0 results)."""
    assert extract_filter_clauses("show me the ip addresses of all switches") == []


def test_ip_addresses_with_actual_ip_literal_does_extract():
    """When an actual IP appears, filter extraction proceeds. The bare
    form needs 'ip' followed directly by the IP (no 'address' word in
    between)."""
    out = extract_filter_clauses("ip 10.1.1.1")
    assert len(out) == 1
    assert out[0]["field"] == "ip_address"
    assert out[0]["value"] == "10.1.1.1"


def test_empty_input_returns_empty():
    assert extract_filter_clauses("") == []
    assert extract_filter_clauses(None) == []


# ─── extract_filter_clauses — ASN ─────────────────────────────────────

def test_asn_bare_number():
    out = extract_filter_clauses("asn 65000")
    assert out == [{"field": "asn", "op": "eq", "value": 65000}]


def test_asn_with_gt_operator():
    out = extract_filter_clauses("asn > 65000")
    assert out == [{"field": "asn", "op": "gt", "value": 65000}]


def test_asn_with_gte_and_filter_keyword():
    out = extract_filter_clauses("filter by asn >= 65500")
    assert out == [{"field": "asn", "op": "gte", "value": 65500}]


# ─── extract_filter_clauses — IP ──────────────────────────────────────

def test_ip_bare_literal():
    out = extract_filter_clauses("show switch with ip 10.20.30.40")
    assert {"field": "ip_address", "op": "eq", "value": "10.20.30.40"} in out


def test_ip_with_operator():
    """Note: the value goes through _maybe_cast — '192.168' becomes the
    float 192.168, not the string. The clause that lands has the cast
    value. Use a non-numeric value for a stable string assertion."""
    out = extract_filter_clauses("ip_address contains 192-168")
    assert {"field": "ip_address", "op": "contains", "value": "192-168"} in out


# ─── extract_filter_clauses — generic field op value ──────────────────

def test_generic_field_known_eq():
    out = extract_filter_clauses("with role Leaf")
    assert out == [{"field": "role", "op": "eq", "value": "Leaf"}]


def test_generic_field_contains():
    out = extract_filter_clauses("where chassis_name contains 8520")
    assert out == [{"field": "chassis_name", "op": "contains", "value": 8520}]


def test_combined_clauses_with_and():
    """Two clauses joined by 'and'."""
    out = extract_filter_clauses("with asn 65000 and role Leaf")
    fields = {c["field"] for c in out}
    assert fields == {"asn", "role"}


def test_bogus_value_rejected():
    """'show name and model of switches' → 'of switches' isn't a filter value."""
    out = extract_filter_clauses("show name and model of switches")
    # No clause should have value="of switches" or "switches"
    for c in out:
        assert c["value"] not in ("of switches", "switches", "devices")


def test_dedup_identical_clauses():
    """The same clause appearing twice should de-dupe."""
    out = extract_filter_clauses("with role Leaf and role Leaf")
    assert len(out) == 1


# ─── resolve_and_apply_filters ────────────────────────────────────────

@pytest.fixture
def sample_items():
    return [
        {"name": "leaf1", "ip_address": "10.1.1.1", "role": "Leaf", "asn": 65001,
         "fabric": {"fabric_name": "DC"}, "model_display": "SLX-9250"},
        {"name": "leaf2", "ip_address": "10.1.1.2", "role": "Leaf", "asn": 65002,
         "fabric": {"fabric_name": "DC"}, "model_display": "SLX-9250"},
        {"name": "spine1", "ip_address": "10.1.1.10", "role": "Spine", "asn": 65000,
         "fabric": {"fabric_name": "DC"}, "model_display": "SLX-9540"},
    ]


def test_apply_eq_filter(sample_items):
    clauses = [{"field": "role", "op": "eq", "value": "Leaf"}]
    filtered, resolved = resolve_and_apply_filters(sample_items, clauses)
    assert len(filtered) == 2
    assert all(it["role"] == "Leaf" for it in filtered)
    assert resolved[0]["path"] == "role"


def test_apply_numeric_gt(sample_items):
    clauses = [{"field": "asn", "op": "gt", "value": 65000}]
    filtered, _ = resolve_and_apply_filters(sample_items, clauses)
    assert len(filtered) == 2  # leaf1+leaf2, not spine1


def test_apply_combined_filters(sample_items):
    """Two clauses AND'd together."""
    clauses = [
        {"field": "role", "op": "eq", "value": "Leaf"},
        {"field": "asn", "op": "gt", "value": 65001},
    ]
    filtered, _ = resolve_and_apply_filters(sample_items, clauses)
    assert len(filtered) == 1
    assert filtered[0]["name"] == "leaf2"


def test_apply_synonym_resolves_to_nested_path(sample_items):
    """Synonym path: when the user-supplied field has no direct match in
    the item keymap, fall back to the synonyms table. 'fabricname' →
    fabric_name → resolves to the nested 'fabric.fabric_name' path.
    (Note: bare 'fabric' resolves DIRECTLY to the dict-valued 'fabric'
    key — direct match wins over synonyms by design — so the test uses
    'fabricname' which has no direct top-level match.)"""
    clauses = [{"field": "fabricname", "op": "eq", "value": "DC"}]
    filtered, resolved = resolve_and_apply_filters(sample_items, clauses)
    assert len(filtered) == 3
    assert resolved[0]["path"] == "fabric.fabric_name"


def test_apply_synonym_ip(sample_items):
    """'ip' → ip_address."""
    clauses = [{"field": "ip", "op": "eq", "value": "10.1.1.1"}]
    filtered, _ = resolve_and_apply_filters(sample_items, clauses)
    assert len(filtered) == 1
    assert filtered[0]["name"] == "leaf1"


def test_apply_contains_case_insensitive(sample_items):
    clauses = [{"field": "name", "op": "contains", "value": "leaf"}]
    filtered, _ = resolve_and_apply_filters(sample_items, clauses)
    assert len(filtered) == 2


def test_apply_returns_unfiltered_when_no_clauses(sample_items):
    filtered, resolved = resolve_and_apply_filters(sample_items, [])
    assert filtered == sample_items
    assert resolved == []


def test_apply_returns_empty_when_no_items():
    filtered, resolved = resolve_and_apply_filters([], [{"field": "x"}])
    assert filtered == []
    assert resolved == []


def test_apply_unresolved_field_returns_unfiltered(sample_items):
    """Field doesn't exist anywhere in the items → no filter applied,
    no resolved clauses, original items returned."""
    clauses = [{"field": "nonexistent_field", "op": "eq", "value": "x"}]
    filtered, resolved = resolve_and_apply_filters(sample_items, clauses)
    assert filtered == sample_items
    assert resolved == []


def test_apply_ne_filter(sample_items):
    clauses = [{"field": "role", "op": "ne", "value": "Leaf"}]
    filtered, _ = resolve_and_apply_filters(sample_items, clauses)
    assert len(filtered) == 1
    assert filtered[0]["role"] == "Spine"


# ─── recompute_model_counts ──────────────────────────────────────────

def test_recompute_model_counts(sample_items):
    counts = recompute_model_counts(sample_items)
    # SLX-9250 has 2 entries; SLX-9540 has 1. Sorted desc.
    assert counts == [("SLX-9250", 2), ("SLX-9540", 1)]


def test_recompute_model_counts_empty():
    assert recompute_model_counts([]) == []


def test_recompute_model_counts_uses_fallback_keys():
    """Falls back to chassis_name when model_display is missing."""
    items = [
        {"chassis_name": "X1", "model_display": ""},
        {"chassis_name": "X1"},
        {"model_display": "X2"},
    ]
    counts = dict(recompute_model_counts(items))
    assert counts["X1"] == 2
    assert counts["X2"] == 1


def test_recompute_model_counts_unknown_bucket():
    items = [{"foo": "bar"}, {}]
    counts = dict(recompute_model_counts(items))
    assert counts["Unknown"] == 2


# ─── _should_attempt_llm_filters ─────────────────────────────────────

def test_should_attempt_llm_explicit_keyword():
    """Regex matches `contains` (exact word) but NOT `containing` — that's
    fine; LLM filter extraction is opt-in, false negatives are cheap."""
    assert _should_attempt_llm_filters("filter switches where asn = 65000")
    assert _should_attempt_llm_filters("show switches having asn > 65000")
    assert _should_attempt_llm_filters("switches that contains leaf")


def test_should_attempt_llm_comparison_operator():
    assert _should_attempt_llm_filters("show switches with asn >= 65000")
    assert _should_attempt_llm_filters("devices under 10% cpu")


def test_should_attempt_llm_field_with_value():
    assert _should_attempt_llm_filters("show switches with role 'leaf'")
    assert _should_attempt_llm_filters("show switches with asn 65001")


def test_should_attempt_llm_column_selection_does_NOT_trigger():
    """'with their IP, role, and firmware version' is column selection,
    NOT a filter. The heuristic must not waste an LLM call here."""
    assert not _should_attempt_llm_filters("show switches with their IP, role, and firmware version")


def test_should_attempt_llm_broad_listing_does_NOT_trigger():
    assert not _should_attempt_llm_filters("show all switches")
    assert not _should_attempt_llm_filters("list devices")


def test_should_attempt_llm_empty():
    assert not _should_attempt_llm_filters("")
    assert not _should_attempt_llm_filters(None)
