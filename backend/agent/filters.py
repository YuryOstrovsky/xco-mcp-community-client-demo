"""
Server-side tool-result filtering and normalization for agent skills.

Tool results often need massaging BEFORE the model sees them — the LLM has
shown, repeatedly, that it can't be trusted to ignore historical alarm
noise or misleading config-derived flags from prompt instructions alone.
Three patterns live here:

  1. Alarm filtering — strip resolved/cleared samples + compute hard
     verdicts (`_filter_resolved_alarms` + helpers).
  2. BGP normalization — rewrite the misleading `total_established: 0`
     from running-config-derived summaries (`_normalize_bgp_summary`).
  3. Firmware-storage verdict injection — collapse devices[] into a
     single pass/fail/advisory key (`_firmware_storage_pp`).

Plus the registry that runs them in sequence (`_TOOL_RESULT_PREPROCESSORS`),
and two display-side helpers used at trace-render time (`_shrink_for_model`,
`_summary_preview`).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple


# Text patterns the alarm tools use when an alarm has been *resolved*. If
# any one matches an alarm's latest message, the alarm is no longer an
# active problem and we strip it before passing to the model. Prompts alone
# weren't strong enough — the model kept including these in Findings.
# Linguistic-shape patterns for "this alarm message is describing a
# resolution / safe state, not a current problem". Matching these as
# broad linguistic categories rather than literal site-specific strings
# is what lets the agent generalize to fabrics we haven't debugged.
#
# Each pattern is annotated with the linguistic shape it captures.
# Adding a new pattern here should mean "we found a SHAPE we didn't have",
# not "this site has different wording for the same shape we already had".
_RESOLVED_ALARM_PATTERNS = [
    # ── Past-tense resolution verbs ──
    # "Contact has been regained", "Service was restored", "BGP recovered",
    # "Connection re-established", "Configuration repaired", "Issue resolved"
    re.compile(
        r"\b(?:has\s+been\s+|was\s+|is\s+|got\s+|been\s+|now\s+)?"
        r"(?:regained|restored|recovered|reconnected|re-?established|repaired|resolved|reachable\s+again)\b",
        re.I,
    ),
    # "Password renewed on device", "Certificate renewed at 14:32"
    # Restricted to "renewed on/at/successfully" so "could not be renewed"
    # / "renewal failed" don't match.
    re.compile(r"\brenewed\s+(?:on|at|successfully)\b", re.I),
    # "Alarm cleared", "Condition cleared", "Issue cleared automatically"
    re.compile(r"\b(?:alarm|condition|issue|fault|event|warning)\s+(?:is\s+|was\s+|has\s+been\s+)?cleared\b", re.I),
    re.compile(r"\bcleared\s+(?:on|at|automatically|successfully|by\s+)\b", re.I),
    # "Back online", "Back up", "Up again", "Up and running"
    re.compile(r"\b(?:back\s+(?:online|up|in\s+service)|is\s+up\s+again|up\s+and\s+running)\b", re.I),

    # ── Present-tense safety / normalcy assertions ──
    # "is at a safe …", "is at safe levels", "at a safe utilization"
    re.compile(r"\b(?:is\s+)?at\s+(?:a\s+)?safe\b", re.I),
    # "Safe storage utilization", "normal range", "healthy state",
    # "acceptable threshold", "within normal range", "operating normally"
    re.compile(
        r"\b(?:safe|normal|healthy|acceptable|nominal)\s+"
        r"(?:storage|memory|cpu|utilization|level|levels|state|range|threshold|limits)\b",
        re.I,
    ),
    re.compile(r"\bwithin\s+(?:normal|safe|acceptable|expected|nominal)\s+(?:range|limits|threshold|bounds|parameters|spec|specification)\b", re.I),
    re.compile(r"\boperating\s+(?:normally|within\s+(?:range|limits|spec|parameters))\b", re.I),
    # "Below threshold" / "below the warning limit" / "below alarm level"
    re.compile(r"\bbelow\s+(?:the\s+)?(?:threshold|limit|warning|alarm\s+level)\b", re.I),
    # "All systems normal", "service is running" (matches XCO's NodeService),
    # "is online", "is reachable", "is healthy"
    re.compile(r"\bare\s+in\s+running\s+state\b", re.I),
    re.compile(r"\bservices?\s+(?:is|are)\s+(?:running|up|operational|healthy)\b", re.I),

    # ── Negations of problems ──
    # "No longer down", "no longer unreachable", "no longer expired"
    re.compile(r"\bno\s+longer\s+(?:down|offline|unreachable|unavailable|expired|in\s+error)\b", re.I),
    # "No issues found", "no errors detected", "no alarms present"
    re.compile(r"\bno\s+(?:issues|problems|errors|alarms|faults)\s+(?:detected|found|observed|present|reported)\b", re.I),

    # ── Intentional admin-action events (deletion etc.) ──
    # XCO emits a critical-severity event when a user deletes a fabric.
    # That's an admin action, not a fault — exclude from "active concerns".
    re.compile(r"\b(?:is|was|has\s+been)\s+deleted\b", re.I),
    re.compile(r"\bdeleted\s+successfully\b", re.I),
]


def _is_resolved_alarm_message(s: Any) -> bool:
    if not isinstance(s, str):
        return False
    return any(p.search(s) for p in _RESOLVED_ALARM_PATTERNS)


def _classify_group_age(group: Any, fresh_threshold_hours: int = 24) -> str:
    """Classify an alarm group by sample age.

    Returns:
      'fresh'  — at least one sample timestamp is within fresh_threshold_hours
      'stale'  — all sample timestamps are older than the threshold
      'unknown' — no parseable timestamps in any sample

    Used to distinguish pre-existing alarms (stale) from potentially
    operation-induced alarms (fresh). For example, post-upgrade
    verification's Check 5 should treat stale alarms as ADVISORY (they
    pre-dated the upgrade) and only FAIL on fresh ones.
    """
    if not isinstance(group, dict):
        return "unknown"
    samples = group.get("samples", [])
    if not isinstance(samples, list) or not samples:
        return "unknown"
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=fresh_threshold_hours)
    parsed_any = False
    fresh_any = False
    for s in samples:
        if not isinstance(s, dict):
            continue
        ts_raw = s.get("timestamp") or s.get("event_time") or s.get("time")
        if not isinstance(ts_raw, str) or not ts_raw.strip():
            continue
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            parsed_any = True
            if ts > cutoff:
                fresh_any = True
                break
        except (ValueError, TypeError):
            continue
    if not parsed_any:
        return "unknown"
    return "fresh" if fresh_any else "stale"


def _sample_is_resolved(sample: Any) -> bool:
    """One alarm occurrence (a "sample" in MCP terms) is resolved if its
    message text matches a known resolution pattern, OR it carries a
    structural flag saying so."""
    if not isinstance(sample, dict):
        return False
    msg = sample.get("message") or sample.get("text") or sample.get("description")
    if isinstance(msg, str) and _is_resolved_alarm_message(msg):
        return True
    if sample.get("is_cleared") is True or sample.get("cleared") is True:
        return True
    state = sample.get("state")
    if isinstance(state, str) and state.lower() in ("cleared", "resolved", "closed"):
        return True
    return False


_SEVERITY_RANK = {
    "info": 0, "informational": 0,
    "warning": 1,
    "minor": 2,
    "major": 3,
    "critical": 4, "fatal": 4,
}


def _compute_verdict_from_groups(groups: List[Any]) -> Tuple[str, str]:
    """From the surviving alarm groups, compute a verdict phrase the model
    MUST use in its Summary line. Returns (verdict_key, verdict_phrase).

    Verdict ladder (lowest → highest):
      - "healthy"                          (0 active)
      - "operationally_healthy_advisory"   (only info/warning/minor)
      - "degraded"                         (one or more major)
      - "critical"                         (one or more critical)

    The phrase is what the model is required to lead its Summary with.
    Anything stronger than the phrase is a violation.
    """
    if not groups:
        return "healthy", "Fabric is healthy"
    max_rank = -1
    for g in groups:
        if not isinstance(g, dict):
            continue
        sev = (g.get("severity") or "").lower()
        rank = _SEVERITY_RANK.get(sev, -1)
        if rank > max_rank:
            max_rank = rank
    if max_rank < 0:
        return "healthy", "Fabric is healthy"
    if max_rank <= 2:  # info, warning, minor
        return "operationally_healthy_advisory", "Fabric is operationally healthy with N minor advisory items"
    if max_rank == 3:
        return "degraded", "Fabric is degraded"
    return "critical", "Fabric is in critical state"


def _filter_resolved_alarms(tool_name: str, payload: Any) -> Tuple[Any, int]:
    """Strip resolved alarms from the payload of MCP fault/alarm tools BEFORE
    the model sees it. Returns (filtered_payload, n_groups_or_samples_dropped).

    Why this exists: the MCP alarm tools return historical resolution events
    in the same payload as active alerts. Three rounds of prompt-only
    guidance failed to stop the model from listing those as active findings.
    Filtering here eliminates the failure mode at the source.

    The shape we actually get back from `fault_get_active_alarms_top` is:
      payload.top[]  — list of alarm GROUPS
        .name, .severity, .count, .top_resources, .samples[]
                                                  └── each sample has .message

    Strategy:
      1. For each group: walk its samples, drop the resolved ones.
      2. If a group ends up with 0 active samples, drop the entire group
         (its top-level `count` and `top_resources` would otherwise mislead
         the model into thinking the alarm type is still active).
      3. Otherwise update the group's `count` to reflect the surviving sample
         set and trim `top_resources` to only those still backed by an
         active sample.
      4. Update `summary.active_total_fetched` / `active_after_filters` to
         reflect what's left.
    """
    if tool_name not in ("fault_get_active_alarms_top",
                         "fault_get_alarm_details_with_context",
                         "faultmanager_get_alarm_history",
                         "faultmanager_get_alarm_summary"):
        return payload, 0
    if not isinstance(payload, dict):
        return payload, 0

    # Unwrap the standard MCP envelope: {result: {payload: {...}}} or {payload: {...}}
    inner = payload
    if isinstance(inner.get("result"), dict) and isinstance(inner["result"].get("payload"), dict):
        outer_keys = ("result", "payload")
        body = inner["result"]["payload"]
    elif isinstance(inner.get("payload"), dict):
        outer_keys = ("payload",)
        body = inner["payload"]
    else:
        outer_keys = ()
        body = inner

    dropped = 0

    # `top` (alarm groups) is the main concern — that's what the model uses.
    if isinstance(body, dict) and isinstance(body.get("top"), list):
        kept_groups: List[Any] = []
        for group in body["top"]:
            if not isinstance(group, dict):
                kept_groups.append(group)
                continue
            samples = group.get("samples") or []
            if not isinstance(samples, list):
                kept_groups.append(group)
                continue
            active_samples = [s for s in samples if not _sample_is_resolved(s)]
            n_resolved_in_group = len(samples) - len(active_samples)
            if not active_samples:
                # All samples are resolved — drop the whole group.
                dropped += max(1, n_resolved_in_group)
                continue
            # Keep the group, but with only active samples + adjusted count.
            new_group = dict(group)
            new_group["samples"] = active_samples
            # Classify the surviving samples by recency. The model will use
            # this to distinguish pre-existing alarms ("stale") from
            # potentially operation-induced ones ("fresh").
            new_group["_agent_alarm_age"] = _classify_group_age({"samples": active_samples})
            # Best-effort: shrink count to the surviving sample count if the
            # original count looks like it counted per-sample. (We can't know
            # for sure without server semantics, but new_group["count"] left
            # as-is would be misleading.)
            if isinstance(group.get("count"), int):
                new_group["count"] = len(active_samples)
            # Trim top_resources to those that still appear as a resource on
            # at least one surviving sample.
            surviving_res = {s.get("resource") for s in active_samples if isinstance(s, dict)}
            tr = group.get("top_resources")
            if isinstance(tr, list):
                new_group["top_resources"] = [r for r in tr if not (isinstance(r, list) and r and r[0] in surviving_res) is False]
                # The list comprehension above has wrong logic; simplify:
                new_group["top_resources"] = [
                    r for r in tr
                    if (isinstance(r, list) and len(r) > 0 and r[0] in surviving_res)
                ]
            dropped += n_resolved_in_group
            kept_groups.append(new_group)
        body = dict(body)
        body["top"] = kept_groups

        # Adjust the summary counts so the model sees consistent numbers.
        summ = body.get("summary")
        if isinstance(summ, dict):
            new_summ = dict(summ)
            total_active = sum(
                len(g.get("samples", [])) for g in kept_groups if isinstance(g, dict)
            )
            # Only override if the original keys exist; don't fabricate new keys.
            if "active_after_filters" in new_summ:
                new_summ["active_after_filters"] = total_active
            if "returned_groups" in new_summ:
                new_summ["returned_groups"] = len(kept_groups)
            if "filtered_out" in new_summ:
                new_summ["filtered_out"] = (new_summ.get("filtered_out") or 0) + dropped

            # Recompute `by_severity` from the surviving groups. Without
            # this, the model reads stale pre-filter counts (e.g.
            # "16 major" when only minor/warning are actually active)
            # and fabricates blockers that don't exist.
            if "by_severity" in new_summ and isinstance(new_summ["by_severity"], dict):
                new_by_severity: Dict[str, int] = {}
                for g in kept_groups:
                    if not isinstance(g, dict):
                        continue
                    sev = (g.get("severity") or "").lower()
                    if not sev:
                        continue
                    n_samples = len(g.get("samples", [])) if isinstance(g.get("samples"), list) else 0
                    new_by_severity[sev] = new_by_severity.get(sev, 0) + n_samples
                new_summ["by_severity"] = new_by_severity

            # Hard verdict: compute from surviving alarms. The model MUST use
            # this phrase in its Summary line. Three rounds of prompt-only
            # calibration failed to stop the model from saying "unhealthy"
            # for minor-only states.
            verdict_key, verdict_phrase = _compute_verdict_from_groups(kept_groups)
            new_summ["_agent_verdict"] = verdict_key
            new_summ["_agent_verdict_phrase"] = verdict_phrase

            # Aggregate freshness across surviving groups. "all_stale" is the
            # signal that pre-existing alarms are present — relevant for
            # skills like post-upgrade verification, which should not FAIL
            # on alarms that pre-date the upgrade window.
            freshness_set = {
                g.get("_agent_alarm_age", "unknown")
                for g in kept_groups if isinstance(g, dict)
            }
            if not freshness_set:
                aggregate_freshness = "no_alarms"
            elif "fresh" in freshness_set:
                aggregate_freshness = "any_fresh"
            elif freshness_set == {"unknown"}:
                aggregate_freshness = "unknown"
            else:
                aggregate_freshness = "all_stale"
            new_summ["_agent_alarms_freshness"] = aggregate_freshness
            new_summ["_agent_alarms_freshness_note"] = (
                "VALUES: 'no_alarms' (none active) | 'all_stale' (all alarms "
                "older than 24h — pre-existing, NOT operation-induced) | "
                "'any_fresh' (at least one alarm within last 24h — could be "
                "operation-induced) | 'unknown' (timestamps couldn't be parsed). "
                "For skills that gate on 'is this alarm caused by the operation "
                "we just performed?' (post-firmware-upgrade-verification), "
                "treat 'all_stale' as PRE-EXISTING — do NOT FAIL the verification "
                "on stale alarms."
            )

            # Compute the AUTHORITATIVE check verdict for alarm-health checks.
            # The model has been ignoring the prompt-level rule mapping
            # (severity + freshness → check verdict) and inflating verdicts to
            # FAIL even when everything is stale. Computing here removes the
            # interpretation step entirely.
            #
            # Mapping:
            #   no_alarms                     → PASS
            #   all_stale, healthy/advisory   → PASS
            #   all_stale, degraded/critical  → ADVISORY (pre-existing)
            #   any_fresh, healthy            → PASS
            #   any_fresh, advisory           → ADVISORY
            #   any_fresh, degraded/critical  → FAIL (potentially operation-induced)
            #   unknown, healthy/advisory     → PASS
            #   unknown, degraded/critical    → ADVISORY (be conservative)
            if aggregate_freshness == "no_alarms":
                check_verdict = "PASS"
                check_reason = "no active alarms"
            elif aggregate_freshness == "all_stale":
                if verdict_key in ("healthy", "operationally_healthy_advisory"):
                    check_verdict = "PASS"
                    check_reason = "stale alarms only minor/warning, no concerns"
                else:
                    check_verdict = "ADVISORY"
                    check_reason = "stale critical/major alarms — pre-existing, NOT operation-induced"
            elif aggregate_freshness == "any_fresh":
                if verdict_key == "healthy":
                    check_verdict = "PASS"
                    check_reason = "fresh data, no active alarms surviving filter"
                elif verdict_key == "operationally_healthy_advisory":
                    check_verdict = "ADVISORY"
                    check_reason = "fresh minor/warning alarms"
                else:
                    check_verdict = "FAIL"
                    check_reason = "fresh major/critical alarms — potentially operation-induced"
            else:  # unknown
                if verdict_key in ("healthy", "operationally_healthy_advisory"):
                    check_verdict = "PASS"
                    check_reason = "no concerning alarms (timestamps unparseable, conservative)"
                else:
                    check_verdict = "ADVISORY"
                    check_reason = "major+ alarms but timestamps unparseable — conservative"
            new_summ["_agent_check_verdict_alarm_health"] = check_verdict
            new_summ["_agent_check_verdict_alarm_health_reason"] = check_reason
            new_summ["_agent_check_verdict_alarm_health_note"] = (
                "AUTHORITATIVE check verdict for any 'alarm-health' or "
                "'post-operation alarm' check. USE THIS VERBATIM as the "
                "check Result. Skills that previously fell through to model "
                "judgment (Check 5 of post-firmware-upgrade-verification, "
                "Check 2 of pre-firmware-upgrade-check) now have a hard verdict "
                "computed from severity + age. Do NOT override; the model has "
                "shown it inflates these to FAIL on pre-existing data."
            )
            new_summ["_agent_verdict_note"] = (
                f"VERDICT: '{verdict_key}'. The Summary section MUST lead with "
                f"this phrasing (or equivalent): \"{verdict_phrase}\". "
                f"Do NOT use language stronger than the verdict — i.e., do NOT "
                f"say 'unhealthy', 'degraded', 'in trouble', or 'critical' for "
                f"a verdict of 'healthy' or 'operationally_healthy_advisory'. "
                f"Minor and warning alarms are advisory, not failures. "
                f"This is a HARD constraint computed from the data; ignoring "
                f"it produces a contradictory Summary."
            )

            new_summ["_agent_filter_note"] = (
                f"Stripped {dropped} resolved/cleared alarm sample(s) "
                "before passing to the model. These are historical events "
                "(messages like 'contact regained', 'is deleted', 'restored'), "
                "not active problems."
            )
            body["summary"] = new_summ

    # Re-wrap into the original envelope (early-return path — same envelope code below).
    out = body
    for k in reversed(outer_keys):
        if k == "payload":
            out = {"payload": out}
        elif k == "result":
            tmp = dict(payload.get("result", {}))
            tmp["payload"] = out["payload"] if isinstance(out, dict) and "payload" in out else out
            out = {**payload, "result": tmp}
            return out, dropped
    if outer_keys == ("payload",):
        return {**payload, **out}, dropped
    return out, dropped


def _normalize_bgp_summary(tool_name: str, payload: Any) -> Tuple[Any, Optional[str]]:
    """Fix the misleading flags `restconf_get_bgp_summary` returns.

    The tool reads from running-config (not operational state), so it
    always reports `total_established: 0` and `all_healthy: false` even
    when neighbors are actually Established. The frontend BGP widget
    already works around this; the model doesn't know to.

    We rewrite the summary based on what's actually available
    (`switches_ok / total_switches`) and add a note. Returns
    (normalized_payload, note_or_None).
    """
    if tool_name != "restconf_get_bgp_summary":
        return payload, None
    if not isinstance(payload, dict):
        return payload, None

    # Find the body
    body = payload
    if isinstance(body.get("result"), dict) and isinstance(body["result"].get("payload"), dict):
        outer_envelope = "result.payload"
        body = body["result"]["payload"]
    elif isinstance(body.get("payload"), dict):
        outer_envelope = "payload"
        body = body["payload"]
    else:
        outer_envelope = ""

    if not isinstance(body, dict):
        return payload, None

    summ = body.get("summary")
    if not isinstance(summ, dict):
        return payload, None

    # Only intervene if the misleading config-source pattern is present.
    src = None
    switches = body.get("switches") or []
    if isinstance(switches, list) and switches and isinstance(switches[0], dict):
        src = switches[0].get("source")
    is_config_source = src == "running-config"
    misleading = (
        summ.get("total_established") == 0
        and summ.get("total_neighbors", 0) > 0
        and summ.get("all_healthy") is False
        and is_config_source
    )
    if not misleading:
        return payload, None

    new_summ = dict(summ)
    total_sw = new_summ.get("total_switches", 0) or 0
    sw_ok = new_summ.get("switches_ok", 0) or 0
    note = (
        "BGP summary is derived from running-config (not operational state). "
        f"`total_established: 0` / `all_healthy: false` are NOT meaningful here — "
        f"the tool simply doesn't return per-neighbor operational status. "
        f"Use `switches_ok ({sw_ok}) / total_switches ({total_sw})` as the "
        f"reachability proxy and the listed neighbor configs as evidence of "
        f"intent. Do NOT report 'all BGP neighbors are down' from this data."
    )
    new_summ["all_healthy"] = (sw_ok == total_sw and total_sw > 0)
    new_summ["_agent_translation_note"] = note
    # Drop the misleading "total_established: 0" so the model can't quote it.
    new_summ.pop("total_established", None)

    new_body = dict(body)
    new_body["summary"] = new_summ

    if outer_envelope == "result.payload":
        new_result = dict(payload["result"])
        new_result["payload"] = new_body
        return {**payload, "result": new_result}, note
    if outer_envelope == "payload":
        return {**payload, "payload": new_body}, note
    return new_body, note


# ── Tool-result preprocessor registry ────────────────────────────────────────
# Tool results often need server-side massaging before the model sees them
# (the LLM has shown it can't be trusted to ignore historical alarm noise,
# misleading config-derived flags, etc., from prompt instructions alone).
# Each preprocessor implements a uniform shape so the agent loop can run
# them in sequence with one iteration. Adding a new one is appending to
# `_TOOL_RESULT_PREPROCESSORS`.
#
# Existing implementations (`_filter_resolved_alarms`, `_normalize_bgp_summary`)
# stay where they are — the wrappers below adapt them to the protocol so
# we don't perturb their internals.

@dataclass
class _ToolResultPreprocessor:
    """Mutates/filters a tool's response BEFORE it reaches the model and
    optionally emits a trace event.

    Fields:
      kind:        emitted as the trace event's `kind`. Existing kinds
                   ("filtered", "normalized") are preserved here so the
                   UI's per-kind color coding keeps working.
      applies_to:  predicate on the tool name. True → run process().
      process:     (tool_name, payload) -> (new_payload, event_dict | None).
                   The event dict is merged into the trace entry alongside
                   {step, role, kind} which the loop adds.
    """
    kind: str
    applies_to: Callable[[str], bool]
    process: Callable[[str, Any], Tuple[Any, Optional[Dict[str, Any]]]]


_ALARM_TOOL_NAMES: frozenset = frozenset({
    "fault_get_active_alarms_top",
    "fault_get_alarm_details_with_context",
    "faultmanager_get_alarm_history",
    "faultmanager_get_alarm_summary",
})


def _alarm_filter_pp(tool_name: str, payload: Any) -> Tuple[Any, Optional[Dict[str, Any]]]:
    """Adapter: wrap `_filter_resolved_alarms` in the preprocessor protocol."""
    new_payload, n_dropped = _filter_resolved_alarms(tool_name, payload)
    if n_dropped:
        return new_payload, {
            "tool": tool_name,
            "text": (
                f"Stripped {n_dropped} resolved/cleared alarm "
                f"entr{'y' if n_dropped == 1 else 'ies'} before sending to the model."
            ),
        }
    return new_payload, None


def _bgp_normalizer_pp(tool_name: str, payload: Any) -> Tuple[Any, Optional[Dict[str, Any]]]:
    """Adapter: wrap `_normalize_bgp_summary` in the preprocessor protocol."""
    new_payload, note = _normalize_bgp_summary(tool_name, payload)
    if note:
        return new_payload, {
            "tool": tool_name,
            "text": "Rewrote BGP summary flags (running-config source, not operational state).",
        }
    return new_payload, None


def _firmware_storage_pp(tool_name: str, payload: Any) -> Tuple[Any, Optional[Dict[str, Any]]]:
    """Inject a hard verdict for `firmware_check_storage`.

    The tool returns rich per-switch data (devices[].sufficient,
    all_sufficient, etc.) but the model has shown it can read this
    and still claim "details not retrieved" — same misread-the-data
    pattern as the alarm filter and BGP normalizer. Adding an explicit
    `_agent_storage_verdict` field at the top of the body removes the
    interpretation step.
    """
    if tool_name != "firmware_check_storage":
        return payload, None
    if not isinstance(payload, dict):
        return payload, None

    body = payload
    if isinstance(body.get("result"), dict) and isinstance(body["result"].get("payload"), dict):
        outer = "result.payload"
        body = body["result"]["payload"]
    elif isinstance(body.get("payload"), dict):
        outer = "payload"
        body = body["payload"]
    else:
        outer = ""

    if not isinstance(body, dict):
        return payload, None

    devices = body.get("devices") or []
    if not isinstance(devices, list):
        return payload, None

    n_total = len(devices)
    sufficient_ips = [d.get("ip") for d in devices if isinstance(d, dict) and d.get("sufficient") is True]
    insufficient_entries = [
        {"ip": d.get("ip"), "free_mb": d.get("free_mb"), "required_mb": d.get("required_mb")}
        for d in devices if isinstance(d, dict) and d.get("sufficient") is False
    ]
    error_ips = [d.get("ip") for d in devices if isinstance(d, dict) and d.get("error")]

    if n_total == 0:
        verdict_key = "skip"
        verdict_phrase = "Storage check returned 0 devices — SKIP (couldn't run the check)."
    elif insufficient_entries:
        verdict_key = "fail"
        verdict_phrase = (
            f"Storage check FAIL — {len(insufficient_entries)} of {n_total} switch(es) "
            f"have insufficient free space: {insufficient_entries!r}. "
            "This is a HARD BLOCKER for the upgrade."
        )
    elif error_ips and len(error_ips) == n_total:
        verdict_key = "skip"
        verdict_phrase = f"Storage check returned errors for ALL {n_total} switch(es) ({error_ips!r}) — SKIP."
    elif len(sufficient_ips) == n_total:
        verdict_key = "pass"
        verdict_phrase = (
            f"Storage check PASS — all {n_total} switches have sufficient free space "
            f"(>= required_mb threshold)."
        )
    else:
        # Mixed: some pass, some had errors. Treat as ADVISORY.
        verdict_key = "advisory"
        verdict_phrase = (
            f"Storage check ADVISORY — {len(sufficient_ips)} of {n_total} switches "
            f"sufficient; {len(error_ips)} had errors ({error_ips!r}). "
            "Re-check after resolving SSH/auth on the error switches."
        )

    new_body = dict(body)
    new_body["_agent_storage_verdict"] = verdict_key
    new_body["_agent_storage_summary"] = verdict_phrase
    new_body["_agent_storage_note"] = (
        "VERDICT for Checklist item 'Storage headroom': use the value of "
        "_agent_storage_verdict directly (pass/fail/advisory/skip). The "
        "phrase in _agent_storage_summary is the canonical wording. Do NOT "
        "claim 'details not retrieved' when devices[] contains data."
    )

    if outer == "result.payload":
        new_result = dict(payload["result"])
        new_result["payload"] = new_body
        return {**payload, "result": new_result}, {
            "tool": tool_name,
            "text": verdict_phrase[:200],
        }
    if outer == "payload":
        return {**payload, "payload": new_body}, {
            "tool": tool_name,
            "text": verdict_phrase[:200],
        }
    return new_body, {"tool": tool_name, "text": verdict_phrase[:200]}


# Order matters when preprocessors operate on overlapping payloads. Today
# the two we have target disjoint tools, so order is incidental — but the
# loop respects the list order regardless.
_TOOL_RESULT_PREPROCESSORS: List[_ToolResultPreprocessor] = [
    _ToolResultPreprocessor(
        kind="filtered",
        applies_to=lambda t: t in _ALARM_TOOL_NAMES,
        process=_alarm_filter_pp,
    ),
    _ToolResultPreprocessor(
        kind="normalized",
        applies_to=lambda t: t == "restconf_get_bgp_summary",
        process=_bgp_normalizer_pp,
    ),
    _ToolResultPreprocessor(
        kind="storage_verdict",
        applies_to=lambda t: t == "firmware_check_storage",
        process=_firmware_storage_pp,
    ),
]


def _shrink_for_model(payload: Any, *, max_chars: int = 8000) -> Any:
    """Truncate payloads so we don't blow up the LLM context. Best-effort: keep
    structure, but drop huge nested arrays."""
    s = json.dumps(payload, default=str)
    if len(s) <= max_chars:
        return payload
    # Heavy-handed: re-encode with arrays clipped.
    def clip(o, depth=0):
        if isinstance(o, list):
            return [clip(x, depth + 1) for x in o[:25]] + ([{"_truncated": len(o) - 25}] if len(o) > 25 else [])
        if isinstance(o, dict):
            return {k: clip(v, depth + 1) for k, v in o.items()}
        return o
    return clip(payload)


def _summary_preview(payload: Any) -> str:
    """One-line preview of a tool result for the trace UI. Plain strings; not
    sent to the model. Surfaces failures (status >= 400, errors) prominently."""
    if not isinstance(payload, dict):
        return json.dumps(payload, default=str)[:200]

    # Top-level error envelope from our adapter (timeout / tool_exception)
    if "error" in payload and payload.get("error") in ("timeout", "tool_exception", "tool_not_allowed"):
        detail = str(payload.get("detail") or payload.get("error"))[:180]
        return f"ERROR {payload['error']}: {detail}"

    inner = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    if not isinstance(inner, dict):
        return json.dumps(payload, default=str)[:200]
    status = inner.get("status")
    inner_payload = inner.get("payload") if isinstance(inner.get("payload"), dict) else None
    meta = inner_payload.get("meta") if inner_payload and isinstance(inner_payload.get("meta"), dict) else {}
    ok = meta.get("ok")
    err = meta.get("error") or inner_payload.get("error") if inner_payload else None

    if status is not None and status >= 400:
        snippet = (str(err) if err else json.dumps(inner_payload, default=str)[:140] if inner_payload else "")[:140]
        return f"status={status} FAILED — {snippet}"

    # Try to extract a useful summary signal
    if isinstance(inner_payload, dict):
        items = inner_payload.get("items")
        summary = inner_payload.get("summary")
        if isinstance(items, list):
            return f"status={status} ok={ok} items={len(items)}"
        if isinstance(summary, dict):
            return f"status={status} ok={ok} summary_keys={list(summary.keys())[:5]}"
    return f"status={status} ok={ok}"
