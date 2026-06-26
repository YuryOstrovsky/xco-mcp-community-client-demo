// Floating execution badge — bottom-right pill that's visible while a
// change plan is running but the Execution Monitor modal is closed.
// Click → reopens the monitor.
//
// Pure presentational: parent owns the visibility logic.
//
// Extracted from App.tsx.

export interface FloatingExecutionBadgeProps {
  /** Combined visibility: show only when monitor is closed AND plan is running AND we have a plan id. */
  visible: boolean;
  current: number;
  total: number;
  onClick: () => void;
}

export function FloatingExecutionBadge({ visible, current, total, onClick }: FloatingExecutionBadgeProps) {
  if (!visible) return null;
  return (
    <div
      onClick={onClick}
      style={{
        position: "fixed", bottom: 24, right: 24, zIndex: 9999,
        display: "flex", alignItems: "center", gap: 10,
        background: "linear-gradient(135deg, rgba(99,102,241,0.9), rgba(79,70,229,0.9))",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(139,92,246,0.5)",
        borderRadius: 12, padding: "10px 18px",
        cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.4), 0 0 15px rgba(99,102,241,0.3)",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 6px 25px rgba(0,0,0,0.5), 0 0 20px rgba(99,102,241,0.4)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4), 0 0 15px rgba(99,102,241,0.3)"; }}
      title="Click to open Execution Monitor"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
        <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div style={{ color: "white", fontSize: 13, fontWeight: 600 }}>
        Executing plan… {total > 0 ? `${current}/${total}` : ""}
      </div>
      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Click to view</div>
    </div>
  );
}
