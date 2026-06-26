// ArpTableWidget — extracted from App.tsx as part of the incremental UI split.

import { useState } from "react";
export function ArpTableWidget({
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
  const [sortCol, setSortCol] = useState<"ip" | "mac" | "interface" | "age" | "type">("ip");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const totalEntries  = summary?.returned ?? items.length;
  const uniqueIps     = summary?.unique_ips ?? totalEntries;
  const uniqueMacs    = summary?.unique_macs ?? totalEntries;

  // Parse "HH:MM:SS" → total seconds
  const ageToSecs = (age: string): number => {
    const parts = String(age ?? "").split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 9999999;
  };

  // Age freshness colouring
  const ageFreshness = (secs: number): string => {
    if (secs <= 60)   return "var(--accent-egress)";   // teal — very fresh
    if (secs <= 600)  return "var(--accent)";           // lavender — recent
    return "var(--warn)";                               // orange — aging
  };

  // Sort comparator
  const sorted = [...items].sort((a, b) => {
    let va: any, vb: any;
    if (sortCol === "ip") {
      // numeric IP sort
      const toNum = (ip: string) => ip.split(".").reduce((acc: number, o: string) => acc * 256 + parseInt(o || "0"), 0);
      va = toNum(a.ip_address ?? ""); vb = toNum(b.ip_address ?? "");
    } else if (sortCol === "age") {
      va = ageToSecs(a.age); vb = ageToSecs(b.age);
    } else if (sortCol === "interface") {
      va = a.interface_short ?? a.interface ?? ""; vb = b.interface_short ?? b.interface ?? "";
    } else if (sortCol === "mac") {
      va = a.mac_address ?? ""; vb = b.mac_address ?? "";
    } else {
      va = a.type ?? ""; vb = b.type ?? "";
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const hdStyle: React.CSSProperties = {
    fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
    opacity: 0.5, paddingBottom: 8, cursor: "pointer", userSelect: "none",
    whiteSpace: "nowrap",
  };
  const arrow = (col: typeof sortCol) => sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const colMono: React.CSSProperties = { fontFamily: "ui-monospace,monospace", fontSize: 12 };

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>ARP Table</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 3 }}>
            {switchIp && <>{switchIp} &nbsp;·&nbsp;</>}
            {totalEntries} {totalEntries === 1 ? "entry" : "entries"}&nbsp;·&nbsp;
            {uniqueIps} unique IPs&nbsp;·&nbsp;{uniqueMacs} unique MACs
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Summary stat row */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid var(--border)", paddingBottom: 20 }}>
        {[
          { label: "Entries",     val: String(totalEntries),                       color: "var(--text)" },
          { label: "Unique IPs",  val: String(uniqueIps),                          color: "var(--accent)" },
          { label: "Unique MACs", val: String(uniqueMacs),                         color: "var(--accent-egress)" },
        ].map(({ label, val, color }, i) => (
          <div key={label} style={{ flex: 1, paddingLeft: i > 0 ? 16 : 0, borderLeft: i > 0 ? "1px solid var(--border)" : "none" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.5, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 300, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.5, textAlign: "center", padding: "24px 0" }}>No ARP entries returned.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {(["ip", "mac", "interface", "age", "type"] as const).map(col => (
                  <th key={col} style={{ ...hdStyle, textAlign: "left", paddingRight: 16 }} onClick={() => toggleSort(col)}>
                    {col === "ip" ? "IP Address" : col === "mac" ? "MAC" : col === "interface" ? "Interface" : col === "age" ? "Age" : "Type"}
                    {arrow(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row: any, i: number) => {
                const secs = ageToSecs(row.age ?? "");
                const ageColor = ageFreshness(secs);
                const isDynamic = (row.type ?? "dynamic") === "dynamic";
                return (
                  <tr
                    key={row.ip_address ?? i}
                    style={{ borderBottom: "1px solid var(--subtle-bg)", background: i % 2 === 0 ? "transparent" : "var(--subtle-bg)" }}
                  >
                    <td style={{ ...colMono, paddingTop: 8, paddingBottom: 8, paddingRight: 16, color: "var(--accent)", whiteSpace: "nowrap" }}>
                      {row.ip_address}
                    </td>
                    <td style={{ ...colMono, paddingTop: 8, paddingBottom: 8, paddingRight: 16, opacity: 0.75, whiteSpace: "nowrap" }}>
                      {row.mac_address}
                    </td>
                    <td style={{ ...colMono, paddingTop: 8, paddingBottom: 8, paddingRight: 16, whiteSpace: "nowrap" }}>
                      {row.interface_short || row.interface || "—"}
                    </td>
                    <td style={{ ...colMono, paddingTop: 8, paddingBottom: 8, paddingRight: 16, color: ageColor, whiteSpace: "nowrap" }}>
                      {row.age || "—"}
                    </td>
                    <td style={{ paddingTop: 8, paddingBottom: 8 }}>
                      <span style={{
                        fontSize: 11, padding: "1px 7px", borderRadius: 4, fontWeight: 600,
                        background: isDynamic ? "rgba(139,143,216,0.12)" : "rgba(232,146,74,0.12)",
                        border: `1px solid ${isDynamic ? "var(--accent)" : "var(--warn)"}`,
                        color: isDynamic ? "var(--accent)" : "var(--warn)",
                      }}>
                        {row.type || "dynamic"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

