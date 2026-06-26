// All Switch Clocks modal — grid of MiniClockCards for every switch in
// the current site, with an NTP-sync form at the bottom. The submit
// creates a change plan (approval still required).
//
// Pure presentational: parent owns the clock data, loading state, NTP
// form buffer, submit flow, and the reload callback.
//
// Extracted from App.tsx.

import { MiniClockCard } from "../../components/MiniClockCard";

export interface AllClocksSwitch {
  ip: string;
  error?: string;
  [key: string]: any;
}

export interface AllClocksModalProps {
  open: boolean;
  loading: boolean;
  data: AllClocksSwitch[];
  /** How many switches we expect to query (drives the loading subtitle). */
  queryCount: number;
  totalSwitchCount: number;
  ntpServer: string;
  setNtpServer: (v: string) => void;
  ntpSubmitting: boolean;
  onReload: () => void;
  onSubmitNtp: () => void;
  onClose: () => void;
}

export function AllClocksModal({
  open, loading, data, queryCount, totalSwitchCount,
  ntpServer, setNtpServer, ntpSubmitting,
  onReload, onSubmitNtp, onClose,
}: AllClocksModalProps) {
  if (!open) return null;
  const reachableCount = data.filter((d) => !d.error).length;
  const canSubmit = !!ntpServer.trim() && !ntpSubmitting;
  return (
    <div style={{
      background: "var(--container-bg)", border: "1px solid var(--container-border)", borderRadius: 12,
      overflow: "hidden", boxShadow: "0 18px 34px rgba(0,0,0,0.38)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 24px", borderBottom: "1px solid var(--container-border)",
        background: "var(--header-tint-bg)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <div>
            <h2 style={{ color: "var(--heading-color)", fontSize: 18, fontWeight: 500, margin: 0, display: "flex", alignItems: "center" }}>All Switch Clocks</h2>
            <p style={{ color: "var(--dim-color)", fontSize: 12, margin: "2px 0 0" }}>
              {loading ? "Fetching..." : `${data.length} switches`}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!loading && data.length > 0 && (
            <button
              onClick={onReload}
              style={{
                background: "transparent", border: "none", borderRadius: 8,
                color: "var(--muted-color)", padding: "8px 12px", fontSize: 14, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--heading-color)"; e.currentTarget.style.background = "var(--btn-neutral-bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-color)"; e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              Refresh
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", color: "var(--muted-color)",
              borderRadius: 8, padding: 8, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--heading-color)"; e.currentTarget.style.background = "var(--btn-neutral-bg)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-color)"; e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "48px 0", color: "var(--muted-color)" }}>
            <span className="inline-block h-5 w-5 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
            <span style={{ fontSize: 14 }}>Fetching clock{queryCount === 1 ? "" : "s"} from {queryCount || totalSwitchCount} switch{queryCount === 1 ? "" : "es"}...</span>
          </div>
        ) : data.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--dim-color)", padding: "48px 0", fontSize: 14 }}>
            No switches found in inventory.
          </div>
        ) : (
          <>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 16,
            }}>
              {data.map((sw) => (
                <MiniClockCard key={sw.ip} data={sw as any} />
              ))}
            </div>

            <div style={{ paddingTop: 24, borderTop: "1px solid var(--container-border)" }}>
              <div style={{ color: "var(--subtitle-color)", fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
                Sync with NTP
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    NTP Server
                  </label>
                  <input
                    type="text"
                    value={ntpServer}
                    onChange={(e) => setNtpServer(e.target.value)}
                    placeholder="e.g. 10.0.0.1 or pool.ntp.org"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--inner-card-bg)", border: "1px solid var(--container-border)", borderRadius: 8,
                      padding: "10px 16px", color: "var(--heading-color)", fontSize: 14,
                      outline: "none", transition: "border-color 0.15s",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--btn-secondary-border)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--container-border)"; }}
                  />
                </div>

                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "12px 16px", borderRadius: 8,
                  background: "var(--inner-card-bg-2)", border: "1px solid rgba(51,65,85,0.5)",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span style={{ color: "var(--muted-color)", fontSize: 14 }}>
                    This will create a change plan requiring approval before execution.
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={onSubmitNtp}
                    disabled={!canSubmit}
                    style={{
                      background: !canSubmit ? "rgba(99,102,241,0.3)" : "#6366f1",
                      color: !canSubmit ? "rgba(255,255,255,0.4)" : "#fff",
                      border: "none", borderRadius: 8, padding: "10px 24px",
                      fontSize: 14, fontWeight: 500,
                      cursor: !canSubmit ? "not-allowed" : "pointer",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.background = "#4f46e5"; }}
                    onMouseLeave={(e) => { if (canSubmit) e.currentTarget.style.background = "#6366f1"; }}
                  >
                    {ntpSubmitting ? "Creating plan..." : `Submit NTP Sync Plan (${reachableCount} switches)`}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
