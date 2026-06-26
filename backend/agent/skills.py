"""Skill loader — parses ./agent_skills/*.md frontmatter into the dicts the
agent loop consumes. Pure stdlib (no PyYAML); cached per skill.

Public surface:
  load_skill(name) → dict
  list_skills() → list[dict]
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── Skill loader ──────────────────────────────────────────────────────────────
# Skill files live at backend/agent_skills/ — SIBLING of the agent/
# package, not a child. Anchor on parent.parent so this path stays correct.
_SKILLS_DIR = Path(__file__).resolve().parent.parent / "agent_skills"


def _parse_frontmatter(text: str) -> Tuple[Dict[str, Any], str]:
    """Tiny YAML-frontmatter parser. We don't pull in PyYAML — the schema we
    actually use is small enough to hand-roll: scalars, lists of strings,
    and one level of nested key:value mappings (for `tool_hints`)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    meta: Dict[str, Any] = {}
    current_list_key: Optional[str] = None
    current_map_key: Optional[str] = None
    for line in raw.splitlines():
        if not line.strip():
            continue
        # List item under the most recent empty-value key
        if line.startswith("  - "):
            if current_list_key:
                # If we initialized the key as {} (because we couldn't tell
                # list-vs-map yet), upgrade to [] now.
                if not isinstance(meta.get(current_list_key), list):
                    meta[current_list_key] = []
                meta[current_list_key].append(line[4:].strip())
                current_map_key = None  # this key is a list, not a map
            continue
        # Indented `key: value` under a parent map (one nesting level)
        if line.startswith("  ") and ":" in line and current_map_key:
            sub_key, _, sub_val = line.strip().partition(":")
            sub_val = sub_val.strip().strip('"').strip("'")
            if sub_val:
                meta[current_map_key][sub_key.strip()] = sub_val
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if not val:
            # An empty-value top-level key starts EITHER a list or a map; we
            # don't know yet. Track it and decide on the next indented line.
            current_list_key = key
            current_map_key = key
            meta[key] = {}  # default to map; gets reassigned to list on first `  - `
            continue
        # Scalar value
        current_list_key = None
        current_map_key = None
        if val.lower() in ("true", "false"):
            meta[key] = val.lower() == "true"
        else:
            meta[key] = val.strip('"').strip("'")
    # Post-pass: any "key: {}" that received list items got rewritten to []
    # by the `  - ` branch via setdefault. If the user intended a map but
    # didn't add any entries, leave the {} — that's harmless.
    return meta, body


_SKILL_CACHE: Dict[str, Dict[str, Any]] = {}


def load_skill(name: str) -> Dict[str, Any]:
    """Load a skill by name. Cached after first read."""
    if name in _SKILL_CACHE:
        return _SKILL_CACHE[name]
    # accept either 'fabric-health-investigation' or 'fabric_health_investigation'
    candidates = [
        _SKILLS_DIR / f"{name.replace('-', '_')}.md",
        _SKILLS_DIR / f"{name}.md",
    ]
    path = next((p for p in candidates if p.exists()), None)
    if path is None:
        raise FileNotFoundError(f"Skill not found: {name}")
    text = path.read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(text)
    skill = {
        "name": meta.get("name", name),
        "description": meta.get("description", ""),
        "read_only": bool(meta.get("read_only", True)),
        "proposal_capable": bool(meta.get("proposal_capable", False)),
        "allowed_tools": list(meta.get("allowed_tools", [])),
        "tool_hints": meta.get("tool_hints") if isinstance(meta.get("tool_hints"), dict) else {},
        "body": body.strip(),
    }
    _SKILL_CACHE[name] = skill
    return skill


def list_skills() -> List[Dict[str, Any]]:
    """Return metadata for every skill in agent_skills/. Used by /api/agent/skills."""
    out: List[Dict[str, Any]] = []
    if not _SKILLS_DIR.exists():
        return out
    for p in sorted(_SKILLS_DIR.glob("*.md")):
        try:
            text = p.read_text(encoding="utf-8")
            meta, _ = _parse_frontmatter(text)
            out.append({
                "name": meta.get("name", p.stem),
                "description": meta.get("description", ""),
                "read_only": bool(meta.get("read_only", True)),
                "proposal_capable": bool(meta.get("proposal_capable", False)),
                "allowed_tools": list(meta.get("allowed_tools", [])),
                "trigger_keywords": list(meta.get("trigger_keywords", [])),
            })
        except Exception:
            continue
    return out


