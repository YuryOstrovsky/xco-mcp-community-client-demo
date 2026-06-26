# NL package — natural-language tool routing.
#
# Houses the LLM-pick tier (llm_pick.py). The other two pieces of the NL
# stack are still inline in main.py:
#
#   - Deterministic regex routing: `pick_tool_deterministic` +
#     `extract_inputs`. Shared with the example-running endpoints.
#   - The /api/nl endpoint dispatch itself: `natural_language`.
#     Glue logic that ties the three tiers together.

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
