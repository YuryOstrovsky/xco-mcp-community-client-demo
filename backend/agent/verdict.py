"""
Post-synthesis verdict validation for agent skills.

After the model produces its final Markdown report, this module parses the
checklist table and compares each row's Result column against the host's
own computed verdicts. Mismatches force a rewrite.

Why this exists: the model has demonstrated, repeatedly, that it ignores
even VERY explicit "use this verdict verbatim" instructions when its
trained-in bias pulls toward FAIL/critical. We can't negotiate with that
via prompts. Validating post-hoc is the only reliable enforcement.

Three classes of mismatch are detected:

  1. Individual checklist row whose Result doesn't match the host's
     per-check verdict (e.g. Check 5 = FAIL but computed alarm_health = PASS).
  2. Overall Summary verdict (claimed via phrases like "verification FAILED"
     / "NOT ready") doesn't match the verdict implied by the checklist row
     results.
  3. Skill #1 specifically: Summary asserts active critical/degraded state
     when alarms are all_stale (must use "appears healthy + pre-existing"
     phrasing instead).

Extracted from agent/loop.py in the task #92 split. All public symbols are
re-exported via agent/__init__.py for back-compat with any caller that
imported them from `agent` directly.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional


_CHECKLIST_ROW_RE = re.compile(
    # Markdown table row: | N | Check name … | Result | Detail … |
    # Group 1: row number; Group 2: check name; Group 3: result.
    r"^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(PASS|FAIL|ADVISORY|SKIP)\s*\|",
    re.MULTILINE | re.IGNORECASE,
)


def _extract_synthesis_check_verdicts(synthesis: str) -> Dict[int, str]:
    """Parse a Markdown checklist table from the synthesis. Returns
    {row_num: result_uppercase}."""
    out: Dict[int, str] = {}
    for m in _CHECKLIST_ROW_RE.finditer(synthesis or ""):
        try:
            n = int(m.group(1))
            out[n] = m.group(3).upper()
        except (ValueError, AttributeError):
            continue
    return out


# Per-skill: which checklist row index represents the alarm-health check?
# (post-upgrade has it as Check 5; pre-flight has it as Check 2.) Easy
# to extend if future skills add their own.
_ALARM_HEALTH_CHECK_ROW = {
    "post-firmware-upgrade-verification": 5,
    "pre-firmware-upgrade-check": 2,
}


def _compute_overall_verdict_from_checklist(
    rows: Dict[int, str], skill_name: str,
) -> Optional[str]:
    """From the parsed checklist row results, compute the overall skill
    verdict (as the skill's verdict-key vocabulary). Returns None for skills
    that don't follow the standard checklist pattern."""
    if not rows:
        return None
    vals = list(rows.values())
    if skill_name == "post-firmware-upgrade-verification":
        if any(v == "FAIL" for v in vals):
            return "verification_failed"
        if any(v == "ADVISORY" for v in vals):
            return "verified_with_advisory"
        if all(v == "PASS" for v in vals):
            return "verified"
    elif skill_name == "pre-firmware-upgrade-check":
        if any(v == "FAIL" for v in vals):
            return "not_ready"
        if any(v == "ADVISORY" for v in vals):
            return "ready_with_caveats"
        if all(v == "PASS" for v in vals):
            return "ready_to_upgrade"
    return None


# Per-skill: phrases that MUST or MUST NOT appear in the Summary line for
# each computed overall verdict. We match case-insensitive.
_VERDICT_SUMMARY_RULES: Dict[str, Dict[str, Dict[str, List[str]]]] = {
    "post-firmware-upgrade-verification": {
        "verified": {
            "must_not": [r"\bFAILED\b", r"verification\s+failed", r"with\s+(?:advisory|caveats)"],
        },
        "verified_with_advisory": {
            "must_not": [r"\bFAILED\b", r"verification\s+failed"],
        },
        "verification_failed": {
            "must_match_any": [r"\bFAILED\b", r"verification\s+failed"],
        },
    },
    "pre-firmware-upgrade-check": {
        "ready_to_upgrade": {
            "must_not": [r"\bNOT\s+ready\b", r"with\s+(?:advisory|caveats)"],
        },
        "ready_with_caveats": {
            "must_not": [r"\bNOT\s+ready\b"],
        },
        "not_ready": {
            "must_match_any": [r"\bNOT\s+ready\b"],
        },
    },
}


def _extract_summary_block(synthesis: str) -> str:
    """Pull the prose under '## Summary' (up to the next '##' header)."""
    m = re.search(
        r"^##\s*Summary\s*\n+(.+?)(?=^##\s|\Z)",
        synthesis or "", re.DOTALL | re.MULTILINE | re.IGNORECASE,
    )
    return m.group(1).strip() if m else ""


def _check_summary_matches_overall(
    skill_name: str, synthesis: str, expected_verdict: str,
) -> Optional[Dict[str, str]]:
    """Returns a mismatch dict if the Summary contradicts the expected
    verdict (computed from the checklist rows). None if no contradiction."""
    rules = _VERDICT_SUMMARY_RULES.get(skill_name, {}).get(expected_verdict)
    if not rules:
        return None
    summary = _extract_summary_block(synthesis)
    if not summary:
        return None
    for pat in rules.get("must_not", []):
        if re.search(pat, summary, re.I):
            return {
                "kind": "summary_overall",
                "computed": expected_verdict,
                "claimed_phrase": pat,
                "reason": (
                    f"Summary contains language matching '{pat}' but the "
                    f"checklist supports verdict '{expected_verdict}'."
                ),
            }
    must_match = rules.get("must_match_any", [])
    if must_match and not any(re.search(pat, summary, re.I) for pat in must_match):
        return {
            "kind": "summary_overall",
            "computed": expected_verdict,
            "claimed_phrase": "(missing required phrase)",
            "reason": (
                f"Summary doesn't contain any of {must_match!r} but the "
                f"checklist supports verdict '{expected_verdict}'."
            ),
        }
    return None


# For skill #1 (fabric-health-investigation), the verdict pairs with the
# alarm freshness. When freshness=all_stale and verdict=critical/degraded,
# the Summary MUST acknowledge "data plane appears healthy" + "pre-existing"
# rather than asserting "is in critical state".
def _check_skill1_summary_freshness(
    synthesis: str, verdict_key: str, freshness: str,
) -> Optional[Dict[str, str]]:
    if not (verdict_key in ("degraded", "critical") and freshness == "all_stale"):
        return None
    summary = _extract_summary_block(synthesis)
    if not summary:
        return None
    # The check is FIRST-SENTENCE-ONLY. Softening language that appears
    # in later sentences does NOT grant amnesty for an active-state
    # assertion in the lead — operators read the first sentence first
    # and that's the headline claim.
    first_sentence_m = re.match(r"^[^.\n]+", summary.strip())
    first_sentence = first_sentence_m.group(0) if first_sentence_m else summary

    forbidden = re.search(
        r"\b(?:is|are)\s+(?:currently\s+|now\s+|presently\s+|reportedly\s+)?"
        r"(?:degraded|unhealthy|broken|in\s+(?:a\s+)?critical(?:\s+state)?|critical)\b",
        first_sentence, re.I,
    )
    if forbidden:
        return {
            "kind": "summary_freshness",
            "computed": f"{verdict_key} + all_stale",
            "claimed_phrase": forbidden.group(0),
            "reason": (
                f"FIRST SENTENCE of Summary asserts active state "
                f"(\"{forbidden.group(0)}\"), but all alarms are stale "
                f"(>24h old, pre-existing). Even with softening phrases "
                f"later in the paragraph, the lead claim is what the "
                f"operator reads first. Required first-sentence phrasing: "
                f"'Fabric X data plane appears healthy. N pre-existing "
                f"{verdict_key}-severity alarms (>24h old) present — "
                f"likely platform-side / management-plane concerns "
                f"separate from fabric operation.'"
            ),
        }
    return None


def _detect_verdict_mismatches(
    skill_name: str,
    synthesis: str,
    computed: Dict[str, str],
) -> List[Dict[str, str]]:
    """Return a list of detected mismatches between the model's synthesis
    and host-computed expectations. Catches three classes:

    1. Individual checklist row whose Result doesn't match the host's
       per-check verdict (e.g. Check 5 = FAIL but computed alarm_health = PASS).
    2. Overall Summary verdict (claimed via phrases like "verification
       FAILED" / "NOT ready") doesn't match the verdict implied by the
       checklist row results.
    3. Skill #1 specifically: Summary asserts active critical/degraded
       state when alarms are all_stale (must use "appears healthy +
       pre-existing" phrasing instead).
    """
    mismatches: List[Dict[str, str]] = []
    claimed_rows = _extract_synthesis_check_verdicts(synthesis)

    # 1. Per-check (alarm health row)
    row_idx = _ALARM_HEALTH_CHECK_ROW.get(skill_name)
    alarm_v = computed.get("alarm_health")
    if row_idx and alarm_v:
        claimed = claimed_rows.get(row_idx)
        if claimed and claimed != alarm_v.upper():
            mismatches.append({
                "kind": "check_row",
                "row": str(row_idx),
                "check": "alarm health",
                "computed": alarm_v.upper(),
                "claimed": claimed,
                "reason": computed.get("alarm_health_reason", ""),
            })

    # 2. Overall Summary verdict consistency with the checklist
    expected_overall = _compute_overall_verdict_from_checklist(claimed_rows, skill_name)
    if expected_overall:
        m = _check_summary_matches_overall(skill_name, synthesis, expected_overall)
        if m:
            mismatches.append(m)

    # 3. Skill #1 freshness-aware Summary phrasing
    if skill_name == "fabric-health-investigation":
        verdict_key = computed.get("severity_verdict") or ""
        freshness = computed.get("alarm_freshness") or ""
        m1 = _check_skill1_summary_freshness(synthesis, verdict_key, freshness)
        if m1:
            mismatches.append(m1)

    return mismatches
