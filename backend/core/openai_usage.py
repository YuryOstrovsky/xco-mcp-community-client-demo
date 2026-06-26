# OpenAI usage tracking — JSONL log, price table, and aggregation.
# One record per OpenAI call. Schema is intentionally flat so a quick
# `jq` over the file gives you everything.
#
# Record: {ts, model, prompt_tokens, completion_tokens, source, success}
#
# Reads/writes go through OPENAI_USAGE_LOG_PATH (backend.core.paths) so
# the same Docker volume that holds audit.log also holds usage.jsonl.
# All write paths are best-effort — a logging failure must never propagate
# back to the calling code (cost-tracking is observability, not correctness).

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .paths import OPENAI_USAGE_LOG_PATH

# Prices in USD per 1M tokens. Update this table when OpenAI changes pricing.
# Source of truth: https://openai.com/api/pricing/  (verified 2026-04).
# Keys are matched against the model string from the response (case-insensitive
# substring match — so "gpt-4o-mini-2024-07-18" still maps to "gpt-4o-mini").
OPENAI_PRICING_USD_PER_1M: List[Tuple[str, float, float]] = [
    # (model_substring, input_price, output_price)
    ("gpt-4o-mini",        0.150,  0.600),
    ("gpt-4o",             2.500, 10.000),
    ("gpt-4-turbo",       10.000, 30.000),
    ("gpt-4",             30.000, 60.000),
    ("gpt-3.5-turbo",      0.500,  1.500),
    ("o1-mini",            3.000, 12.000),
    ("o1-preview",        15.000, 60.000),
    ("o1",                15.000, 60.000),
]


def price_for_model(model: str) -> Tuple[float, float]:
    """Return (input_per_1m, output_per_1m) USD prices. Falls back to
    gpt-4o-mini pricing if no match (conservative low estimate)."""
    if isinstance(model, str):
        m = model.lower()
        for sub, p_in, p_out in OPENAI_PRICING_USD_PER_1M:
            if sub in m:
                return p_in, p_out
    return 0.150, 0.600  # gpt-4o-mini default


def log_openai_usage(
    model: str, prompt_tokens: int, completion_tokens: int,
    source: str, success: bool = True,
) -> None:
    """Append one JSONL record describing an OpenAI call. Best-effort —
    a logging failure must never propagate."""
    try:
        rec = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "model": str(model or ""),
            "prompt_tokens": int(prompt_tokens or 0),
            "completion_tokens": int(completion_tokens or 0),
            "source": str(source or "unknown"),
            "success": bool(success),
        }
        Path(OPENAI_USAGE_LOG_PATH).parent.mkdir(parents=True, exist_ok=True)
        with open(OPENAI_USAGE_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, default=str) + "\n")
    except Exception:
        pass


def read_openai_usage_window(window_days: int) -> List[Dict[str, Any]]:
    """Read recent usage records from the JSONL log within the last N days.
    Returns a list of parsed records."""
    if not Path(OPENAI_USAGE_LOG_PATH).exists():
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(days=int(window_days))
    out: List[Dict[str, Any]] = []
    try:
        with open(OPENAI_USAGE_LOG_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts_str = rec.get("ts")
                if not isinstance(ts_str, str):
                    continue
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
                if ts >= cutoff:
                    out.append(rec)
    except Exception:
        return []
    return out


def skill_month_cost_usd(skill_name: str) -> float:
    """Sum USD cost for a single skill in the current calendar month.
    Buckets are keyed on source="agent_skill:<skill_name>" — see
    main.py:_make_skill_openai_chat for the source tagging."""
    if not skill_name:
        return 0.0
    src = f"agent_skill:{skill_name}"
    # Read a generous 45d window to handle month-boundary edge cases —
    # the filter below restricts to the current calendar month.
    records = read_openai_usage_window(45)
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    total = 0.0
    for r in records:
        if r.get("source") != src:
            continue
        ts_str = r.get("ts")
        if not isinstance(ts_str, str):
            continue
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if ts < month_start:
            continue
        p_in_tok = int(r.get("prompt_tokens") or 0)
        p_out_tok = int(r.get("completion_tokens") or 0)
        p_in_per1m, p_out_per1m = price_for_model(r.get("model") or "")
        total += (p_in_tok / 1_000_000) * p_in_per1m + (p_out_tok / 1_000_000) * p_out_per1m
    return round(total, 4)


def aggregate_openai_usage(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Sum tokens, requests, and compute cost from a list of usage records."""
    totals = {"requests": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0}
    by_model: Dict[str, Dict[str, Any]] = {}
    by_source: Dict[str, Dict[str, Any]] = {}
    for r in records:
        model = r.get("model") or "unknown"
        source = r.get("source") or "unknown"
        p_in_tok = int(r.get("prompt_tokens") or 0)
        p_out_tok = int(r.get("completion_tokens") or 0)
        p_in_per1m, p_out_per1m = price_for_model(model)
        cost = (p_in_tok / 1_000_000) * p_in_per1m + (p_out_tok / 1_000_000) * p_out_per1m
        totals["requests"] += 1
        totals["prompt_tokens"] += p_in_tok
        totals["completion_tokens"] += p_out_tok
        totals["cost_usd"] += cost
        for bucket_dict, key in ((by_model, model), (by_source, source)):
            b = bucket_dict.setdefault(key, {"requests": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0})
            b["requests"] += 1
            b["prompt_tokens"] += p_in_tok
            b["completion_tokens"] += p_out_tok
            b["cost_usd"] += cost
    # Round costs to 4 decimals — sub-cent precision, no FP noise
    totals["cost_usd"] = round(totals["cost_usd"], 4)
    for d in (by_model, by_source):
        for v in d.values():
            v["cost_usd"] = round(v["cost_usd"], 4)
    return {"totals": totals, "by_model": by_model, "by_source": by_source}
