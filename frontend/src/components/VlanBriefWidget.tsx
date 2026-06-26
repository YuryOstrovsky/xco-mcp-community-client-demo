// VlanBriefWidget — extracted from App.tsx as part of the incremental UI split.

import { useState } from "react";
export function VlanBriefWidget({
  items,
  summary,
  switchIp,
  onClose,
}: {
  items: any[];
  summary: any;
  switchIp: string;
  onClose: () => void;
}) {
  const [expandedVlan, setExpandedVlan] = useState<string | null>(null);

  const configured: number = summary?.configured_vlans_count ?? items.length;
  const provisioned: number = summary?.provisioned_vlans_count ?? 0;
  const withMembers: number = summary?.vlans_with_members ?? 0;
  const membersTotal: number = summary?.members_total ?? 0;
  const hasMore: boolean = summary?.has_more === true;

  const tagColor = (tag: string) => {
    const v = String(tag || "").toLowerCase();
    if (v === "tagged") return "rgba(137,129,229,0.85)";
    if (v === "untagged") return "rgba(60,220,120,0.75)";
    return "rgba(200,200,200,0.5)";
  };

  const statePill = (state: string) => {
    const v = String(state || "").toLowerCase();
    const bg = v === "active" ? "rgba(60,220,120,0.12)" : "rgba(255,80,80,0.12)";
    const border = v === "active" ? "rgba(60,220,120,0.35)" : "rgba(255,80,80,0.35)";
    const color = v === "active" ? "rgba(60,220,120,0.9)" : "rgba(255,80,80,0.9)";
    return { bg, border, color };
  };

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 600 }}>VLAN Brief</div>
          <div className="text-xs" style={{ opacity: 0.55, marginTop: 2 }}>
            {switchIp || "switch"}&nbsp;·&nbsp;{configured} VLAN{configured !== 1 ? "s" : ""} configured
            {hasMore ? " (truncated)" : ""}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
        >✕</button>
      </div>

      {/* summary stats */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Configured", value: configured },
          { label: "Provisioned", value: provisioned },
          { label: "With Members", value: withMembers },
          { label: "Total Ports", value: membersTotal },
        ].map(({ label, value }) => (
          <div key={label} style={{
            flex: "1 1 80px", background: "var(--subtle-bg)", border: "1px solid var(--subtle-border)",
            borderRadius: 8, padding: "8px 12px", textAlign: "center",
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{value}</div>
            <div className="text-xs" style={{ opacity: 0.5, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* table */}
      {items.length === 0 ? (
        <div className="text-xs" style={{ opacity: 0.5, textAlign: "center", padding: "12px 0" }}>No VLANs returned.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--subtle-border)" }}>
                {["ID", "Name", "Type", "State", "Members", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", opacity: 0.5, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((vlan: any) => {
                const vid = String(vlan.vlan_id ?? vlan["vlan-id"] ?? "");
                const name = vlan.vlan_name ?? vlan.details?.["vlan-name"] ?? "—";
                const type = vlan.details?.["vlan-type"] ?? "—";
                const state = vlan.details?.["vlan-state"] ?? "—";
                const count: number = vlan.members_count ?? (vlan.members?.length ?? 0);
                const members: any[] = Array.isArray(vlan.members) ? vlan.members : [];
                const expanded = expandedVlan === vid;
                const sp = statePill(state);
                return (
                  <>
                    <tr
                      key={vid}
                      style={{ borderBottom: expanded ? "none" : "1px solid var(--subtle-bg)", cursor: count > 0 ? "pointer" : "default" }}
                      onClick={() => count > 0 && setExpandedVlan(expanded ? null : vid)}
                    >
                      <td style={{ padding: "7px 10px", fontWeight: 700, fontFamily: "monospace" }}>{vid}</td>
                      <td style={{ padding: "7px 10px" }}>{name}</td>
                      <td style={{ padding: "7px 10px", opacity: 0.7 }}>{type}</td>
                      <td style={{ padding: "7px 10px" }}>
                        <span style={{
                          background: sp.bg, border: `1px solid ${sp.border}`,
                          color: sp.color, borderRadius: 12, padding: "2px 9px", fontSize: 11, fontWeight: 600,
                        }}>{state}</span>
                      </td>
                      <td style={{ padding: "7px 10px", opacity: 0.8 }}>{count}</td>
                      <td style={{ padding: "7px 10px", opacity: 0.4, fontSize: 10 }}>
                        {count > 0 ? (expanded ? "▲" : "▼") : ""}
                      </td>
                    </tr>
                    {expanded && members.map((m: any, mi: number) => (
                      <tr key={`${vid}-m-${mi}`} style={{ background: "rgba(137,129,229,0.05)", borderBottom: mi === members.length - 1 ? "1px solid var(--subtle-bg)" : "none" }}>
                        <td colSpan={2} style={{ padding: "5px 10px 5px 24px", fontFamily: "monospace", fontSize: 11, opacity: 0.85 }}>
                          {m.display ?? `${m.interface_type ?? ""} ${m.interface_name ?? ""}`}
                        </td>
                        <td style={{ padding: "5px 10px", fontSize: 11, opacity: 0.6 }}>{m.interface_type ?? "—"}</td>
                        <td style={{ padding: "5px 10px" }}>
                          <span style={{
                            background: "rgba(137,129,229,0.1)", border: `1px solid ${tagColor(m.tag)}`,
                            color: tagColor(m.tag), borderRadius: 10, padding: "1px 8px", fontSize: 10, fontWeight: 600,
                          }}>{m.tag ?? "—"}</span>
                        </td>
                        <td colSpan={2} style={{ padding: "5px 10px", fontSize: 11, opacity: 0.55, fontFamily: "monospace" }}>
                          {(m.classifications ?? []).join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

