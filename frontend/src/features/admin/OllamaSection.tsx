// Ollama (local-LLM) settings section of Client Config.
//
// Just three fields — URL, model, enable toggle. Defaults are sensible
// (127.0.0.1:11434 + qwen2.5:3b-instruct). When enabled, the local router
// will prefer Ollama for free LLM calls; OpenAI is used only when Ollama
// is off or returns nothing usable.
//
// Extracted from App.tsx as the ninth step of the incremental App split.

import { type CSSProperties } from "react";

export interface OllamaSectionProps {
  config: any;
  saveSetting: (key: string, value: any) => void;
}

const sectionTitle: CSSProperties = { color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 18, marginBottom: 10 };
const fld: CSSProperties = { background: "rgba(0,0,0,0.3)", border: "1px solid var(--subtle-border)", borderRadius: 6, padding: "6px 10px", color: "var(--heading-color)", fontSize: 12, flex: 1 };
const lbl: CSSProperties = { color: "var(--muted-color)", fontSize: 11, marginBottom: 3 };

export function OllamaSection({ config, saveSetting }: OllamaSectionProps) {
  return (
    <>
      <div style={sectionTitle}>Local LLM (Ollama)</div>
      <div className="space-y-3 mb-4">
        <div className="flex gap-3">
          <div style={{ flex: 1 }}>
            <div style={lbl}>Ollama URL</div>
            <input defaultValue={config.ollama_base_url || ""} onBlur={(e) => saveSetting("ollama_base_url", e.target.value)} placeholder="http://127.0.0.1:11434" style={fld} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={lbl}>Model</div>
            <input defaultValue={config.ollama_model || ""} onBlur={(e) => saveSetting("ollama_model", e.target.value)} placeholder="qwen2.5:3b-instruct" style={fld} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
          <input type="checkbox" defaultChecked={config.ollama_enabled} onChange={(e) => saveSetting("ollama_enabled", e.target.checked)} />
          Enable Ollama LLM
        </label>
      </div>
    </>
  );
}
