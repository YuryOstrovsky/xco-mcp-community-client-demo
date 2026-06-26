# LLM-pick helpers — the Smart / OpenAI / Ollama tier of the NL tool
# router. Used by /api/nl when the deterministic regex tier (in main.py)
# missed.
#
# Two pairs of functions per LLM provider:
#   llm_select_tool_<provider> — pick the best tool + inputs
#   llm_explain_<provider>     — narrate the tool result for the operator
#
# Plus the candidate-ranker: top_tool_candidates() narrows the catalog
# (currently 320 tools) down to ~25 before handing it to the model, so
# the prompt size stays bounded.
#
# Extracted from main.py (was inline 1279-1499) per task #88.
# OLLAMA_* config is read from env at module-import time — same
# behavior as the previous main-module globals.

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List

import httpx

# Ollama config — read at import time (same as the pre-extraction main.py).
OLLAMA_ENABLED = (os.getenv("OLLAMA_ENABLED", "0") or "0").strip().lower() in ("1", "true", "yes", "on")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")

from core.llm import openai_chat as _openai_chat

# tokenize() — duplicated from main rather than imported upward. Tiny
# (a single _token_re.findall). The cost of duplication is one
# regex; the savings is "no nl/* → main upward import."
_token_re = re.compile(r"[a-z0-9_\-]+")


def tokenize(s: str) -> List[str]:
    return _token_re.findall((s or "").lower())


def score_tool(text: str, tool: Dict[str, Any]) -> int:
    hay = " ".join(
        [
            str(tool.get("name", "")),
            str(tool.get("description", "")),
            " ".join(tool.get("tags", []) or []),
            " ".join((tool.get("capabilities", {}) or {}).get("actions", []) or []),
            " ".join((tool.get("capabilities", {}) or {}).get("objects", []) or []),
        ]
    ).lower()
    toks = tokenize(text)
    score = 0
    for t in toks:
        if len(t) < 2:
            continue
        if t in hay:
            score += 3
        if str(tool.get("name", "")).lower().startswith(t):
            score += 2
    if "tier2" in (tool.get("tags") or []):
        score += 1
    return score


def top_tool_candidates(text: str, tools: List[Dict[str, Any]], k: int = 25) -> List[Dict[str, Any]]:
    scored = [(score_tool(text, t), t) for t in tools]
    scored.sort(key=lambda x: x[0], reverse=True)
    keep = [t for s, t in scored if s > 0][:k]
    if not keep:
        keep = [t for _, t in scored[: min(k, len(scored))]]
    return keep


def _tool_signature(t: Dict[str, Any]) -> Dict[str, Any]:
    schema = t.get("input_schema") or {}
    props = (schema.get("properties") or {}) if isinstance(schema, dict) else {}
    required = (schema.get("required") or []) if isinstance(schema, dict) else []
    return {
        "name": str(t.get("name", "")),
        "description": str(t.get("description", "")),
        "inputs": {"required": required, "properties": list(props.keys())[:25]},
    }


async def llm_select_tool_ollama(user_text: str, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Return {tool, inputs, explanation, confidence}. Never raises; returns {error:...} on failure.

    Uses Ollama /api/generate (non-streaming) and asks the model to emit JSON in the first line.
    """
    if not OLLAMA_ENABLED:
        return {"error": "ollama_disabled"}

    timeout_s = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "45"))
    max_tokens = int(os.getenv("OLLAMA_MAX_TOKENS_SELECT", "128"))

    # Keep candidate list short + compact to reduce latency
    cand_sig = [{"name": t.get("name"), "description": (t.get("description") or "")[:140], "inputs": t.get("input_schema", {}).get("properties", {})} for t in candidates]
    prompt = (
        "You are a router for a read-only MCP client demo.\n"
        "Task: choose exactly ONE best tool from the candidate list and minimal JSON inputs.\n"
        "Rules: do NOT invent tools. If unsure, prefer safer high-level diagnostic tools (tier2).\n"
        "Output: ONLY valid JSON on a single line: "
        "{\"tool\":\"...\",\"inputs\":{...},\"explanation\":\"...\",\"confidence\":0.0}\n\n"
        f"USER_REQUEST: {user_text}\n\n"
        f"CANDIDATES: {json.dumps(cand_sig, ensure_ascii=False)}\n"
    )

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_ctx": 2048,
            "num_predict": max_tokens,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        if r.status_code >= 400:
            return {"error": "ollama_http", "status": r.status_code, "body": r.text[:400]}
        data = r.json() if r.content else {}
        content = (data.get("response") or "").strip()
        # Grab the first JSON object in the response
        jm = re.search(r"\{.*\}", content, re.S)
        if not jm:
            return {"error": "ollama_bad_json", "body": content[:400]}
        parsed = json.loads(jm.group(0))
        if not isinstance(parsed, dict):
            return {"error": "ollama_bad_json"}
        tool = parsed.get("tool")
        if not isinstance(tool, str) or not tool:
            return {"error": "ollama_no_tool", "body": content[:200]}
        inputs = parsed.get("inputs") if isinstance(parsed.get("inputs"), dict) else {}
        explanation = parsed.get("explanation") if isinstance(parsed.get("explanation"), str) else ""
        confidence = parsed.get("confidence")
        if not isinstance(confidence, (int, float)):
            confidence = 0.5
        return {"tool": tool, "inputs": inputs, "explanation": explanation, "confidence": float(confidence)}
    except Exception as e:
        return {"error": "ollama_exception", "message": str(e)[:200], "type": type(e).__name__, "repr": repr(e)[:400]}


async def llm_explain_ollama(user_text: str, tool: str, inputs: Dict[str, Any], tool_result: Any) -> Dict[str, Any]:
    """Generate a short operator-friendly explanation text. Never raises."""
    if not OLLAMA_ENABLED:
        return {"error": "ollama_disabled"}

    timeout_s = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "45"))
    max_tokens = int(os.getenv("OLLAMA_MAX_TOKENS_EXPLAIN", "128"))

    # Keep result payload small-ish to avoid huge prompts
    compact_result = tool_result
    try:
        blob = json.dumps(tool_result, ensure_ascii=False)
        if len(blob) > 6000:
            compact_result = {"note": "result_truncated", "head": blob[:int(os.getenv("OLLAMA_MAX_CONTEXT_CHARS", "2500"))]}
    except Exception:
        pass

    prompt = (
        "You are an expert network operations assistant helping someone interpret an MCP tool result.\n"
        "Write a demo-friendly explanation that a non-expert can follow.\n"
        "Format exactly as:\n"
        "- **Diagnosis:** <one sentence>\n"
        "- **Evidence:** <1-3 short bullets referencing numbers/fields>\n"
        "- **What to do next:** <3 numbered steps, each starting with a verb>\n"
        "Keep it concise. Avoid jargon. If you mention a tool, wrap it in backticks.\n\n"
        f"QUESTION: {user_text}\n"
        f"TOOL: {tool}\n"
        f"INPUTS: {json.dumps(inputs or {}, ensure_ascii=False)}\n"
        f"RESULT: {json.dumps(compact_result, ensure_ascii=False)}\n\n"
        "OUTPUT (plain text, bullets):\n"
    )

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "2048")),
            "num_predict": max_tokens,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        if r.status_code >= 400:
            return {"error": "ollama_http", "status": r.status_code, "body": r.text[:400]}
        data = r.json() if r.content else {}
        txt = (data.get("response") or "").strip()
        if not txt:
            return {"error": "ollama_empty"}
        return {"text": txt}
    except Exception as e:
        return {"error": "ollama_exception", "message": str(e)[:200], "type": type(e).__name__, "repr": repr(e)[:400]}


async def llm_select_tool_openai(user_text: str, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Use OpenAI to pick the best tool. Returns {tool, inputs, explanation, confidence}."""
    cand_sig = [{"name": t.get("name"), "description": (t.get("description") or "")[:200], "inputs": t.get("input_schema", {}).get("properties", {})} for t in candidates]
    messages = [
        {"role": "system", "content": (
            "You are a tool router for an MCP client demo managing network infrastructure (Cisco/Extreme fabrics, switches, tenants).\n"
            "Task: choose exactly ONE best tool from the candidate list and minimal JSON inputs.\n"
            "Rules: do NOT invent tools. Only pick from the candidates.\n"
            "Output: ONLY valid JSON on a single line: "
            "{\"tool\":\"...\",\"inputs\":{...},\"explanation\":\"one sentence why\",\"confidence\":0.9}\n"
        )},
        {"role": "user", "content": f"USER_REQUEST: {user_text}\n\nCANDIDATES:\n{json.dumps(cand_sig, ensure_ascii=False)}"},
    ]
    result = await _openai_chat(messages, max_tokens=256, temperature=0.1, source="tool_router")
    if "error" in result:
        return result
    content = result.get("content", "")
    jm = re.search(r"\{.*\}", content, re.S)
    if not jm:
        return {"error": "openai_bad_json", "body": content[:400]}
    try:
        parsed = json.loads(jm.group(0))
    except json.JSONDecodeError:
        return {"error": "openai_bad_json", "body": content[:400]}
    tool = parsed.get("tool")
    if not isinstance(tool, str) or not tool:
        return {"error": "openai_no_tool", "body": content[:200]}
    return {
        "tool": tool,
        "inputs": parsed.get("inputs") if isinstance(parsed.get("inputs"), dict) else {},
        "explanation": parsed.get("explanation", ""),
        "confidence": float(parsed.get("confidence", 0.8)) if isinstance(parsed.get("confidence"), (int, float)) else 0.8,
    }


async def llm_explain_openai(user_text: str, tool: str, inputs: Dict[str, Any], tool_result: Any) -> Dict[str, Any]:
    """Use OpenAI to generate a human-friendly explanation of tool results."""
    result_str = json.dumps(tool_result, default=str, ensure_ascii=False)[:6000]
    messages = [
        {"role": "system", "content": (
            "You are an assistant for a network operations dashboard. "
            "The user asked a question, a tool was invoked, and you now see the result. "
            "Write a concise 2-4 sentence summary for the operator. Be factual and specific. "
            "Mention key numbers, status values, or problems found. No markdown."
        )},
        {"role": "user", "content": f"User asked: {user_text}\nTool used: {tool}\nInputs: {json.dumps(inputs, default=str)}\nResult:\n{result_str}"},
    ]
    result = await _openai_chat(messages, max_tokens=300, temperature=0.3, source="explain")
    if "error" in result:
        return result
    return {"text": result.get("content", "")}


