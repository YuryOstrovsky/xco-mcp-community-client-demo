"""
NL → tool input extraction.

For each tool that takes a named entity (fabric_name, tenant_name,
switch_ip, etc.), pull the value out of the user's text. Two layers:

  - `_extract_after_keyword(text, "fabric")` — generic "<keyword> NAME"
    extractor that handles quoted names, trims trailing intent words,
    and rejects obvious non-names.
  - `extract_inputs(text, tool)` — per-tool dispatch that calls the
    extractor with the right keyword, then maps to the tool's input
    schema. The fabric-health-timeline branch is the richest: it tries
    three target-resolution strategies and a four-shape time-window
    parser ('last 24h', 'past week', '48h', 'in the last 7 days').

Both `pick_tool_deterministic` (in main.py) and the NL endpoint's LLM
branch call into this module to enrich tool inputs after picking the
tool. RESTCONF_TOOLS is re-imported from nl.deterministic so we don't
duplicate the set.

Extracted from backend/main.py in task #95.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from .deterministic import RESTCONF_TOOLS


def _clean_name(s: str) -> str:
    """Strip surrounding quotes, collapse whitespace, drop trailing color
    + intent words. Used after a keyword-anchored extractor pulled the
    likely entity name out of NL text."""
    s = (s or "").strip()
    s = re.sub(r"^[\"'“”‘’]+|[\"'“”‘’]+$", "", s)
    s = re.sub(r"\s+", " ", s).strip()

    # Drop common trailing intent words and color tokens that sometimes appear after names
    # e.g. "DC red" -> "DC", "my fabric doing" -> "my fabric" (later rejected)
    tail_drop = {"red", "yellow", "green", "unknown", "health", "status", "overview", "summary", "details", "detail", "info", "doing"}
    parts = s.split()
    while parts and parts[-1].lower() in tail_drop:
        parts = parts[:-1]
    s = " ".join(parts).strip()
    return s


def _extract_after_keyword(text: str, keyword: str) -> Optional[str]:
    """Extract a (possibly multi-word) entity name after a keyword.

    Handles quoted names and trims common trailing intent words.

    Examples:
      tenant "Red Zone" details -> Red Zone
      fabric DC health -> DC
    """
    t = (text or "").strip()

    # Prefer quoted values: tenant "Red Zone"
    qm = re.search(rf"\b{re.escape(keyword)}\b\s+[\"'“”]([^\"'“”]+)[\"'“”]", t, re.I)
    if qm:
        name = _clean_name(qm.group(1))
        return name or None

    m = re.search(rf"\b{re.escape(keyword)}\b\s+(.+)", t, re.I)
    if not m:
        return None
    tail = (m.group(1) or "").strip()

    # Cut off at punctuation / clause separators early
    tail = re.split(r"[\?\.!,:;]", tail, maxsplit=1)[0].strip()

    # Cut off at common clause words
    tail = re.split(
        r"\b(show|why|and|with|top|offenders?|details?|detail|info|summary|health|status|please|now|explain|doing)\b",
        tail,
        maxsplit=1,
        flags=re.I,
    )[0].strip()

    tail = _clean_name(tail)

    # If tail still ends with a color word (e.g. "DC red"), drop it.
    tail_parts = tail.split()
    if len(tail_parts) >= 2 and tail_parts[-1].lower() in {"red", "yellow", "green", "unknown"}:
        tail = " ".join(tail_parts[:-1]).strip()

    # Reject obvious non-names
    blacklist = {
        "doing", "do", "status", "health", "details", "detail", "info", "summary",
        "top", "offender", "offenders", "red", "yellow", "green", "unknown",
        # Time-voyager-adjacent words that follow "fabric" in NL prompts but
        # aren't fabric names ("show fabric history", "fabric timeline...")
        "history", "timeline", "events", "activity", "changes", "audit", "overview",
    }
    if not tail:
        return None
    if tail.lower() in blacklist:
        return None
    if len(tail) > 48:
        return None
    return tail


def extract_inputs(text: str, tool: str) -> Dict[str, Any]:
    """For each tool the deterministic router can pick, walk the NL text
    and extract the tool's typed inputs (fabric_name, tenant_name,
    switch_ip, time window, …). Returns an empty dict for tools that
    don't need NL-extracted inputs."""
    inputs: Dict[str, Any] = {}

    # Fabric-scoped tools
    if tool in ("fabric_get_fabric_health_summary", "fabric_get_fabric_health", "fabric_get_fabric_overview"):
        name = _extract_after_keyword(text, "fabric")
        if name:
            inputs["fabric_name"] = name

    # Timeline tool — fabric name + optional time window. The tool's input
    # field is `name` (not `fabric_name`). For prompts like "what happened
    # to lab-b-alex in the last 24h?", we try multiple extraction strategies.
    if tool == "fabric_get_fabric_health_timeline":
        # Strategy 1: explicit "fabric <name>"
        name = _extract_after_keyword(text or "", "fabric")
        # Strategy 2: dash-containing token after a preposition. Fabric names
        # in this product almost always contain a dash (lab-b-alex, dc-east),
        # making them easy to disambiguate from natural-language words.
        if not name:
            m = re.search(
                r"\b(?:to|on|with|for|of|in)\s+([a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\b",
                text or "", re.I,
            )
            if m and "-" in m.group(1):
                name = m.group(1)
        # Strategy 3: any dash-containing token in the prompt — fallback.
        if not name:
            for tok in re.findall(r"\b([a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\b", text or ""):
                if "-" in tok and len(tok) >= 3 and tok.lower() not in {
                    "what-happened", "in-the", "the-last", "last-24h", "what-changed"
                }:
                    name = tok
                    break
        if name:
            inputs["name"] = name
        # Time window — pull "last/past N hour|day|week|month" or singular
        # "last hour/day/week/month". Default (none set) lets the tool pick.
        win_m = re.search(
            r"\b(?:last|past|previous)\s+(\d+)\s*(hour|hr|day|d|week|wk|month|mo)s?\b",
            text or "", re.I,
        )
        if win_m:
            n = int(win_m.group(1))
            unit = win_m.group(2).lower()[0]
            hours = {"h": n, "d": n * 24, "w": n * 168, "m": n * 720}.get(unit)
            if hours:
                inputs["window_hours"] = hours
        else:
            # Singular form ("last hour", "past week") — n implied = 1
            sing_m = re.search(
                r"\b(?:last|past|previous)\s+(hour|day|week|month)\b",
                text or "", re.I,
            )
            if sing_m:
                unit = sing_m.group(1).lower()
                hours = {"hour": 1, "day": 24, "week": 168, "month": 720}.get(unit)
                if hours:
                    inputs["window_hours"] = hours
        # Catch "24h" / "48h" shorthand without "last/past" prefix
        if "window_hours" not in inputs:
            short_m = re.search(r"\b(\d+)\s*h(?:ours?)?\b", text or "", re.I)
            if short_m:
                inputs["window_hours"] = int(short_m.group(1))

    # Tenant-scoped tools
    if tool in ("tenant_get_tenant", "tenant_get_service_epg_alarm_summary", "tenant_get_service_epg_event_logs"):
        name = _extract_after_keyword(text, "tenant")
        if name:
            inputs["tenant_name"] = name

    # RESTCONF tools — extract switch_ip from IP address in text (covers all tools)
    if tool in RESTCONF_TOOLS:
        ip_match = re.search(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b", text or "")
        if ip_match:
            inputs["switch_ip"] = ip_match.group(1)

    return inputs
