// Activity Log admin panel — last 200 events from the audit stream: logins,
// tool calls, plan lifecycle, agent runs, errors. Read-only viewer; the
// parent owns the fetch state + reload handler.
//
// Extracted from App.tsx — pure presentational.

import { FG, widgetContainer, btnClose, hoverClose } from "../../lib/figmaStyles";

export interface AuditRecord {
  ts?: string;
  event: string;
  [key: string]: any;
}

export interface ActivityLogPanelProps {
  open: boolean;
  loading: boolean;
  err: string;
  records: AuditRecord[];
  onReload: () => void;
  onClose: () => void;
}

export function ActivityLogPanel({ open, loading, err, records, onReload, onClose }: ActivityLogPanelProps) {
  if (!open) return null;
  return (
    <div style={widgetContainer()}>
      <div style={{
        background: "var(--header-tint-bg)", padding: "16px 24px",
        borderBottom: `1px solid ${FG.containerBorder}`,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      }}>
        <div>
          <h2 style={{ margin: 0, color: FG.headingColor, fontSize: 18, fontWeight: 500 }}>Activity Log</h2>
          <p style={{ margin: "4px 0 0", color: FG.dimColor, fontSize: 14 }}>
            Last 200 events — newest first · logins, tool calls, plan lifecycle, agent runs, errors
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onReload}
            disabled={loading}
            style={{
              padding: "8px 16px", fontSize: 13, fontWeight: 500, borderRadius: 8,
              background: "var(--btn-neutral-bg)", color: "var(--subtitle-color)", border: "1px solid var(--btn-secondary-border)",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLElement).style.background = "var(--btn-neutral-hover-bg)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--btn-neutral-bg)"; }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button onClick={onClose} style={btnClose()} {...hoverClose()} aria-label="Close">✕</button>
        </div>
      </div>

      <div style={{ padding: 24, maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
        {err && (
          <div style={{
            background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 6, padding: "0.5rem 0.75rem", color: "#f87171", fontSize: "0.82rem", marginBottom: 12,
          }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {records.length === 0 && !loading && (
            <div style={{ opacity: 0.45, fontSize: "0.85rem", color: "var(--text)", padding: "1.5rem 0" }}>
              No audit records found.
            </div>
          )}
          {records.map((rec, i) => {
            const isOk = rec.event.endsWith("_ok");
            const isFail = rec.event.endsWith("_fail");
            const isAuth = rec.event.startsWith("auth.");
            const ts = rec.ts ? new Date(rec.ts).toLocaleString() : "—";
            const extra = Object.entries(rec)
              .filter(([k]) => !["ts", "event"].includes(k))
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
              .join("  ·  ");
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 180px 1fr",
                  gap: 8,
                  alignItems: "start",
                  background: "var(--bg1)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "0.45rem 0.75rem",
                  fontSize: "0.78rem",
                  fontFamily: "monospace",
                }}
              >
                <span style={{ color: "var(--text)", opacity: 0.5, whiteSpace: "nowrap" }}>{ts}</span>
                <span style={{
                  fontWeight: 600,
                  color: isFail ? "#f87171" : isOk ? "#6ee7b7" : isAuth ? "#93c5fd" : "var(--text)",
                  whiteSpace: "nowrap",
                }}>
                  {rec.event}
                </span>
                <span style={{ color: "var(--text)", opacity: 0.75, wordBreak: "break-all" }}>{extra}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
