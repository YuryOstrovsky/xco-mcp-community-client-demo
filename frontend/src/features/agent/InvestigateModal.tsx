// AI Agent Investigate modal — runs a bounded read-only agent loop
// (OpenAI tool-use) that picks tools, observes results, and synthesizes a
// Markdown report. Renders three states: streaming (with live trace),
// error, or finished (with synthesis + collapsible trace + "About this
// skill" disclosure).
//
// Pure presentational: parent owns the streaming state, the result
// payload, the trace-open flag, and computes the Markdown-rendered
// synthesis (passed as `renderedSynthesis`).
//
// Extracted from App.tsx.

import { type ReactNode, type RefObject } from "react";
import { Panel } from "../../components/Panel";
import { FG, btnSecondary, hoverGhost, errorBox } from "../../lib/figmaStyles";

export interface InvestigateTraceStep {
  step?: number;
  kind?: string;
  tool?: string;
  text?: string;
  args?: Record<string, any>;
  result_preview?: string;
  error?: string;
}

export interface InvestigateSkillMeta {
  name: string;
  description?: string;
  allowed_tools?: string[];
}

export interface InvestigateResult {
  skill?: string;
  skill_meta?: InvestigateSkillMeta;
  synthesis?: string;
  turns?: number;
  tool_calls?: number;
  elapsed_ms?: number;
  stop_reason?: string;
  bounds?: { max_turns?: number; max_tool_calls?: number };
  trace?: InvestigateTraceStep[];
  error?: string;
}

export interface InvestigateModalProps {
  open: boolean;
  /** Final panel-bar title (parent looks up AGENT_SKILLS to format this). */
  title: string;
  running: boolean;
  result: InvestigateResult | null;
  liveTrace: InvestigateTraceStep[];
  elapsedMs: number;
  /** Auto-scroll target for the live trace pane. */
  liveTraceScrollRef: RefObject<HTMLDivElement | null>;
  traceOpen: boolean;
  setTraceOpen: (v: boolean) => void;
  /** Parent-rendered Markdown synthesis. Avoids importing renderMarkdown here. */
  renderedSynthesis: ReactNode;
  onClose: () => void;
}

export function InvestigateModal({
  open, title, running, result, liveTrace, elapsedMs,
  liveTraceScrollRef, traceOpen, setTraceOpen,
  renderedSynthesis,
  onClose,
}: InvestigateModalProps) {
  if (!open) return null;
  const stepColor = (kind?: string) =>
    kind === "thought" ? "#93c5fd" :
    kind === "tool_call" ? "#fbbf24" :
    kind === "tool_result" ? "#86efac" :
    kind === "tool_refused" ? "#fca5a5" :
    kind === "filtered" ? "#c4b5fd" :
    kind === "normalized" ? "#7dd3fc" :
    kind === "catalog_loaded" ? "#a5b4fc" :
    kind === "llm_error" ? "#fca5a5" :
    "#e2e8f0";
  return (
    <Panel title={title} onClose={onClose}>
      {running && !result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="inline-block h-5 w-5 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
            <span style={{ color: FG.bodyColor, fontSize: 14, fontWeight: 500 }}>
              Investigating… {Math.max(1, Math.ceil(elapsedMs / 1000))}s
            </span>
            <span style={{ color: FG.dimColor, fontSize: 12 }}>
              ({liveTrace.length} step{liveTrace.length === 1 ? "" : "s"})
            </span>
          </div>
          <div style={{ color: FG.dimColor, fontSize: 12 }}>
            The agent is calling read-only tools and synthesizing. Bounded to
            ~10 reasoning turns and ~25 tool calls. Steps appear live below as
            they happen.
          </div>

          {liveTrace.length > 0 && (
            <div ref={liveTraceScrollRef} style={{
              maxHeight: 420, overflowY: "auto",
              background: "rgba(0,0,0,0.25)", border: `1px solid ${FG.containerBorder}`,
              borderRadius: 8, padding: 10, fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              color: FG.mutedColor,
            }}>
              {liveTrace.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "4px 0",
                    borderBottom: idx < liveTrace.length - 1 ? "1px solid rgba(71,85,105,0.2)" : "none",
                    animation: idx === liveTrace.length - 1 ? "fadeInStep 0.2s ease-out" : "none",
                  }}
                >
                  <span style={{ color: FG.dimColor }}>#{step.step}</span>{" "}
                  <span style={{ color: stepColor(step.kind), fontWeight: 600 }}>{step.kind}</span>
                  {step.tool && <span style={{ color: "#c4b5fd" }}> {step.tool}</span>}
                  {step.text && <div style={{ marginLeft: 22, marginTop: 2, color: FG.bodyColor, whiteSpace: "pre-wrap" }}>{step.text}</div>}
                  {step.args && Object.keys(step.args).length > 0 && (
                    <div style={{ marginLeft: 22, marginTop: 2, color: FG.dimColor }}>args: {JSON.stringify(step.args)}</div>
                  )}
                  {step.result_preview && (
                    <div style={{ marginLeft: 22, marginTop: 2, color: FG.mutedColor }}>{step.result_preview}</div>
                  )}
                  {step.error && (
                    <div style={{ marginLeft: 22, marginTop: 2, color: "#fca5a5" }}>{step.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : result?.error ? (
        <div style={errorBox()}>{result.error}</div>
      ) : result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Top stats */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: FG.mutedColor }}>
            <span style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", padding: "3px 9px", borderRadius: 6 }}>
              skill: <strong style={{ color: FG.bodyColor }}>{result.skill}</strong>
            </span>
            <span style={{ background: "rgba(71,85,105,0.25)", padding: "3px 9px", borderRadius: 6 }}>
              turns: {result.turns ?? 0}
            </span>
            <span style={{ background: "rgba(71,85,105,0.25)", padding: "3px 9px", borderRadius: 6 }}>
              tool calls: {result.tool_calls ?? 0}
            </span>
            <span style={{ background: "rgba(71,85,105,0.25)", padding: "3px 9px", borderRadius: 6 }}>
              elapsed: {Math.round((result.elapsed_ms ?? 0) / 100) / 10}s
            </span>
            <span style={{
              background: result.stop_reason === "stop" ? "rgba(34,197,94,0.15)" : "rgba(251,191,36,0.15)",
              color: result.stop_reason === "stop" ? "#86efac" : "#fbbf24",
              padding: "3px 9px", borderRadius: 6,
            }}>
              stop: {result.stop_reason}
            </span>
          </div>

          {/* Synthesis */}
          <div style={{
            position: "relative",
            background: "rgba(15,23,42,0.55)", border: `1px solid ${FG.containerBorder}`,
            borderRadius: 10, padding: "14px 18px", color: FG.bodyColor,
            fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 13.5, lineHeight: 1.6,
          }}>
            {result.synthesis && (
              <button
                onClick={(e) => {
                  const txt = result.synthesis ?? "";
                  const btn = e.currentTarget as HTMLButtonElement;
                  const flash = (label: string) => {
                    const prev = btn.innerHTML;
                    btn.innerHTML = label;
                    setTimeout(() => { btn.innerHTML = prev; }, 1400);
                  };
                  const useClipboardApi = !!(window.isSecureContext && navigator.clipboard);
                  if (useClipboardApi) {
                    navigator.clipboard.writeText(txt).then(
                      () => flash("✓ Copied"),
                      () => fallback(),
                    );
                  } else {
                    fallback();
                  }
                  function fallback() {
                    const ta = document.createElement("textarea");
                    ta.value = txt;
                    ta.style.position = "fixed";
                    ta.style.top = "-1000px";
                    ta.style.left = "0";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.focus(); ta.select();
                    let ok = false;
                    try { ok = document.execCommand("copy"); } catch { ok = false; }
                    document.body.removeChild(ta);
                    flash(ok ? "✓ Copied" : "✗ Copy blocked");
                  }
                }}
                title="Copy report (Markdown source)"
                style={{
                  position: "absolute", top: 10, right: 10,
                  background: "var(--inner-card-bg)", border: `1px solid ${FG.containerBorder}`,
                  color: FG.mutedColor, fontSize: 11, padding: "4px 9px", borderRadius: 6,
                  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = FG.bodyColor; (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.45)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = FG.mutedColor; (e.currentTarget as HTMLElement).style.borderColor = FG.containerBorder; }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy
              </button>
            )}
            {result.synthesis
              ? renderedSynthesis
              : <div style={{ color: FG.dimColor }}>(empty synthesis — see trace below)</div>}
          </div>

          {/* About this skill — educational/demo context */}
          {result.skill_meta && (
            <details style={{
              background: "rgba(99,102,241,0.06)",
              border: "1px solid rgba(99,102,241,0.18)",
              borderRadius: 10, padding: "10px 14px",
              fontSize: 12.5, color: FG.mutedColor, lineHeight: 1.6,
            }}>
              <summary style={{ cursor: "pointer", color: FG.bodyColor, fontWeight: 500, marginBottom: 4 }}>
                About this skill — how the investigation was done
              </summary>
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: "0 0 8px 0" }}>
                  This investigation was performed by the{" "}
                  <code style={{ background: "rgba(99,102,241,0.2)", padding: "1px 6px", borderRadius: 4 }}>
                    {result.skill_meta.name}
                  </code>{" "}
                  <strong>agent skill</strong> — a read-only "agent" feature in this MCP client.
                </p>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong>How it works.</strong> Powered by OpenAI tool-use (function calling). The agent
                  runs a bounded loop ({result.bounds?.max_turns ?? "≤10"} reasoning
                  turns, max {result.bounds?.max_tool_calls ?? "25"} tool calls). It
                  receives the user's question, decides which read-only MCP tool to call next, observes
                  the result, and decides what to do — until it has enough evidence to write the report.
                  Mutating tools are blocked at the host level; the agent <em>cannot</em> change anything
                  in your network.
                </p>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong>What this skill knows about.</strong> {result.skill_meta.description}
                </p>
                <p style={{ margin: "0 0 6px 0" }}>
                  <strong>Tool allow-list ({(result.skill_meta.allowed_tools ?? []).length}):</strong>
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {(result.skill_meta.allowed_tools ?? []).map((t: string) => (
                    <code key={t} style={{
                      background: "rgba(15,23,42,0.55)", border: "1px solid rgba(71,85,105,0.4)",
                      color: "#a5b4fc", padding: "1px 6px", borderRadius: 4, fontSize: 11,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}>{t}</code>
                  ))}
                </div>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong>Server-side safety nets.</strong> Two transformations happen to tool results
                  before the agent sees them: (1) cleared/resolved alarm entries are stripped (the alarm
                  tools return resolution events alongside active ones, and the model can't reliably tell
                  them apart), and (2) misleading BGP flags from running-config are rewritten with an
                  explanatory note. See the trace for any{" "}
                  <span style={{ color: "#fbbf24" }}>filtered</span> or{" "}
                  <span style={{ color: "#86efac" }}>normalized</span> events.
                </p>
                <p style={{ margin: 0, fontStyle: "italic", color: FG.dimColor }}>
                  This is an early/demo feature. It is intentionally narrow: read-only, one skill, no
                  streaming. Synthesis quality depends heavily on the underlying LLM (OpenAI) and the
                  quality of the skill's system prompt — both are still being tuned. Mutating operations
                  (deploy, destroy, reconcile, firmware) continue to use the existing plan-approval
                  pipeline, which is unaffected by this feature.
                </p>
              </div>
            </details>
          )}

          {/* Trace (collapsible) */}
          <div>
            <button
              onClick={() => setTraceOpen(!traceOpen)}
              style={{
                ...btnSecondary(),
                fontSize: 12,
                padding: "6px 12px",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
              {...hoverGhost()}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: traceOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              {traceOpen ? "Hide" : "Show"} trace ({result.trace?.length ?? 0} steps)
            </button>
            {traceOpen && result.trace && (
              <div style={{
                marginTop: 10,
                maxHeight: 360, overflowY: "auto",
                background: "rgba(0,0,0,0.25)", border: `1px solid ${FG.containerBorder}`,
                borderRadius: 8, padding: 10, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: FG.mutedColor,
              }}>
                {result.trace.map((step, idx) => (
                  <div key={idx} style={{ padding: "4px 0", borderBottom: idx < (result.trace?.length ?? 0) - 1 ? "1px solid rgba(71,85,105,0.2)" : "none" }}>
                    <span style={{ color: FG.dimColor }}>#{step.step}</span>{" "}
                    <span style={{ color: stepColor(step.kind), fontWeight: 600 }}>{step.kind}</span>
                    {step.tool && <span style={{ color: "#c4b5fd" }}> {step.tool}</span>}
                    {step.text && <div style={{ marginLeft: 22, marginTop: 2, color: FG.bodyColor, whiteSpace: "pre-wrap" }}>{step.text}</div>}
                    {step.args && Object.keys(step.args).length > 0 && (
                      <div style={{ marginLeft: 22, marginTop: 2, color: FG.dimColor }}>args: {JSON.stringify(step.args)}</div>
                    )}
                    {step.result_preview && (
                      <div style={{ marginLeft: 22, marginTop: 2, color: FG.mutedColor }}>{step.result_preview}</div>
                    )}
                    {step.error && (
                      <div style={{ marginLeft: 22, marginTop: 2, color: "#fca5a5" }}>{step.error}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

