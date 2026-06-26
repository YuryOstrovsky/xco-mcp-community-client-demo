// TenantWidget — extracted from App.tsx as part of the incremental UI split.

import { useState } from "react";
import { XN } from "../lib/xnPalette";
export function TenantWidget({
  tenants,
  onClose,
}: {
  tenants: any[];
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const typeBadge = (type: string) => {
    if (String(type || "").toLowerCase() === "shared")
      return { bg: "rgba(91,191,170,0.15)", border: "rgba(91,191,170,0.35)", color: XN.teal };
    return { bg: "rgba(137,129,229,0.15)", border: "rgba(137,129,229,0.35)", color: XN.accent };
  };

  const portDot = (admin: string, oper: string) => {
    if (admin === "up" && oper === "up") return "rgba(60,220,120,0.9)";
    if (admin === "down") return "rgba(255,255,255,0.25)";
    return "#ef4444";
  };

  const privateCount = tenants.filter((t) => String(t.type || "").toLowerCase() === "private").length;
  const sharedCount  = tenants.filter((t) => String(t.type || "").toLowerCase() === "shared").length;

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Tenants</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 3 }}>
            {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
            {privateCount > 0 && <>&nbsp;·&nbsp;{privateCount} private</>}
            {sharedCount  > 0 && <>&nbsp;·&nbsp;{sharedCount} shared</>}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Tenant cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tenants.map((tenant: any, i: number) => {
          const tb = typeBadge(tenant.type);
          const devices: any[] = tenant.DeviceDetails ?? [];
          const fabrics: string[] = tenant["fabric-list"] ?? (tenant.fabric ?? []).map((f: any) => f.name);
          const epgs: string[]    = tenant["epg-list"] ?? [];
          const isOpen = expanded === i;

          return (
            <div key={i} style={{ border: "1px solid var(--subtle-border)", borderRadius: 10, overflow: "hidden", background: "var(--subtle-bg)" }}>

              {/* Card header row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
                {/* ID bubble */}
                <div style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: "rgba(137,129,229,0.18)", border: "1px solid rgba(137,129,229,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: XN.accent, flexShrink: 0,
                }}>{tenant.id}</div>

                {/* Name */}
                <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{tenant.name}</div>

                {/* Type badge */}
                <span style={{ background: tb.bg, border: `1px solid ${tb.border}`, color: tb.color, borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>
                  {String(tenant.type || "—")}
                </span>

                {/* Expand toggle — only when devices present */}
                {devices.length > 0 && (
                  <button
                    onClick={() => setExpanded(isOpen ? null : i)}
                    style={{ background: "var(--divider)", border: "1px solid var(--subtle-border)", color: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}
                  >{isOpen ? "▲" : `▼ ${devices.length} device${devices.length !== 1 ? "s" : ""}`}</button>
                )}
              </div>

              {/* Meta strip */}
              {(tenant["vlan-range"] || tenant["l2-vni-capacity"] != null || fabrics.length > 0 || epgs.length > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", padding: "0 14px 12px", borderTop: "1px solid var(--subtle-bg)" }}>
                  {tenant["vlan-range"] && (
                    <div>
                      <span style={{ fontSize: 9, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.8, marginRight: 5 }}>VLAN</span>
                      <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>{tenant["vlan-range"]}</span>
                    </div>
                  )}
                  {tenant["l2-vni-capacity"] != null && (
                    <div>
                      <span style={{ fontSize: 9, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.8, marginRight: 5 }}>L2 VNI cap</span>
                      <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>{tenant["l2-vni-capacity"]}</span>
                    </div>
                  )}
                  {fabrics.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 9, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.8 }}>Fabric</span>
                      {fabrics.map((f: string, fi: number) => (
                        <span key={fi} style={{ background: "rgba(91,191,170,0.12)", border: "1px solid rgba(91,191,170,0.3)", color: XN.teal, borderRadius: 8, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>{f}</span>
                      ))}
                    </div>
                  )}
                  {epgs.length > 0 && (
                    <div>
                      <span style={{ fontSize: 9, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.8, marginRight: 5 }}>EPGs</span>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{epgs.length}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Device details (expandable) */}
              {isOpen && devices.length > 0 && (
                <div style={{ borderTop: "1px solid var(--subtle-border)", background: "rgba(0,0,0,0.18)" }}>
                  {devices.map((dev: any, di: number) => {
                    const ports: any[] = dev.PortDetails ?? [];
                    return (
                      <div key={di} style={{ borderBottom: di < devices.length - 1 ? "1px solid var(--subtle-bg)" : "none", padding: "10px 14px" }}>
                        {/* Device header */}
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, marginBottom: ports.length > 0 ? 8 : 0 }}>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{dev["host-name"]}</span>
                          <span style={{ fontSize: 10, opacity: 0.45, fontFamily: "monospace" }}>{dev["mgmt-ip"]}</span>
                          <span style={{ background: "rgba(137,129,229,0.12)", border: "1px solid rgba(137,129,229,0.25)", color: XN.accentSoft, borderRadius: 8, padding: "1px 7px", fontSize: 10 }}>{dev.role}</span>
                          <span style={{ fontSize: 10, opacity: 0.4 }}>{dev["chassis-name"]}</span>
                          {dev["multihomed-neighbour"] && (
                            <span style={{ fontSize: 10, opacity: 0.38 }}>↔ {dev["multihomed-neighbour"]}</span>
                          )}
                        </div>
                        {/* Port chips */}
                        {ports.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {ports.map((p: any, pi: number) => (
                              <div
                                key={pi}
                                title={`${p.name} · admin: ${p["admin-status"]} · oper: ${p["oper-status"]}${p["actual-line-speed"] && p["actual-line-speed"] !== "unknown" ? ` · ${p["actual-line-speed"]}` : ""}`}
                                style={{ display: "flex", alignItems: "center", gap: 5, background: "var(--subtle-bg)", border: "1px solid var(--subtle-border)", borderRadius: 6, padding: "3px 8px", fontSize: 11 }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: portDot(p["admin-status"], p["oper-status"]), flexShrink: 0, display: "inline-block" }} />
                                <span style={{ fontFamily: "monospace", opacity: 0.85 }}>{p.name}</span>
                                <span style={{ fontSize: 9, opacity: 0.4 }}>{p["port-type"]}</span>
                              </div>
                            ))}
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

