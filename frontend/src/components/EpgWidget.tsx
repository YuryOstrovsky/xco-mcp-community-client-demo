// EpgWidget — extracted from App.tsx as part of the incremental UI split.

import { useState } from "react";
import { XN } from "../lib/xnPalette";
export function EpgWidget({
  tenants,
  onClose,
}: {
  tenants: Array<{ tenant_name: string; epg_count?: number; epg: any[] }>;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalEpgs = tenants.reduce((s, t) => s + (t.epg?.length ?? 0), 0);
  const emptyCount = tenants.filter((t) => (t.epg?.length ?? 0) === 0).length;

  // Shorten vCenter-style names: keep last _Segment
  const shortName = (name: string) => {
    if (name.startsWith("vCenter_") && name.includes("_")) {
      return name.split("_").pop() ?? name;
    }
    return name;
  };

  const stateLabel = (s: string) =>
    s === "epg-with-ctag-range" ? "ctag-range" : s;

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Endpoint Groups</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 3 }}>
            {totalEpgs} EPG{totalEpgs !== 1 ? "s" : ""} across {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
            {emptyCount > 0 && <>&nbsp;·&nbsp;{emptyCount} tenant{emptyCount !== 1 ? "s" : ""} empty</>}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Per-tenant sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {tenants.map((t, ti) => {
          const epgs: any[] = t.epg ?? [];
          return (
            <div key={ti}>
              {/* Tenant label row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{t.tenant_name}</span>
                <span style={{
                  background: epgs.length > 0 ? "rgba(137,129,229,0.15)" : "var(--divider)",
                  border: `1px solid ${epgs.length > 0 ? "rgba(137,129,229,0.35)" : "var(--subtle-border)"}`,
                  color: epgs.length > 0 ? XN.accent : "rgba(255,255,255,0.28)",
                  borderRadius: 8, padding: "1px 8px", fontSize: 11, fontWeight: 600,
                }}>{epgs.length} EPG{epgs.length !== 1 ? "s" : ""}</span>
              </div>

              {epgs.length === 0 ? (
                <div style={{ fontSize: 11, opacity: 0.28, paddingLeft: 2, paddingBottom: 2 }}>No endpoint groups configured</div>
              ) : (
                <div style={{ border: "1px solid var(--subtle-border)", borderRadius: 8, overflow: "hidden", background: "var(--subtle-bg)" }}>
                  {epgs.map((epg: any, ei: number) => {
                    const key = `${ti}-${ei}`;
                    const isOpen = expanded === key;
                    const netProps: any[] = epg["network-policy"]?.["network-property"] ?? [];
                    const ctagRange: string = epg["network-policy"]?.["ctag-range"] ?? "—";
                    const swMode: string = epg["port-property"]?.["switchport-mode"] ?? "—";
                    const short = shortName(epg.name);
                    const truncated = short !== epg.name;

                    return (
                      <div key={ei} style={{ borderBottom: ei < epgs.length - 1 ? "1px solid var(--divider)" : "none" }}>

                        {/* EPG row */}
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", cursor: netProps.length > 0 ? "pointer" : "default" }}
                          onClick={() => netProps.length > 0 && setExpanded(isOpen ? null : key)}
                        >
                          {/* Name */}
                          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5 }}>
                            <span
                              title={truncated ? epg.name : undefined}
                              style={{ fontWeight: 600, fontSize: 12, fontFamily: "monospace", opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >{short}</span>
                            {truncated && <span style={{ fontSize: 9, opacity: 0.3, flexShrink: 0 }}>vCenter</span>}
                          </div>

                          {/* CTAG range */}
                          <span style={{ background: "rgba(91,191,170,0.12)", border: "1px solid rgba(91,191,170,0.28)", color: XN.teal, borderRadius: 7, padding: "2px 8px", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                            ctag {ctagRange}
                          </span>

                          {/* Switchport mode */}
                          <span style={{ fontSize: 10, opacity: 0.38, flexShrink: 0 }}>{swMode}</span>

                          {/* State */}
                          <span style={{ fontSize: 10, opacity: 0.3, flexShrink: 0 }}>{stateLabel(epg.state ?? "")}</span>

                          {/* Expand indicator */}
                          {netProps.length > 0 && (
                            <span style={{ fontSize: 10, opacity: 0.35, flexShrink: 0 }}>{isOpen ? "▲" : `▼ ${netProps.length}`}</span>
                          )}
                        </div>

                        {/* Expanded: network properties */}
                        {isOpen && netProps.length > 0 && (
                          <div style={{ background: "rgba(0,0,0,0.22)", borderTop: "1px solid var(--subtle-bg)", padding: "9px 13px" }}>
                            <div style={{ fontSize: 9, opacity: 0.35, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>
                              Network Properties — {netProps.length} ctag{netProps.length !== 1 ? "s" : ""}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {netProps.map((np: any, npi: number) => (
                                <div
                                  key={npi}
                                  title={np["ctag-description"] ?? ""}
                                  style={{ background: "rgba(137,129,229,0.09)", border: "1px solid rgba(137,129,229,0.22)", borderRadius: 6, padding: "4px 10px", fontSize: 11 }}
                                >
                                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: XN.accentSoft }}>ctag {np.ctag}</span>
                                  {np["suppress-arp"] === "true" && (
                                    <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 9 }}>arp-suppressed</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

