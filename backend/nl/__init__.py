# NL package — natural-language tool routing.
#
# Currently houses the LLM-pick tier (llm_pick.py) extracted from
# main.py in task #88. The other two pieces of the NL stack remain
# inline in main.py for now (extraction deferred per README's
# "reference-design loose ends"):
#
#   - Deterministic regex routing: `pick_tool_deterministic` +
#     `extract_inputs` (main.py:~1090). Shared with the example-
#     running endpoints; moving it would touch unrelated routes.
#   - The /api/nl endpoint dispatch itself: `natural_language`
#     (main.py:~2200). Glue logic that ties the three tiers together.
#
# Public re-exports for back-compat with the historical main.py
# import paths (no migration needed for existing callers).

from .llm_pick import (  # noqa: F401
    OLLAMA_ENABLED,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    score_tool,
    tokenize,
    top_tool_candidates,
    llm_select_tool_ollama,
    llm_explain_ollama,
    llm_select_tool_openai,
    llm_explain_openai,
)
