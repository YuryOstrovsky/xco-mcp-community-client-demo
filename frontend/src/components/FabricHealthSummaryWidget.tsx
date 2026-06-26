// FabricHealthSummaryWidget — extracted from App.tsx as part of the incremental UI split.

export function FabricHealthSummaryWidget({
  fabricName,
  headline,
  fabrics,
  deviceCounts,
  unhealthyDevices,
  serviceHealth,
  onClose,
  onFabricClick,
}: {
  fabricName: string;
  headline: { fabric_health?: string; topology_health?: string };
  fabrics: any[];
  deviceCounts: Record<string, number>;
  unhealthyDevices: any[];
  serviceHealth: Record<string, string>;
  onClose: () => void;
  onFabricClick?: (name: string) => void;
}) {
  // Health status → dot color (dots are always colored)
  const dotColor = (h: string) => {
    const v = String(h || "").toLowerCase();
    if (v === "green") return "#22c55e";
    if (v === "red") return "#ef4444";
    if (v === "yellow") return "#f59e0b";
    return "#94a3b8";
  };

  // Figma badge: neutral slate bg, colored dot, slate text
  const HealthBadge = ({ value }: { value: string }) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "var(--row-selected-bg)", border: "1px solid var(--btn-secondary-border)",
      color: "var(--subtitle-color)", borderRadius: 4, padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor(value), display: "inline-block", flexShrink: 0 }} />
      {value || "\u2014"}
    </span>
  );

  const totalDevices = Object.values(deviceCounts).reduce((a, b) => a + b, 0);
  const greenDevices: number = deviceCounts["Green"] ?? 0;
  const redDevices: number = deviceCounts["Red"] ?? 0;
  const serviceEntries = Object.entries(serviceHealth);

  return (
    <div style={{
      background: "var(--container-bg)", borderRadius: 12,
      border: "1px solid var(--container-border)", overflow: "hidden",
      boxShadow: "0 18px 34px rgba(0,0,0,0.18)",
    }}>
      {/* Figma header: bg-indigo-300/10, Activity icon, X close */}
      <div style={{
        background: "var(--header-tint-bg)", padding: "16px 24px",
        borderBottom: "1px solid var(--container-border)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Activity icon (lucide) */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <div>
            <h2 style={{ color: "var(--heading-color)", fontSize: 18, fontWeight: 500, margin: 0, display: "flex", alignItems: "center" }}>
              Fabric Health Summary
            </h2>
            <p style={{ color: "var(--dim-color)", fontSize: 12, margin: "2px 0 0" }}>
              {fabricName || "all fabrics"} &middot; {fabrics.length} fabric{fabrics.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
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

      {/* Content */}
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Summary cards — Figma: bg-slate-900/50 border-slate-700 */}
        <div style={{ display: "grid", gridTemplateColumns: Object.keys(deviceCounts).length > 0 ? "1fr 1fr 1fr" : "1fr 1fr", gap: 16 }}>
          <div style={{ background: "var(--inner-card-bg)", border: "1px solid var(--container-border)", borderRadius: 8, padding: "16px 24px" }}>
            <div style={{ color: "var(--dim-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Fabric Health
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(headline.fabric_health ?? ""), display: "inline-block" }} />
              <span style={{ color: "var(--heading-color)", fontSize: 18, fontWeight: 500 }}>{headline.fabric_health ?? "\u2014"}</span>
            </div>
          </div>
          <div style={{ background: "var(--inner-card-bg)", border: "1px solid var(--container-border)", borderRadius: 8, padding: "16px 24px" }}>
            <div style={{ color: "var(--dim-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Topology Health
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(headline.topology_health ?? ""), display: "inline-block" }} />
              <span style={{ color: "var(--heading-color)", fontSize: 18, fontWeight: 500 }}>{headline.topology_health ?? "\u2014"}</span>
            </div>
          </div>
          {Object.keys(deviceCounts).length > 0 && (
            <div style={{ background: "var(--inner-card-bg)", border: "1px solid var(--container-border)", borderRadius: 8, padding: "16px 24px" }}>
              <div style={{ color: "var(--dim-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Devices
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--heading-color)", fontSize: 18, fontWeight: 500 }}>{totalDevices}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#4ade80", fontWeight: 500 }}>{greenDevices} healthy</span>
                  {redDevices > 0 && <span style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{redDevices} unhealthy</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fabrics table — Figma: bg-slate-900/30 border-slate-700/50 grid-cols-5 */}
        {fabrics.length > 0 && (
          <div>
            <div style={{ color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
              Fabrics
            </div>
            <div style={{ background: "var(--inner-card-bg-2)", border: "1px solid rgba(51,65,85,0.5)", borderRadius: 8, overflow: "hidden" }}>
              {/* Table header */}
              <div style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 16,
                padding: "12px 16px", background: "var(--inner-card-bg)", borderBottom: "1px solid rgba(51,65,85,0.5)",
              }}>
                {["Name", "Health", "Topology", "Type", "Stage"].map((h) => (
                  <div key={h} style={{ color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
                ))}
              </div>
              {/* Table rows */}
              {fabrics.map((f: any, i: number) => {
                const fName = f.fabric ?? "";
                return (
                <div key={fName || i} style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 16,
                  padding: "12px 16px", alignItems: "center",
                  borderBottom: i < fabrics.length - 1 ? "1px solid rgba(51,65,85,0.3)" : "none",
                  cursor: onFabricClick && fName ? "pointer" : "default",
                  transition: "background 0.15s",
                }}
                  onClick={() => { if (onFabricClick && fName) onFabricClick(fName); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(15,23,42,0.5)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ color: onFabricClick && fName ? "#a5b4fc" : "#e2e8f0", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    {fName || "\u2014"}
                    {onFabricClick && fName && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                  </div>
                  <div><HealthBadge value={f.fabric_health ?? "\u2014"} /></div>
                  <div><HealthBadge value={f.topology_health ?? "\u2014"} /></div>
                  <div style={{ color: "var(--subtitle-color)", fontSize: 14 }}>{f["fabric-type"] ?? "\u2014"}</div>
                  <div style={{ color: "var(--subtitle-color)", fontSize: 14 }}>{f["fabric-stage"] ?? "\u2014"}</div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Unhealthy devices */}
        {unhealthyDevices.length > 0 && (
          <div>
            <div style={{ color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
              Unhealthy Devices <span style={{ color: "#f87171" }}>({unhealthyDevices.length})</span>
            </div>
            <div style={{ background: "var(--inner-card-bg-2)", border: "1px solid rgba(51,65,85,0.5)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 16,
                padding: "12px 16px", background: "var(--inner-card-bg)", borderBottom: "1px solid rgba(51,65,85,0.5)",
              }}>
                {["IP", "Role", "Aggregated", "Config State", "App State"].map((h) => (
                  <div key={h} style={{ color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
                ))}
              </div>
              {unhealthyDevices.map((d: any, i: number) => (
                <div key={d.device_ip ?? i} style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 16,
                  padding: "12px 16px", alignItems: "center",
                  borderBottom: i < unhealthyDevices.length - 1 ? "1px solid rgba(51,65,85,0.3)" : "none",
                }}>
                  <div style={{ fontFamily: "monospace", color: "var(--heading-color)", fontSize: 14 }}>{d.device_ip ?? "\u2014"}</div>
                  <div style={{ color: "var(--subtitle-color)", fontSize: 14 }}>{d.role ?? "\u2014"}</div>
                  <div><HealthBadge value={d.aggregated_health ?? "\u2014"} /></div>
                  <div><HealthBadge value={d.config_state_health ?? "\u2014"} /></div>
                  <div style={{ color: "var(--muted-color)", fontFamily: "monospace", fontSize: 12 }}>{d.app_state ?? "\u2014"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Services — Figma: neutral slate badges with green/red dots */}
        {serviceEntries.length > 0 && (
          <div>
            <div style={{ color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
              Services
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {serviceEntries.map(([svc, status]) => {
                const ok = String(status).toLowerCase() === "ok";
                return (
                  <span key={svc} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "rgba(51,65,85,0.5)", border: "1px solid var(--btn-secondary-border)",
                    color: "var(--subtitle-color)", borderRadius: 4, padding: "6px 12px", fontSize: 14,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? "#22c55e" : "#ef4444", display: "inline-block", flexShrink: 0 }} />
                    {svc} {status}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

