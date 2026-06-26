// useNlSettings — NL textarea + LLM-tier selector + OpenAI key config.
//
// What's owned here:
//   - `text`: the NL textarea content (default: a sample question)
//   - `includeRaw`: option flag forwarded to the NL endpoint
//   - `nlMode`: which LLM tier to use (deterministic / ollama / openai / smart);
//     persisted to localStorage via a useEffect
//   - `openaiKey` / `openaiModel`: persisted to localStorage; on mount, if a
//     key is present, an effect auto-sends it to /api/openai-key so the
//     backend can use it for LLM routing without the operator having to
//     click 'Save' first
//   - `openaiKeySet` / `openaiKeySaving`: backend-side state mirror
//     (whether the backend currently has a key + spinner during save)
//
// Pattern mirrors lib/useAuthSession, lib/useAgentActions, etc. — App.tsx
// calls `useNlSettings()` once and destructures everything it needs.
//
// Extracted from App.tsx in task #101 (Phase E).

import { useEffect, useState } from "react";
import { postJSON } from "./api";

export type NlMode = "deterministic" | "ollama" | "openai" | "smart";

export interface UseNlSettings {
  // NL prompt
  text: string;
  setText: (s: string) => void;
  includeRaw: boolean;
  setIncludeRaw: (v: boolean) => void;

  // Tier selector
  nlMode: NlMode;
  setNlMode: (m: NlMode) => void;

  // OpenAI config
  openaiKey: string;
  setOpenaiKey: (s: string) => void;
  openaiModel: string;
  setOpenaiModel: (s: string) => void;
  openaiKeySet: boolean;
  setOpenaiKeySet: (v: boolean) => void;
  openaiKeySaving: boolean;
  setOpenaiKeySaving: (v: boolean) => void;
}

export function useNlSettings(): UseNlSettings {
  const [text, setText] = useState<string>("Why is my environment unhealthy?");
  const [includeRaw, setIncludeRaw] = useState(false);
  const [nlMode, setNlMode] = useState<NlMode>(() => {
    try { return (localStorage.getItem("mcp_nl_mode") as NlMode) || "smart"; } catch { return "smart"; }
  });
  const [openaiKey, setOpenaiKey] = useState<string>(() => {
    try { return localStorage.getItem("mcp_openai_key") || ""; } catch { return ""; }
  });
  const [openaiModel, setOpenaiModel] = useState<string>(() => {
    try { return localStorage.getItem("mcp_openai_model") || "gpt-4o-mini"; } catch { return "gpt-4o-mini"; }
  });
  const [openaiKeySet, setOpenaiKeySet] = useState(false);
  const [openaiKeySaving, setOpenaiKeySaving] = useState(false);

  // Persist NL mode and OpenAI model to localStorage
  useEffect(() => { try { localStorage.setItem("mcp_nl_mode", nlMode); } catch {} }, [nlMode]);
  useEffect(() => { try { localStorage.setItem("mcp_openai_model", openaiModel); } catch {} }, [openaiModel]);

  // Auto-send saved key to backend on mount if a key is cached. Without
  // this, an operator who set the key in a previous session would have
  // to re-enter it after every page refresh.
  useEffect(() => {
    if (openaiKey) {
      postJSON<any>("/api/openai-key", { api_key: openaiKey, model: openaiModel })
        .then((r) => { setOpenaiKeySet(!!r?.has_key); if (r?.model) setOpenaiModel(r.model); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    text, setText,
    includeRaw, setIncludeRaw,
    nlMode, setNlMode,
    openaiKey, setOpenaiKey,
    openaiModel, setOpenaiModel,
    openaiKeySet, setOpenaiKeySet,
    openaiKeySaving, setOpenaiKeySaving,
  };
}
