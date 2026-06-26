# Unit tests for agent/verdict.py — pure-function verdict-mismatch detection.
#
# Pairs with the agent's "post-synthesis validation" enforcement layer.
# The model has shown, repeatedly, that it inflates verdicts past the data
# (FAIL where the checklist says PASS, "critical state" where alarms are
# all stale, etc.). verdict.py catches these mismatches; this file proves
# the detector itself is honest.
#
# Run via:
#     cd backend && .venv/bin/python -m pytest tests/test_verdict.py -v
#
# No service required.

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from agent.verdict import (
    _extract_synthesis_check_verdicts,
    _compute_overall_verdict_from_checklist,
    _extract_summary_block,
    _check_summary_matches_overall,
    _check_skill1_summary_freshness,
    _detect_verdict_mismatches,
)


# ─── _extract_synthesis_check_verdicts ────────────────────────────────

def test_extract_check_verdicts_basic():
    """Parses a standard Markdown checklist row table."""
    synthesis = """## Checklist
| # | Check | Result | Detail |
|---|-------|--------|--------|
| 1 | Storage headroom | PASS | all switches have space |
| 2 | Alarm health     | ADVISORY | 3 stale critical alarms |
| 3 | BGP neighbors    | FAIL | 2 neighbors down |
"""
    rows = _extract_synthesis_check_verdicts(synthesis)
    assert rows == {1: "PASS", 2: "ADVISORY", 3: "FAIL"}


def test_extract_check_verdicts_case_insensitive():
    """Lowercase row results still get uppercased."""
    synthesis = "| 1 | x | pass | y |\n| 2 | x | Fail | y |\n"
    rows = _extract_synthesis_check_verdicts(synthesis)
    assert rows == {1: "PASS", 2: "FAIL"}


def test_extract_check_verdicts_skips_non_verdict_rows():
    """Header rows + bogus rows are skipped — only PASS/FAIL/ADVISORY/SKIP cells parse."""
    synthesis = """| # | Check | Result | Detail |
|---|-------|--------|--------|
| 1 | x | PASS | y |
| not-a-number | x | PASS | y |
| 2 | x | SOMETHING_ELSE | y |
| 3 | x | SKIP | y |
"""
    rows = _extract_synthesis_check_verdicts(synthesis)
    assert rows == {1: "PASS", 3: "SKIP"}


def test_extract_check_verdicts_empty_input():
    assert _extract_synthesis_check_verdicts("") == {}
    assert _extract_synthesis_check_verdicts(None) == {}  # type: ignore[arg-type]


# ─── _compute_overall_verdict_from_checklist ──────────────────────────

def test_overall_verdict_post_upgrade_all_pass():
    """post-upgrade: all PASS → 'verified'."""
    v = _compute_overall_verdict_from_checklist(
        {1: "PASS", 2: "PASS", 3: "PASS"}, "post-firmware-upgrade-verification"
    )
    assert v == "verified"


def test_overall_verdict_post_upgrade_advisory_wins_over_pass():
    """post-upgrade: any ADVISORY → 'verified_with_advisory' (no FAIL)."""
    v = _compute_overall_verdict_from_checklist(
        {1: "PASS", 2: "ADVISORY", 3: "PASS"}, "post-firmware-upgrade-verification"
    )
    assert v == "verified_with_advisory"


def test_overall_verdict_post_upgrade_fail_wins_over_all():
    """post-upgrade: any FAIL → 'verification_failed' regardless of others."""
    v = _compute_overall_verdict_from_checklist(
        {1: "PASS", 2: "ADVISORY", 3: "FAIL"}, "post-firmware-upgrade-verification"
    )
    assert v == "verification_failed"


def test_overall_verdict_pre_upgrade_ladder():
    """pre-upgrade has the symmetric ladder: not_ready / ready_with_caveats / ready_to_upgrade."""
    assert _compute_overall_verdict_from_checklist(
        {1: "PASS"}, "pre-firmware-upgrade-check"
    ) == "ready_to_upgrade"
    assert _compute_overall_verdict_from_checklist(
        {1: "PASS", 2: "ADVISORY"}, "pre-firmware-upgrade-check"
    ) == "ready_with_caveats"
    assert _compute_overall_verdict_from_checklist(
        {1: "FAIL"}, "pre-firmware-upgrade-check"
    ) == "not_ready"


def test_overall_verdict_unknown_skill_returns_none():
    """Skills without a registered ladder return None — caller must handle."""
    v = _compute_overall_verdict_from_checklist(
        {1: "PASS"}, "some-unknown-skill"
    )
    assert v is None


def test_overall_verdict_empty_rows_returns_none():
    assert _compute_overall_verdict_from_checklist({}, "post-firmware-upgrade-verification") is None


# ─── _extract_summary_block ───────────────────────────────────────────

def test_extract_summary_basic():
    """Pulls prose under '## Summary' (case-insensitive)."""
    synth = """## Investigation
some text
## Summary
This is the summary line.
Second sentence.
## Next steps
do x"""
    out = _extract_summary_block(synth)
    assert out.startswith("This is the summary line.")
    assert "Second sentence." in out
    assert "Next steps" not in out  # stops at next ## header


def test_extract_summary_at_end_of_doc():
    """Summary that runs to EOF is captured."""
    synth = "preamble\n## Summary\nfinal words.\n"
    out = _extract_summary_block(synth)
    assert out == "final words."


def test_extract_summary_missing_returns_empty():
    assert _extract_summary_block("nothing here") == ""
    assert _extract_summary_block("") == ""


# ─── _check_summary_matches_overall ───────────────────────────────────

def test_summary_must_not_violation():
    """post-upgrade 'verified' must NOT say 'FAILED' anywhere in Summary."""
    synth = "## Summary\nVerification FAILED for fabric x."
    m = _check_summary_matches_overall(
        "post-firmware-upgrade-verification", synth, "verified"
    )
    assert m is not None
    assert m["kind"] == "summary_overall"
    assert m["computed"] == "verified"


def test_summary_must_match_violation():
    """post-upgrade 'verification_failed' MUST say 'failed' or 'FAILED'."""
    synth = "## Summary\nEverything looks great."
    m = _check_summary_matches_overall(
        "post-firmware-upgrade-verification", synth, "verification_failed"
    )
    assert m is not None
    assert m["computed"] == "verification_failed"
    assert "missing required phrase" in m["claimed_phrase"]


def test_summary_consistent_no_mismatch():
    """When Summary is consistent with the expected verdict, returns None."""
    synth = "## Summary\nVerification succeeded for all fabrics."
    m = _check_summary_matches_overall(
        "post-firmware-upgrade-verification", synth, "verified"
    )
    assert m is None


def test_summary_unknown_verdict_returns_none():
    """Unknown verdict key for the skill returns None (no rules to check)."""
    m = _check_summary_matches_overall(
        "post-firmware-upgrade-verification", "## Summary\nx", "some_verdict"
    )
    assert m is None


def test_summary_empty_returns_none():
    """No Summary block → no rule to apply → None."""
    m = _check_summary_matches_overall(
        "post-firmware-upgrade-verification", "no summary here", "verified"
    )
    assert m is None


# ─── _check_skill1_summary_freshness ──────────────────────────────────

def test_skill1_freshness_active_state_first_sentence_caught():
    """Skill #1 with verdict=critical + freshness=all_stale + 'is critical' first sentence → flag."""
    synth = "## Summary\nFabric DC is in critical state. Pre-existing alarms only."
    m = _check_skill1_summary_freshness(synth, "critical", "all_stale")
    assert m is not None
    assert m["kind"] == "summary_freshness"


def test_skill1_freshness_softened_first_sentence_passes():
    """If first sentence uses 'appears healthy' phrasing, no flag."""
    synth = "## Summary\nFabric DC data plane appears healthy. 3 pre-existing critical alarms (>24h) present."
    m = _check_skill1_summary_freshness(synth, "critical", "all_stale")
    assert m is None


def test_skill1_freshness_only_triggers_on_stale():
    """If freshness=any_fresh, the freshness rule doesn't apply."""
    synth = "## Summary\nFabric DC is in critical state."
    m = _check_skill1_summary_freshness(synth, "critical", "any_fresh")
    assert m is None


def test_skill1_freshness_only_triggers_on_degraded_or_critical():
    """If verdict=healthy, no rule even with all_stale."""
    synth = "## Summary\nFabric DC is fine."
    m = _check_skill1_summary_freshness(synth, "healthy", "all_stale")
    assert m is None


# ─── _detect_verdict_mismatches (integration of the three) ────────────

def test_detect_mismatches_check_row_disagreement():
    """Checklist Check 5 = FAIL but host computed alarm_health = PASS → check_row mismatch."""
    synth = """## Checklist
| 1 | x | PASS | y |
| 5 | alarm health | FAIL | the model says fail |
"""
    computed = {"alarm_health": "PASS", "alarm_health_reason": "no active alarms"}
    out = _detect_verdict_mismatches(
        "post-firmware-upgrade-verification", synth, computed
    )
    assert any(m["kind"] == "check_row" for m in out)
    row_m = next(m for m in out if m["kind"] == "check_row")
    assert row_m["row"] == "5"
    assert row_m["computed"] == "PASS"
    assert row_m["claimed"] == "FAIL"


def test_detect_mismatches_aggregates_both_kinds():
    """When both per-row AND overall summary disagree, both surface."""
    synth = """## Checklist
| 1 | x | PASS | y |
| 5 | alarm health | FAIL | model says fail |

## Summary
Verification FAILED for fabric x.
"""
    # Host says alarm_health was PASS; row checklist also has all PASS at line 1,
    # FAIL at row 5. But overall verdict from checklist (one FAIL) = verification_failed,
    # which matches Summary. So only row mismatch triggers, not summary mismatch.
    computed = {"alarm_health": "PASS", "alarm_health_reason": "x"}
    out = _detect_verdict_mismatches(
        "post-firmware-upgrade-verification", synth, computed
    )
    kinds = [m["kind"] for m in out]
    assert "check_row" in kinds


def test_detect_mismatches_clean_returns_empty():
    """All consistent → empty list."""
    synth = """## Checklist
| 1 | x | PASS | y |

## Summary
Verification succeeded.
"""
    computed = {"alarm_health": "PASS", "alarm_health_reason": "x"}
    out = _detect_verdict_mismatches(
        "post-firmware-upgrade-verification", synth, computed
    )
    assert out == []


def test_detect_mismatches_skill1_freshness_path():
    """fabric-health-investigation runs the freshness check too."""
    synth = "## Summary\nFabric DC is in critical state."
    computed = {
        "severity_verdict": "critical",
        "alarm_freshness": "all_stale",
    }
    out = _detect_verdict_mismatches("fabric-health-investigation", synth, computed)
    assert any(m["kind"] == "summary_freshness" for m in out)


def test_detect_mismatches_unknown_skill_no_op():
    """Unknown skill → no checks fire → empty."""
    out = _detect_verdict_mismatches("some-other-skill", "## Summary\nx", {})
    assert out == []
