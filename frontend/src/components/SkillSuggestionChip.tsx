// SkillSuggestionChip — passive hint chip that surfaces a runnable
// agent skill below the NL prompt textarea. Two tiers:
//
//   1. Keyword tier — match against each skill's trigger_keywords
//      (parent supplies the matched skill or null).
//   2. LLM tier — when keyword missed, parent's debounced call to
//      /api/agent/suggest-skill picks one (parent supplies the
//      suggestion + reason).
//
// Pure presentational: parent owns the matching logic, the dismissal
// state, and the click handler. The chip just renders the result.

interface SkillSuggestionChipProps {
  /** Matched skill config from AGENT_SKILLS (parent looks up the
   *  frontend key from the registry name). Null if neither tier
   *  produced a match → the chip doesn't render. */
  matchedConfig: { buttonLabel: string; accent: string; description?: string } | null;
  /** Frontend AGENT_SKILLS key — passed back to onRun verbatim so
   *  the parent can invoke its existing runAgentSkill handler. */
  matchedKey: string;
  /** True if the match came from the LLM tier (changes the chip
   *  label and shows the model's reason as a tooltip). */
  isLlmSuggestion: boolean;
  /** Model's one-sentence reason when isLlmSuggestion is true. */
  llmReason: string;
  /** Operator clicked Run. */
  onRun: (key: string) => void;
  /** Operator clicked × dismiss — parent should record the dismissed
   *  text so editing the prompt re-shows the chip. */
  onDismiss: () => void;
}

export function SkillSuggestionChip({
  matchedConfig, matchedKey, isLlmSuggestion, llmReason, onRun, onDismiss,
}: SkillSuggestionChipProps) {
  if (!matchedConfig) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      background: "rgba(99,102,241,0.08)",
      border: "1px solid rgba(99,102,241,0.28)",
      borderRadius: 8, padding: "8px 12px", marginBottom: 12,
      fontSize: 13,
    }}>
      <span style={{ color: "var(--muted-color)", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
        {isLlmSuggestion ? "Agent suggests:" : "Looks like a job for an agent skill:"}
      </span>
      <button
        onClick={() => onRun(matchedKey)}
        style={{
          background: matchedConfig.accent + "20",
          border: `1px solid ${matchedConfig.accent}88`,
          color: matchedConfig.accent,
          fontWeight: 600, fontSize: 12.5,
          padding: "4px 10px", borderRadius: 5,
          cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}
        title={matchedConfig.description}
      >
        Run {matchedConfig.buttonLabel}
      </button>
      {/* When the LLM picked the skill, expose its reason as italic
          text + tooltip. Clipped with ellipsis so a long reason
          doesn't blow up the chip's row height. */}
      {isLlmSuggestion && llmReason && (
        <span style={{
          color: "var(--dim-color)", fontSize: 11.5, fontStyle: "italic",
          flex: "1 1 auto", minWidth: 0, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }} title={llmReason}>
          ({llmReason})
        </span>
      )}
      <button
        onClick={onDismiss}
        style={{
          background: "transparent", border: "none",
          color: "var(--dim-color)", fontSize: 11,
          cursor: "pointer", marginLeft: isLlmSuggestion ? 0 : "auto",
          padding: "2px 6px",
        }}
        title="Dismiss this suggestion"
      >
        × dismiss
      </button>
    </div>
  );
}
