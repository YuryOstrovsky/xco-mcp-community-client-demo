// OpenAI key setter section of Client Config — canonical home for the key.
//
// Used by AI routing, Ambient chat, and multi-step investigations. Stored in
// the backend runtime (no restart). The OPENAI_API_KEY env still works as a
// seed; this section just overrides it at runtime.
//
// State stays in App (the AI Console reads the same openaiKey* state to show
// its inline status indicator) and is passed in via props. Extracted from
// App.tsx as the seventh step of the incremental App split.

import { type CSSProperties } from "react";
import { postJSON } from "../../lib/api";

export interface OpenAiKeySectionProps {
  openaiKey: string;
  setOpenaiKey: (v: string) => void;
  openaiModel: string;
  setOpenaiModel: (v: string) => void;
  openaiKeySet: boolean;
  setOpenaiKeySet: (v: boolean) => void;
  openaiKeySaving: boolean;
  setOpenaiKeySaving: (v: boolean) => void;
  /** GET /api/client-settings response — read for openai_key_set / openai_model fallback. */
  adminClientConfig: any;
  savedFlash: string;
  setSavedFlash: (v: string | ((cur: string) => string)) => void;
}

const sectionTitle: CSSProperties = { color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 18, marginBottom: 10 };

export function OpenAiKeySection({
  openaiKey, setOpenaiKey,
  openaiModel, setOpenaiModel,
  openaiKeySet, setOpenaiKeySet,
  openaiKeySaving, setOpenaiKeySaving,
  adminClientConfig,
  savedFlash, setSavedFlash,
}: OpenAiKeySectionProps) {
  const active = openaiKeySet || adminClientConfig.openai_key_set;
  return (
    <>
      <div style={sectionTitle}>OpenAI</div>
      <div className="space-y-2 mb-2">
        <div className="text-sm" style={{ color: active ? "#86efac" : "var(--muted-color)" }}>
          {active
            ? `✓ API key active (${openaiModel || adminClientConfig.openai_model})`
            : "No API key set"}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="password"
            placeholder="OpenAI API key (sk-...)"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            style={{ flex: 1, background: "rgba(0,0,0,0.3)", border: "1px solid var(--subtle-border)", borderRadius: 6, padding: "6px 8px", color: "var(--heading-color)", fontSize: 12, fontFamily: "monospace" }}
          />
          <select
            value={openaiModel}
            onChange={(e) => setOpenaiModel(e.target.value)}
            style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--subtle-border)", borderRadius: 6, padding: "6px 6px", color: "var(--heading-color)", fontSize: 12 }}
          >
            <option value="gpt-4o-mini">4o-mini</option>
            <option value="gpt-4o">4o</option>
            <option value="gpt-4-turbo">4-turbo</option>
            <option value="gpt-3.5-turbo">3.5</option>
          </select>
          <button
            onClick={async () => {
              setOpenaiKeySaving(true);
              try {
                const r = await postJSON<any>("/api/openai-key", { api_key: openaiKey, model: openaiModel });
                setOpenaiKeySet(!!r?.has_key);
                if (r?.model) setOpenaiModel(r.model);
                try { localStorage.setItem("mcp_openai_key", openaiKey); } catch {}
                setSavedFlash("openai_key");
                setTimeout(() => setSavedFlash((cur: string) => (cur === "openai_key" ? "" : cur)), 1800);
              } catch {} finally { setOpenaiKeySaving(false); }
            }}
            disabled={openaiKeySaving || !openaiKey.trim()}
            style={{ background: openaiKeySet ? "#10b981" : "#6366f1", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: (openaiKeySaving || !openaiKey.trim()) ? 0.5 : 1 }}
          >
            {openaiKeySaving ? "…" : savedFlash === "openai_key" ? "✓ saved" : "Set"}
          </button>
        </div>
        <div className="text-xs" style={{ color: "var(--dim-color)", lineHeight: 1.5 }}>
          Used by AI routing, Ambient chat, and multi-step investigations. Stored in the backend runtime (no restart). You can also set <code style={{ background: "rgba(0,0,0,0.35)", padding: "0 4px", borderRadius: 3 }}>OPENAI_API_KEY</code> in the service environment.
        </div>
      </div>
    </>
  );
}
