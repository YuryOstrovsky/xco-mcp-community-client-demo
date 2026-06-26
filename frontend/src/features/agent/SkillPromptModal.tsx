// Per-skill input prompt — small modal shown when an agent skill
// (e.g. Pre-RMA) needs a parameter (failed-switch IP) before running.
//
// Pure presentational: parent owns the skill key, the field-value map,
// and the run callback.
//
// Extracted from App.tsx.

import { FG, btnSecondary, btnPrimary, hoverGhost } from "../../lib/figmaStyles";

export interface SkillPromptField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export interface SkillPromptConfig {
  accent: string;
  buttonLabel: string;
  inputPrompt: {
    title: string;
    fields: SkillPromptField[];
  };
}

export interface SkillPromptModalProps {
  open: boolean;
  config: SkillPromptConfig | null;
  values: Record<string, string>;
  setValues: (next: Record<string, string>) => void;
  error: string;
  setError: (msg: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function SkillPromptModal({
  open, config, values, setValues, error, setError, onClose, onSubmit,
}: SkillPromptModalProps) {
  if (!open) return null;
  if (!config?.inputPrompt) return null;
  const cfg = config;
  const submit = () => {
    const required = cfg.inputPrompt.fields.filter((f) => f.required);
    for (const f of required) {
      if (!(values[f.key] || "").trim()) {
        setError(`${f.label} is required.`);
        return;
      }
    }
    onSubmit();
  };
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(3px)", zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: FG.containerBg, border: `1px solid ${FG.containerBorder}`,
          borderRadius: 12, padding: 22, width: 480, maxWidth: "92vw",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: cfg.accent }} />
          <h3 style={{ margin: 0, fontSize: 16, color: FG.bodyColor }}>{cfg.inputPrompt.title}</h3>
        </div>
        <p style={{ margin: "0 0 14px 0", fontSize: 12, color: FG.dimColor }}>
          The <strong>{cfg.buttonLabel}</strong> skill needs at least one input to run a useful check.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {cfg.inputPrompt.fields.map((f) => (
            <div key={f.key}>
              <div style={{ fontSize: 11, color: FG.dimColor, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {f.label}
              </div>
              <input
                type="text"
                value={values[f.key] || ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder={f.placeholder}
                autoFocus={f === cfg.inputPrompt.fields[0]}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 7, fontSize: 13.5,
                  background: "rgba(15,23,42,0.55)", border: `1px solid ${FG.containerBorder}`,
                  color: FG.bodyColor, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              />
            </div>
          ))}
        </div>
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)",
            color: "#fca5a5", fontSize: 12, padding: "8px 12px", borderRadius: 7, marginBottom: 12,
          }}>{error}</div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnSecondary()} {...hoverGhost()}>
            Cancel
          </button>
          <button onClick={submit} style={{ ...btnPrimary(), background: cfg.accent, borderColor: cfg.accent, color: "#0f172a" }}>
            Run {cfg.buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
