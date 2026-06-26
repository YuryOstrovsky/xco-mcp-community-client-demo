"""Agent package — read-only investigation skills via OpenAI tool-use.

Public surface:

  run_investigation  — the bounded agent loop (loop.py)
  list_skills        — skill registry (skills.py)
  load_skill         — one skill by name (skills.py)
  extract_proposal   — normalize a ```proposal``` block (proposal.py)
  MAX_TURNS, MAX_TOOL_CALLS, LLM_TIMEOUT_S — agent bounds (loop.py)

Package layout:

  loop.py       — run_investigation (orchestration only) + tool spec
                  derivation + bounded helper
  skills.py     — skill loader + frontmatter parser
  proposal.py   — extract_proposal + normalization
  verdict.py    — post-synthesis checklist parsing + mismatch detection
  filters.py    — alarm filter + BGP normalizer + storage verdict
                  injector + preprocessor registry + display helpers
  resolvers.py  — pre-loop hooks (target discovery, MCT-partner,
                  RESTCONF reachability probes, fingerprint comparison)
"""

from .loop import (  # noqa: F401
    run_investigation,
    MAX_TURNS,
    MAX_TOOL_CALLS,
    TOOL_CALL_TIMEOUT_S,
    LLM_TIMEOUT_S,
)
from .skills import (  # noqa: F401
    load_skill,
    list_skills,
)
from .proposal import (  # noqa: F401
    extract_proposal,
)
from .verdict import (  # noqa: F401
    _detect_verdict_mismatches,
    _extract_synthesis_check_verdicts,
    _compute_overall_verdict_from_checklist,
)
from .filters import (  # noqa: F401
    _filter_resolved_alarms,
    _normalize_bgp_summary,
    _TOOL_RESULT_PREPROCESSORS,
    _shrink_for_model,
    _summary_preview,
)
from .resolvers import (  # noqa: F401
    _PRE_LOOP_HOOKS,
    _resolve_target_for_post_upgrade,
    _resolve_for_pre_upgrade_check,
    _resolve_for_pre_rma_check,
)
