"""
NL → list-filter clause extraction and application.

Operators sometimes write "show switches with role Leaf and asn 65000" —
the deterministic NL router picks the right tool, but the list it returns
still needs trimming. This module:

  1. Parses filter clauses out of the user's text (`extract_filter_clauses`).
  2. Walks a sample item to discover its key paths, resolves field
     synonyms, applies the clauses (`resolve_and_apply_filters`).
  3. Recomputes the model-count summary that the inventory widget shows
     after filtering (`recompute_model_counts`).
  4. Heuristic for whether to spend an LLM call extracting filters
     when the regex doesn't match (`_should_attempt_llm_filters`).

The natural_language endpoint runs the LLM extractor first (when enabled)
and falls back to `extract_filter_clauses` from this module — see
main.py's natural_language() handler.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


# ─── Tiny string helpers ───────────────────────────────────────────────

def _pick_str(*vals: Any) -> Optional[str]:
    """Return the first non-empty stripped string in `vals`, else None.
    Used to pick the first present display value (model_display →
    chassis_name → model) from rows with inconsistent shapes."""
    for v in vals:
        if isinstance(v, str):
            s = v.strip()
            if s:
                return s
    return None


def _norm(s: str) -> str:
    """Normalize a field name for tolerant matching: lowercase, alnum-only.
    'fabric.fabric_name' → 'fabricfabricname'."""
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _strip_wrappers(s: str) -> str:
    """Remove leading NL wrappers like 'show switches', 'filter by', 'where', 'with'."""
    s = (s or "").strip()

    # Remove common lead-in command phrasing to get closer to "field op value":
    #   "show switches where name contains Leaf" -> "name contains Leaf"
    #   "show me switch with asn 65000"          -> "asn 65000"
    s = re.sub(
        r"^(?:show|list|get|display|find)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:switch(?:es)?|device(?:s)?|nodes?|ports?|sessions?|users?|alarms?)\b\s*",
        "",
        s,
        flags=re.I,
    ).strip()

    # Remove optional filler words
    s = re.sub(r"^(?:that\s+)?(?:are\s+)?", "", s, flags=re.I).strip()

    # Remove wrapper keywords
    s = re.sub(r"^(?:filter\s+by|where|with|having)\s+", "", s, flags=re.I).strip()
    return s


def _split_clauses(text: str) -> List[str]:
    """Split on AND / commas / semicolons, but keep quoted strings intact."""
    t = (text or "").strip()
    if not t:
        return []
    out: List[str] = []
    buf: List[str] = []
    in_quote: Optional[str] = None
    i = 0
    while i < len(t):
        ch = t[i]
        if ch in ('"', "'"):
            if in_quote is None:
                in_quote = ch
            elif in_quote == ch:
                in_quote = None
            buf.append(ch)
            i += 1
            continue

        if in_quote is None:
            # split on commas / semicolons
            if ch in (",", ";"):
                part = "".join(buf).strip()
                if part:
                    out.append(part)
                buf = []
                i += 1
                continue

            # split on " and " (word boundary)
            if t[i : i + 5].lower() == " and ":
                part = "".join(buf).strip()
                if part:
                    out.append(part)
                buf = []
                i += 5
                continue

        buf.append(ch)
        i += 1

    part = "".join(buf).strip()
    if part:
        out.append(part)
    return out


def _flatten_keypaths(d: Any, prefix: str = "", out: Optional[Dict[str, str]] = None, depth: int = 0, max_depth: int = 2) -> Dict[str, str]:
    """Build a map: normalized_key -> keypath (e.g. 'fabricname' -> 'fabric.fabric_name')."""
    if out is None:
        out = {}
    if not isinstance(d, dict) or depth > max_depth:
        return out

    for k, v in d.items():
        if not isinstance(k, str):
            continue
        path = f"{prefix}.{k}" if prefix else k
        out[_norm(k)] = path
        out[_norm(path)] = path  # allow matching explicit keypaths
        if isinstance(v, dict):
            _flatten_keypaths(v, path, out, depth + 1, max_depth=max_depth)
    return out


def _get_by_path(obj: Any, path: str) -> Any:
    cur = obj
    for part in (path or "").split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _maybe_cast(v: str) -> Any:
    """Cast a parsed clause value: strip quotes, then int → float → str."""
    s = (v or "").strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        s = s[1:-1].strip()

    if re.fullmatch(r"-?\d+", s):
        try:
            return int(s)
        except Exception:
            return s
    if re.fullmatch(r"-?\d+\.\d+", s):
        try:
            return float(s)
        except Exception:
            return s
    return s


def _parse_op(op_raw: Optional[str]) -> str:
    """Normalize comparison operators to a stable lowercase form."""
    if not op_raw:
        return "eq"
    o = op_raw.strip().lower()
    o = re.sub(r"\s+", " ", o)

    mapping = {
        "=": "eq",
        "==": "eq",
        "is": "eq",
        ":": "eq",
        "!=": "ne",
        "<>": "ne",
        ">": "gt",
        "<": "lt",
        ">=": "gte",
        "<=": "lte",
        "contains": "contains",
        "not contains": "not_contains",
        "starts_with": "starts_with",
        "ends_with": "ends_with",
    }
    return mapping.get(o, o)


# Common fields we will accept for simple 'field value' pairs without explicit 'filter by'.
KNOWN_FIELDS = {
    "asn", "role", "name", "ip", "ip_address", "management_ip", "mgmt_ip",
    "model", "model_display", "chassis_name", "device_type", "fabric_name",
    "firmware", "location", "type", "discovery_status", "id", "mac_address",
}


# ─── Public API: parse clauses, apply, recompute counts ────────────────

def extract_filter_clauses(user_text: str) -> List[Dict[str, Any]]:
    """
    Returns clauses like:
      [{"field":"asn","op":"eq","value":65000}, {"field":"role","op":"eq","value":"Leaf"}]

    Supported:
      - asn 65000
      - asn > 65000, asn>=65000, asn != 65000
      - filter by name contains Leaf
      - where chassis_name contains 8520
      - asn 65000 and role Leaf
    """
    t = (user_text or "").strip()
    if not t:
        return []

    # ----------------------------------------------------------------
    # Early-exit: broad listing queries have no filter intent.
    # Patterns like "show ip addresses of all switches", "list all devices",
    # "show switches", "get all IPs" should return zero filter clauses so
    # the full inventory is displayed rather than being wiped to 0 results.
    # ----------------------------------------------------------------
    _BROAD_LISTING_RE = re.compile(
        r"^(?:show|list|get|display|find|what\s+are)\s+"
        r"(?:me\s+)?(?:all\s+|the\s+)?(?:the\s+)?"
        r"(?:ip\s+address(?:es)?|mac\s+address(?:es)?|switch(?:es)?|device(?:s)?|"
        r"inventory|nodes?|hosts?|all\s+switch(?:es)?|all\s+device(?:s)?)"
        r"(?:\s+of\s+(?:all\s+)?(?:switch(?:es)?|device(?:s)?|nodes?))?$",
        re.I,
    )
    if _BROAD_LISTING_RE.match(t):
        return []

    # Also bail out when the query is a plain broad fetch with no operator/value hint:
    # e.g. "show me the ip addresses of all switches" – contains "ip address" but no
    # actual IP literal, no operator, and no value token that looks like a filter.
    _HAS_FILTER_SIGNAL_RE = re.compile(
        r"(?:"
        r">=|<=|!=|=|>|<|"                                      # comparison operators
        r"\b(?:filter|where|having|contains|starts_with|ends_with|equals?|is\s+not|not\s+contains)\b|"
        r"\b\d{1,3}(?:\.\d{1,3}){3}\b|"                        # actual IP literal
        r"\bwith\s+(?:asn|role|name|model|firmware|fabric)\b"   # "with <known field>"
        r")",
        re.I,
    )
    # If the text mentions "ip address" but has zero filter signals, skip extraction entirely.
    if re.search(r"\bip\s+address(?:es)?\b", t, re.I) and not _HAS_FILTER_SIGNAL_RE.search(t):
        return []

    clauses: List[Dict[str, Any]] = []

    # Split into segments on AND/comma/semicolon (respecting quotes)
    segments = _split_clauses(t)

    for seg in segments:
        s = _strip_wrappers(seg)

        # special: ASN (supports operators)
        m = re.search(r"\basn\s*(>=|<=|!=|=|>|<|is|:)?\s*(\d{1,10})\b", s, re.I)
        if m:
            clauses.append({"field": "asn", "op": _parse_op(m.group(1)), "value": _maybe_cast(m.group(2))})
            continue

        # special: IP-ish — only match when there is an actual dotted-quad IP literal OR
        # an explicit comparison operator.  This prevents "ip addresses of all switches"
        # from being parsed as  ip_address == "addresess".
        m = re.search(
            r'\b(?:ip|ip_address|management\s*ip|mgmt\s*ip)'
            r'\s*(>=|<=|!=|=|>|<|is|:|contains|not\s+contains|starts_with|ends_with)\s*'
            r'(\d{1,3}(?:\.\d{1,3}){3}|"[^"]+"|[^\s,;]+)'
            r'|'
            r'\b(?:ip|ip_address|management\s*ip|mgmt\s*ip)'
            r'\s+(\d{1,3}(?:\.\d{1,3}){3})\b',  # bare IP literal only (no operator noise)
            s, re.I,
        )
        if m:
            if m.group(1) is not None:
                # operator form
                clauses.append({"field": "ip_address", "op": _parse_op(m.group(1)), "value": _maybe_cast(m.group(2))})
            else:
                # bare dotted-quad form
                clauses.append({"field": "ip_address", "op": "eq", "value": _maybe_cast(m.group(3))})
            continue

        # generic: field op value  (handles contains / not contains / starts_with / ends_with / comparisons)
        m = re.match(
            r'^(?P<field>[a-zA-Z0-9_.\-]+)\s*(?:(?P<op>contains|not\s+contains|starts_with|ends_with)\s+|(?P<cmp>>=|<=|!=|=|>|<|is|:)\s*)?(?P<value>"[^"]+"|.+?)\s*$',
            s,
            re.I,
        )
        if m:
            field = (m.group("field") or "").strip()
            op = _parse_op(m.group("op") or m.group("cmp"))
            value_raw = (m.group("value") or "").strip()
            val = _maybe_cast(value_raw)

            # Reject values that are clearly phrase fragments, not filter values.
            # e.g. "show name and model of switches" -> field=model, value="of switches" → bogus
            _bogus = False
            vl = value_raw.strip().lower()
            if re.match(r"^of\b", vl):  # "of switches", "of all devices", "of my ..."
                _bogus = True
            elif vl in {"switches", "devices", "nodes", "all", "my", "the", "every", "each", "me",
                        "version", "addresses"}:
                _bogus = True

            # Avoid false positives like 'show' 'switches' etc: only accept simple pairs when field is known-ish
            if not _bogus and field and (_norm(field) in {_norm(x) for x in KNOWN_FIELDS} or op != "eq"):
                clauses.append({"field": field, "op": op, "value": val})
                continue

        # If we get here, ignore this segment (no clause parsed)

    # De-dupe
    seen = set()
    uniq: List[Dict[str, Any]] = []
    for c in clauses:
        key = (_norm(str(c.get("field"))), str(c.get("op")), str(c.get("value")))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    return uniq


def resolve_and_apply_filters(items: List[Dict[str, Any]], clauses: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Resolve clause.field to actual keypaths and filter items."""
    if not items or not clauses:
        return items, []

    keymap = _flatten_keypaths(items[0])

    synonyms = {
        "fabric": ["fabric_name", "fabric.fabric_name"],
        "fabricname": ["fabric_name", "fabric.fabric_name"],
        "model": ["model_display", "chassis_name", "model"],
        "hostname": ["name"],
        "switch": ["name"],
        "ip": ["ip_address"],
        "mgmtip": ["ip_address"],
    }

    resolved: List[Dict[str, Any]] = []
    for c in clauses:
        raw_field = str(c.get("field") or "").strip()
        if not raw_field:
            continue
        nf = _norm(raw_field)

        path = None
        if nf in keymap:
            path = keymap[nf]
        else:
            for s in synonyms.get(nf, []):
                ns = _norm(s)
                if ns in keymap:
                    path = keymap[ns]
                    break

        if path is None and "." in raw_field:
            path = raw_field.strip()

        # fuzzy fallback
        if path is None:
            candidates = []
            for nk, p in keymap.items():
                if nf == nk:
                    candidates.append((0, len(nk), p))
                elif nf in nk:
                    candidates.append((1, len(nk), p))
                elif nk in nf:
                    candidates.append((2, len(nk), p))
            if candidates:
                candidates.sort()
                path = candidates[0][2]

        if path:
            resolved.append({
                "field": raw_field,
                "path": path,
                "op": (c.get("op") or "eq"),
                "value": c.get("value"),
            })

    if not resolved:
        return items, []

    def _to_number(x: Any) -> Optional[float]:
        if isinstance(x, (int, float)):
            return float(x)
        try:
            xs = str(x).strip()
            if re.fullmatch(r"-?\d+(?:\.\d+)?", xs):
                return float(xs)
        except Exception:
            return None
        return None

    def _match(item: Dict[str, Any], clause: Dict[str, Any]) -> bool:
        v = _get_by_path(item, clause["path"])
        want = clause.get("value")
        op = (clause.get("op") or "eq").lower()

        # String ops
        if op in ("contains", "not_contains", "starts_with", "ends_with"):
            vs = "" if v is None else str(v)
            ws = "" if want is None else str(want)
            vs_l = vs.strip().lower()
            ws_l = ws.strip().lower()

            if op == "contains":
                return ws_l in vs_l
            if op == "not_contains":
                return ws_l not in vs_l
            if op == "starts_with":
                return vs_l.startswith(ws_l)
            if op == "ends_with":
                return vs_l.endswith(ws_l)

        # Numeric comparisons
        if op in ("gt", "gte", "lt", "lte"):
            vn = _to_number(v)
            wn = _to_number(want)
            if vn is None or wn is None:
                return False
            if op == "gt":
                return vn > wn
            if op == "gte":
                return vn >= wn
            if op == "lt":
                return vn < wn
            if op == "lte":
                return vn <= wn

        # Equality / inequality
        if op in ("eq", "ne"):
            # try numeric eq/ne
            vn = _to_number(v)
            wn = _to_number(want)
            if vn is not None and wn is not None:
                ok = (vn == wn)
                return ok if op == "eq" else (not ok)

            # string eq/ne (case-insensitive)
            vs = "" if v is None else str(v).strip().lower()
            ws = "" if want is None else str(want).strip().lower()
            ok = (vs == ws)
            return ok if op == "eq" else (not ok)

        # Unknown op -> fall back to eq
        vs = "" if v is None else str(v).strip().lower()
        ws = "" if want is None else str(want).strip().lower()
        return vs == ws

    filtered = [it for it in items if all(_match(it, c) for c in resolved)]
    return filtered, resolved


def recompute_model_counts(items: List[Dict[str, Any]]) -> List[Tuple[str, int]]:
    """After filtering, recompute the per-model SKU counts the inventory
    widget shows. Used to keep the summary in sync after the filter trims
    items in the response payload."""
    counts: Dict[str, int] = {}
    for it in items:
        sku = _pick_str(it.get("model_display"), it.get("chassis_name"), it.get("model")) or "Unknown"
        counts[sku] = counts.get(sku, 0) + 1
    return sorted(counts.items(), key=lambda kv: kv[1], reverse=True)


# ─── LLM-extractor heuristic ──────────────────────────────────────────

def _should_attempt_llm_filters(user_text: str) -> bool:
    """Return True when the user text contains signals that a list filter
    is being requested — used by the /api/nl endpoint to decide whether
    to spend an LLM round-trip on filter extraction.

    The check is intentionally narrow: we don't want to burn LLM calls on
    queries that are clearly column-selection ("with their IP, role, and
    firmware version") or broad listings."""
    t = (user_text or "").lower()
    if not t:
        return False
    # Explicit filter keywords — but NOT bare "with": "with their IP, role, and firmware version"
    # is column selection, not a filter predicate.
    if re.search(r"\b(filter|where|having|contains|starts_with|ends_with|not\s+contains)\b", t):
        return True
    if re.search(r"(>=|<=|!=|\bgt\b|\bgte\b|\blt\b|\blte\b|\bgreater\b|\bless\b|\bmore\b|\bunder\b)", t):
        return True
    # Field name + operator/value: "role=leaf", "firmware 5.0", "asn 65001"
    # Does NOT trigger on "their IP, role, and firmware version" (no value follows).
    if re.search(
        r"\b(asn|role|chassis_name|fabric_name|ip_address|mac_address|firmware|model)"
        r"\s*(?:=|!=|>|<|>=|<=|is\b|contains|starts_with|ends_with|\s+\d|\s+['\"])",
        t,
    ):
        return True
    # "with <field> <value>" pattern — explicit filter: "with role leaf", "with asn 65001"
    if re.search(
        r"\bwith\s+(?:asn|role|chassis_name|fabric_name|ip_address|mac_address|firmware|model)\s+\S",
        t,
    ):
        return True
    return False
