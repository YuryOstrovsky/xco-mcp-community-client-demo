// FabricsHealthWidget — extracted from App.tsx as part of the incremental UI split.

import { useState } from "react";
export function FabricsHealthWidget({
  fabrics,
  onClose,
  onFabricClick,
}: {
  fabrics: any[];
  onClose: () => void;
  onFabricClick?: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const overallHealth = fabrics.some(f => String(f["fabric-health"] || "").toLowerCase() === "red")
    ? "Red"
    : fabrics.some(f => String(f["fabric-health"] || "").toLowerCase() === "yellow")
    ? "Yellow"
    : fabrics.length > 0 ? "Green" : "—";

  const healthyCount = fabrics.filter(f => {
    const h = String(f["fabric-health"] || "").toLowerCase();
    return h === "green";
  }).length;
  const unhealthyCount = fabrics.filter(f => {
    const h = String(f["fabric-health"] || "").toLowerCase();
    return h === "red";
  }).length;

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* Figma health pill: bg-slate-750/30 border border-slate-700, small dot + text */
  const HealthPill = ({ value }: { value: string }) => {
    const v = String(value || "").toLowerCase();
    const dotColor = v === "green" ? "#34d399" : v === "red" ? "#f87171" : v === "yellow" ? "#fbbf24" : "#64748b";
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "var(--inner-card-bg-2)", border: "1px solid var(--container-border)",
        borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 500,
        color: "var(--subtitle-color)", whiteSpace: "nowrap",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} />
        {value || "—"}
      </span>
    );
  };

  /* Figma metric card */
  const MetricCard = ({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) => (
    <div style={{
      flex: "1 1 0%", background: "var(--inner-card-bg-2)", border: "1px solid var(--container-border)",
      borderRadius: 8, padding: 16,
    }}>
      <div style={{ fontSize: 11, color: "var(--muted-color)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: valueColor || "#e2e8f0" }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      width: "100%", background: "var(--container-bg)", borderRadius: 12,
      boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.3)",
      overflow: "hidden", border: "1px solid var(--container-border)",
    }}>
      {/* ── Header (Figma: bg-indigo-300/10 border-b border-slate-700) ── */}
      <div style={{
        padding: "16px 24px", background: "var(--header-tint-bg)",
        borderBottom: "1px solid var(--container-border)",
        display: "flex", alignItems: "start", justifyContent: "space-between",
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--heading-color)" }}>Fabrics Health</h2>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--muted-color)" }}>
            {fabrics.length} fabric{fabrics.length !== 1 ? "s" : ""} · overall{" "}
            <span style={{ color: "var(--subtitle-color)" }}>{overallHealth}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            color: "var(--muted-color)", background: "transparent", border: "none",
            padding: 8, borderRadius: 8, cursor: "pointer", lineHeight: 0,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--heading-color)"; e.currentTarget.style.background = "var(--btn-neutral-bg)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-color)"; e.currentTarget.style.background = "transparent"; }}
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Metrics grid (Figma: grid grid-cols-4 gap-4) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <MetricCard
            label="Overall"
            value={
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: overallHealth === "Green" ? "#34d399" : overallHealth === "Red" ? "#f87171" : "#fbbf24" }} />
                {overallHealth}
              </span>
            }
          />
          <MetricCard label="Fabrics" value={fabrics.length} />
          <MetricCard label="Healthy" value={healthyCount} />
          <MetricCard label="Unhealthy" value={unhealthyCount} valueColor={unhealthyCount > 0 ? "#f87171" : "#64748b"} />
        </div>

        {/* Fabrics list (Figma: space-y-3) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {fabrics.map((fabric: any) => {
            const id: number = fabric["fabric-id"];
            const name: string = fabric["fabric-name"] ?? `fabric-${id}`;
            const health: string = fabric["fabric-health"] ?? "";
            const type: string = fabric["fabric-type"] ?? "";
            const stage: number = fabric["fabric-stage"];
            const status: string = fabric["fabric-status"] ?? "";
            const devices: any[] = Array.isArray(fabric["device-health"]) ? fabric["device-health"] : [];
            const isExpanded = expanded.has(id);

            return (
              <div key={id} style={{
                background: "var(--inner-card-bg-2)", border: "1px solid var(--container-border)",
                borderRadius: 8, overflow: "hidden", transition: "border-color 0.15s",
              }}>
                {/* Fabric summary row (Figma: flex items-center justify-between py-3 px-4) */}
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}
                  onMouseEnter={(e) => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = "var(--btn-secondary-border)"; }}
                  onMouseLeave={(e) => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = "var(--container-border)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14, fontWeight: 500, color: "var(--heading-color)", marginBottom: 4,
                        ...(onFabricClick ? { cursor: "pointer" } : {}),
                      }}
                      onClick={() => onFabricClick?.(name)}
                      title={onFabricClick ? `Show topology for ${name}` : undefined}
                    >
                      {name}
                      {onFabricClick && <span style={{ fontSize: 12, color: "var(--dim-color)", marginLeft: 4 }}>↗</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--dim-color)" }}>
                      id {id} · {type} · stage {stage} · {status}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <HealthPill value={health} />
                    {devices.length > 0 && (
                      <button
                        onClick={() => toggleExpand(id)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "4px 12px", borderRadius: 6, fontSize: 12,
                          background: "var(--btn-neutral-bg)", border: "1px solid var(--btn-secondary-border)",
                          color: "var(--muted-color)", cursor: "pointer", whiteSpace: "nowrap",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--row-hover-border)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--btn-secondary-border)"; }}
                      >
                        {isExpanded ? "▲" : "▼"} {devices.length} device{devices.length !== 1 ? "s" : ""}
                      </button>
                    )}
                  </div>
                </div>

                {/* Device table (expandable) */}
                {isExpanded && devices.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--container-border)", overflowX: "auto", overflowY: "auto", maxHeight: 340 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "var(--inner-card-bg)" }}>
                          {["IP", "Role", "Agg. Health", "Config", "Dev State", "App State", "Oper"].map(col => (
                            <th key={col} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--dim-color)", whiteSpace: "nowrap", borderBottom: "1px solid var(--container-border)" }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {devices.map((dev: any) => {
                          const dh = dev["device-health"] ?? {};
                          const agg: string       = dh["aggregated-health"] ?? "";
                          const cfg               = dh["config-state-health"] ?? {};
                          const oper              = dh["oper-state-health"] ?? {};
                          const cfgHealth: string = cfg["config-state-health"] ?? "";
                          const devState: string  = cfg["dev-state"]?.["dev-state"] ?? "";
                          const appState: string  = cfg["app-state"]?.["app-state"] ?? "";
                          const operHealth: string = oper["oper-state-health"] ?? "";
                          return (
                            <tr key={dev["device-id"]} style={{ borderBottom: "1px solid rgba(51,65,85,0.5)" }}>
                              <td style={{ padding: "8px 12px", fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", color: "var(--heading-color)" }}>{dev["device-ip"]}</td>
                              <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: "var(--muted-color)" }}>{dev["role"]}</td>
                              <td style={{ padding: "8px 12px" }}><HealthPill value={agg} /></td>
                              <td style={{ padding: "8px 12px" }}><HealthPill value={cfgHealth} /></td>
                              <td style={{ padding: "8px 12px", color: "var(--muted-color)", whiteSpace: "nowrap" }}>{devState}</td>
                              <td style={{ padding: "8px 12px", color: "var(--muted-color)", whiteSpace: "nowrap" }}>{appState}</td>
                              <td style={{ padding: "8px 12px" }}><HealthPill value={operHealth} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

