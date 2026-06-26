# Unit tests for agent/filters.py — tool-result preprocessing pipeline.
#
# Covers the three preprocessors that run on every tool response BEFORE
# the model sees it:
#   - _filter_resolved_alarms     — strip resolved/cleared alarm samples
#   - _normalize_bgp_summary      — rewrite misleading config-source flags
#   - _firmware_storage_pp        — inject hard pass/fail/advisory verdict
# Plus the message-shape detector (_is_resolved_alarm_message) and the
# age classifier (_classify_group_age) those preprocessors compose with.
#
# Run via:
#     cd backend && .venv/bin/python -m pytest tests/test_filters.py -v
#
# No service required.

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from agent.filters import (
    _is_resolved_alarm_message,
    _classify_group_age,
    _sample_is_resolved,
    _compute_verdict_from_groups,
    _filter_resolved_alarms,
    _normalize_bgp_summary,
    _firmware_storage_pp,
    _alarm_filter_pp,
    _bgp_normalizer_pp,
    _ToolResultPreprocessor,
    _TOOL_RESULT_PREPROCESSORS,
)


# ─── _is_resolved_alarm_message ──────────────────────────────────────

def test_resolved_msg_past_tense_verbs():
    """Past-tense resolution verbs should match."""
    assert _is_resolved_alarm_message("Contact has been regained")
    assert _is_resolved_alarm_message("BGP recovered after 30s")
    assert _is_resolved_alarm_message("Service was restored")
    assert _is_resolved_alarm_message("Connection re-established")


def test_resolved_msg_safe_state_phrases():
    """'is at safe …', 'within normal range' etc. → resolved."""
    assert _is_resolved_alarm_message("Storage is at a safe utilization level")
    assert _is_resolved_alarm_message("CPU within normal range")
    assert _is_resolved_alarm_message("Memory operating normally")


def test_resolved_msg_negations():
    """'No longer down', 'no issues found' → resolved."""
    assert _is_resolved_alarm_message("Device is no longer unreachable")
    assert _is_resolved_alarm_message("No issues detected on switch")


def test_resolved_msg_admin_deletes():
    """Fabric deletion events are NOT current alarms."""
    assert _is_resolved_alarm_message("Fabric DC has been deleted")
    assert _is_resolved_alarm_message("VRF deleted successfully")


def test_resolved_msg_active_alarms_dont_match():
    """Genuine active-alarm wording must NOT match the resolved patterns."""
    assert not _is_resolved_alarm_message("BGP neighbor down")
    assert not _is_resolved_alarm_message("CPU usage 95%")
    assert not _is_resolved_alarm_message("Authentication failed")


def test_resolved_msg_non_strings():
    """Non-string input returns False (safe)."""
    assert not _is_resolved_alarm_message(None)
    assert not _is_resolved_alarm_message(42)
    assert not _is_resolved_alarm_message({})


# ─── _classify_group_age ─────────────────────────────────────────────

def _iso(now_offset_h: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=now_offset_h)).isoformat()


def test_age_fresh_when_recent_sample_exists():
    group = {"samples": [{"timestamp": _iso(-1)}, {"timestamp": _iso(-72)}]}
    assert _classify_group_age(group, fresh_threshold_hours=24) == "fresh"


def test_age_stale_when_all_old():
    group = {"samples": [{"timestamp": _iso(-25)}, {"timestamp": _iso(-72)}]}
    assert _classify_group_age(group, fresh_threshold_hours=24) == "stale"


def test_age_unknown_when_no_parseable_timestamps():
    group = {"samples": [{"message": "no timestamp"}, {"timestamp": "garbage"}]}
    assert _classify_group_age(group) == "unknown"


def test_age_unknown_when_no_samples():
    assert _classify_group_age({"samples": []}) == "unknown"
    assert _classify_group_age({}) == "unknown"
    assert _classify_group_age("not a dict") == "unknown"


# ─── _sample_is_resolved ─────────────────────────────────────────────

def test_sample_resolved_by_message_pattern():
    sample = {"message": "Service restored"}
    assert _sample_is_resolved(sample)


def test_sample_resolved_by_structural_flag():
    """`cleared: true` or `state: cleared` → resolved regardless of message."""
    assert _sample_is_resolved({"is_cleared": True, "message": "anything"})
    assert _sample_is_resolved({"cleared": True})
    assert _sample_is_resolved({"state": "resolved"})
    assert _sample_is_resolved({"state": "CLOSED"})


def test_sample_active_not_resolved():
    assert not _sample_is_resolved({"message": "Connection lost", "state": "active"})


# ─── _compute_verdict_from_groups ────────────────────────────────────

def test_verdict_no_groups_is_healthy():
    k, phrase = _compute_verdict_from_groups([])
    assert k == "healthy"


def test_verdict_minor_only_is_advisory():
    groups = [{"severity": "minor"}, {"severity": "warning"}]
    k, _ = _compute_verdict_from_groups(groups)
    assert k == "operationally_healthy_advisory"


def test_verdict_major_is_degraded():
    groups = [{"severity": "minor"}, {"severity": "major"}]
    k, _ = _compute_verdict_from_groups(groups)
    assert k == "degraded"


def test_verdict_critical_wins():
    groups = [{"severity": "warning"}, {"severity": "critical"}]
    k, _ = _compute_verdict_from_groups(groups)
    assert k == "critical"


def test_verdict_unknown_severity_skipped():
    """Unknown severity strings are ignored (don't crash, don't inflate)."""
    groups = [{"severity": "unknown-thing"}, {"severity": "minor"}]
    k, _ = _compute_verdict_from_groups(groups)
    assert k == "operationally_healthy_advisory"


# ─── _filter_resolved_alarms ─────────────────────────────────────────

def test_alarm_filter_non_alarm_tool_pass_through():
    """Filter is a no-op for non-alarm tool names."""
    payload = {"top": [{"name": "x"}]}
    out, dropped = _filter_resolved_alarms("some_other_tool", payload)
    assert out is payload
    assert dropped == 0


def test_alarm_filter_drops_fully_resolved_group():
    """A group with ALL samples resolved is dropped entirely."""
    payload = {
        "payload": {
            "top": [
                {
                    "name": "ContactLost",
                    "severity": "minor",
                    "count": 2,
                    "samples": [
                        {"message": "Contact has been regained"},
                        {"message": "Service was restored"},
                    ],
                },
            ],
            "summary": {"returned_groups": 1, "active_after_filters": 2, "by_severity": {"minor": 2}},
        }
    }
    out, dropped = _filter_resolved_alarms("fault_get_active_alarms_top", payload)
    body = out["payload"]
    assert body["top"] == []
    assert dropped >= 1
    assert body["summary"]["returned_groups"] == 0
    assert body["summary"]["active_after_filters"] == 0


def test_alarm_filter_keeps_partial_group_with_active_samples():
    """A group with some resolved + some active keeps only the active ones."""
    payload = {
        "payload": {
            "top": [
                {
                    "name": "CertExpiring",
                    "severity": "warning",
                    "count": 3,
                    "samples": [
                        {"message": "Certificate renewed on device A"},
                        {"message": "Certificate expiring in 5 days", "timestamp": _iso(-1)},
                    ],
                },
            ],
            "summary": {"returned_groups": 1, "active_after_filters": 3, "by_severity": {"warning": 3}},
        }
    }
    out, dropped = _filter_resolved_alarms("fault_get_active_alarms_top", payload)
    body = out["payload"]
    assert len(body["top"]) == 1
    surviving_samples = body["top"][0]["samples"]
    assert len(surviving_samples) == 1
    assert "expiring" in surviving_samples[0]["message"]
    assert dropped == 1
    # Recomputed verdict + freshness should now be present
    summ = body["summary"]
    assert "_agent_verdict" in summ
    assert "_agent_check_verdict_alarm_health" in summ


def test_alarm_filter_freshness_classification_all_stale():
    """When all surviving samples are old → freshness=all_stale."""
    old_ts = _iso(-48)
    payload = {
        "payload": {
            "top": [
                {
                    "name": "Crit",
                    "severity": "critical",
                    "count": 2,
                    "samples": [{"message": "BGP down", "timestamp": old_ts}],
                },
            ],
            "summary": {"by_severity": {"critical": 1}, "active_after_filters": 1, "returned_groups": 1},
        }
    }
    out, _ = _filter_resolved_alarms("fault_get_active_alarms_top", payload)
    summ = out["payload"]["summary"]
    assert summ["_agent_alarms_freshness"] == "all_stale"
    # all_stale + critical → ADVISORY (pre-existing, not operation-induced)
    assert summ["_agent_check_verdict_alarm_health"] == "ADVISORY"


def test_alarm_filter_freshness_any_fresh_critical_is_fail():
    """When at least one fresh critical alarm survives → check verdict FAIL."""
    payload = {
        "payload": {
            "top": [
                {
                    "name": "Crit",
                    "severity": "critical",
                    "count": 1,
                    "samples": [{"message": "BGP down", "timestamp": _iso(-1)}],
                },
            ],
            "summary": {"by_severity": {"critical": 1}, "active_after_filters": 1, "returned_groups": 1},
        }
    }
    out, _ = _filter_resolved_alarms("fault_get_active_alarms_top", payload)
    summ = out["payload"]["summary"]
    assert summ["_agent_alarms_freshness"] == "any_fresh"
    assert summ["_agent_check_verdict_alarm_health"] == "FAIL"


def test_alarm_filter_no_alarms_is_pass():
    """Empty alarm payload → check verdict PASS."""
    payload = {
        "payload": {
            "top": [],
            "summary": {"by_severity": {}, "active_after_filters": 0, "returned_groups": 0},
        }
    }
    out, _ = _filter_resolved_alarms("fault_get_active_alarms_top", payload)
    summ = out["payload"]["summary"]
    # No surviving groups → freshness 'no_alarms', verdict PASS
    assert summ["_agent_alarms_freshness"] == "no_alarms"
    assert summ["_agent_check_verdict_alarm_health"] == "PASS"


# ─── _normalize_bgp_summary ──────────────────────────────────────────

def test_bgp_normalizer_non_bgp_tool_no_op():
    payload = {"summary": {"total_established": 0, "total_neighbors": 5, "all_healthy": False}}
    out, note = _normalize_bgp_summary("some_other_tool", payload)
    assert out is payload
    assert note is None


def test_bgp_normalizer_rewrites_misleading_running_config_summary():
    """The fix the model needs: 'total_established: 0' from running-config
    is misleading; rewrite based on switches_ok / total_switches."""
    payload = {
        "payload": {
            "switches": [{"source": "running-config", "ip": "1.1.1.1"}],
            "summary": {
                "total_established": 0,
                "total_neighbors": 10,
                "all_healthy": False,
                "switches_ok": 3,
                "total_switches": 3,
            },
        }
    }
    out, note = _normalize_bgp_summary("restconf_get_bgp_summary", payload)
    assert note is not None
    summ = out["payload"]["summary"]
    # The misleading field is gone
    assert "total_established" not in summ
    # all_healthy now reflects reachability (3 of 3 ok)
    assert summ["all_healthy"] is True
    assert "_agent_translation_note" in summ


def test_bgp_normalizer_skips_when_not_misleading():
    """If the data isn't the misleading config-source pattern, leave alone."""
    payload = {
        "payload": {
            "switches": [{"source": "operational", "ip": "1.1.1.1"}],
            "summary": {"total_established": 5, "total_neighbors": 5, "all_healthy": True},
        }
    }
    out, note = _normalize_bgp_summary("restconf_get_bgp_summary", payload)
    assert note is None
    assert out is payload


# ─── _firmware_storage_pp ────────────────────────────────────────────

def test_storage_pp_non_storage_tool_no_op():
    payload = {"devices": []}
    out, ev = _firmware_storage_pp("some_other_tool", payload)
    assert out is payload
    assert ev is None


def test_storage_pp_all_sufficient_is_pass():
    payload = {
        "payload": {
            "devices": [
                {"ip": "1.1.1.1", "sufficient": True, "free_mb": 5000, "required_mb": 1000},
                {"ip": "1.1.1.2", "sufficient": True, "free_mb": 6000, "required_mb": 1000},
            ]
        }
    }
    out, ev = _firmware_storage_pp("firmware_check_storage", payload)
    body = out["payload"]
    assert body["_agent_storage_verdict"] == "pass"
    assert ev is not None
    assert "PASS" in ev["text"]


def test_storage_pp_any_insufficient_is_fail():
    payload = {
        "payload": {
            "devices": [
                {"ip": "1.1.1.1", "sufficient": True, "free_mb": 5000, "required_mb": 1000},
                {"ip": "1.1.1.2", "sufficient": False, "free_mb": 500, "required_mb": 1000},
            ]
        }
    }
    out, _ = _firmware_storage_pp("firmware_check_storage", payload)
    assert out["payload"]["_agent_storage_verdict"] == "fail"


def test_storage_pp_all_errors_is_skip():
    payload = {
        "payload": {
            "devices": [
                {"ip": "1.1.1.1", "error": "ssh auth failed"},
                {"ip": "1.1.1.2", "error": "timeout"},
            ]
        }
    }
    out, _ = _firmware_storage_pp("firmware_check_storage", payload)
    assert out["payload"]["_agent_storage_verdict"] == "skip"


def test_storage_pp_no_devices_is_skip():
    payload = {"payload": {"devices": []}}
    out, _ = _firmware_storage_pp("firmware_check_storage", payload)
    assert out["payload"]["_agent_storage_verdict"] == "skip"


# ─── Preprocessor registry — wiring ──────────────────────────────────

def test_registry_has_three_preprocessors():
    """The registry should hold the three preprocessors we wired."""
    assert len(_TOOL_RESULT_PREPROCESSORS) == 3
    kinds = {p.kind for p in _TOOL_RESULT_PREPROCESSORS}
    assert kinds == {"filtered", "normalized", "storage_verdict"}


def test_registry_applies_to_targets_alarm():
    """The alarm preprocessor predicate fires on the four alarm tool names."""
    alarm_pp = next(p for p in _TOOL_RESULT_PREPROCESSORS if p.kind == "filtered")
    assert alarm_pp.applies_to("fault_get_active_alarms_top")
    assert alarm_pp.applies_to("faultmanager_get_alarm_summary")
    assert not alarm_pp.applies_to("inventory_get_switches")


def test_registry_applies_to_targets_bgp():
    bgp_pp = next(p for p in _TOOL_RESULT_PREPROCESSORS if p.kind == "normalized")
    assert bgp_pp.applies_to("restconf_get_bgp_summary")
    assert not bgp_pp.applies_to("restconf_get_interface_detail")


def test_registry_applies_to_targets_storage():
    sto_pp = next(p for p in _TOOL_RESULT_PREPROCESSORS if p.kind == "storage_verdict")
    assert sto_pp.applies_to("firmware_check_storage")
    assert not sto_pp.applies_to("firmware_check_software")
