// AI Investigation Skills dropdown — the brain-icon button in the main chat.
//
// One row per entry in AGENT_SKILLS (passed in by parent). Each row runs the
// chosen skill via `runSkill`. While a skill is running, the button itself
// turns into a status indicator with the active skill's verb + elapsed seconds.
// Footer link opens the agent's full capability map.
//
// State (open/closed + click-outside-to-close) is local to this component.

import { useEffect, useRef, useState } from "react";

export interface AgentSkillConfig {
  buttonLabel: string;
  description: string;
  verb: string;
  accent: string;
  // Other fields exist on the consumer side but aren't read here.
  [k: string]: any;
}

export interface AiInvestigationSkillsDropdownProps {
  /** The catalog from App. Render-time map: key → config. */
  skills: Record<string, AgentSkillConfig>;
  /** Start a skill by its key. App owns the actual run logic. */
  runSkill: (key: string) => void;
  /** Opens the agent's full capability map. */
  onShowFullSkillSet: () => void;
  /** True while a skill investigation is in progress. */
  investigateRunning: boolean;
  /** True while a plain NL query is in progress (also disables the button). */
  nlRunning: boolean;
  /** Active skill key while investigateRunning is true, or null. */
  investigateActiveSkillKey: string | null;
  /** Elapsed ms for the running investigation — drives the "Ns" counter. */
  investigateElapsedMs: number;
}

export function AiInvestigationSkillsDropdown({
  skills, runSkill, onShowFullSkillSet,
  investigateRunning, nlRunning,
  investigateActiveSkillKey, investigateElapsedMs,
}: AiInvestigationSkillsDropdownProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside / Escape closes the menu — same behaviour as the inline version.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (target && menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const disabled = investigateRunning || nlRunning;

  return (
    <div className="mt-2 relative" ref={menuRef}>
      <button
        className={`w-full rounded-md px-3 py-2 text-sm ${disabled ? "opacity-70 cursor-not-allowed" : ""}`}
        style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.18))",
          border: "1px solid rgba(139,92,246,0.45)",
          // var(--accent) gives readable text in BOTH themes — light purple
          // on dark bg, dark purple on light bg.
          color: "var(--accent)",
          fontWeight: 600,
        }}
        disabled={disabled}
        onClick={() => setMenuOpen(!menuOpen)}
        title="Multi-step read-only investigations — one category of the agent's full AI skill set. The Ambient agent runs these same skills over WhatsApp/Telegram too. No mutations."
      >
        {investigateRunning && investigateActiveSkillKey ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
            {skills[investigateActiveSkillKey]?.verb}… {Math.max(1, Math.ceil(investigateElapsedMs / 1000))}s
          </span>
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v1h-1v6h1a3 3 0 0 1-3 3h-1v1a4 4 0 0 1-8 0v-1H7a3 3 0 0 1-3-3h1v-6H4v-1a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/>
              <circle cx="9" cy="11" r="1.2" fill="currentColor"/>
              <circle cx="15" cy="11" r="1.2" fill="currentColor"/>
            </svg>
            AI Investigation Skills ({Object.keys(skills).length})
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        )}
      </button>

      {menuOpen && !investigateRunning && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--container-bg)",
            border: "1px solid rgba(139,92,246,0.35)",
            borderRadius: 10,
            boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: "min(420px, 50vh)",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          {Object.keys(skills).map((key) => {
            const cfg = skills[key];
            return (
              <button
                key={key}
                onClick={() => {
                  setMenuOpen(false);
                  runSkill(key);
                }}
                style={{
                  textAlign: "left",
                  background: "transparent",
                  border: "1px solid transparent",
                  borderRadius: 7,
                  padding: "8px 10px",
                  color: "var(--heading-color)",
                  cursor: "pointer",
                  transition: "background 0.12s, border-color 0.12s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(139,92,246,0.12)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.35)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.borderColor = "transparent";
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 }}>
                  <span style={{
                    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                    background: cfg.accent, flexShrink: 0,
                  }} />
                  {cfg.buttonLabel}
                  <span style={{ fontSize: 10, color: "var(--muted-color)", marginLeft: "auto" }}>
                    (AI Agent)
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: "var(--subtitle-color)", lineHeight: 1.4 }}>
                  {cfg.description}
                </span>
              </button>
            );
          })}
          {/* Tie this subset back to the agent's full skill set. */}
          <div style={{ borderTop: "1px solid var(--subtle-border)", marginTop: 4, paddingTop: 6 }}>
            <button
              onClick={() => { setMenuOpen(false); onShowFullSkillSet(); }}
              style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 11.5, padding: "4px 10px" }}
              title="See every tool & skill the agent can reach — across chat, the autonomous watcher, and these investigations."
            >
              ↗ See the agent's full skill set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
