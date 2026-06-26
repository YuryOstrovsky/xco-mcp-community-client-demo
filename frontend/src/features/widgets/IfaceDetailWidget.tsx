// Interface Detail widget — richer cousin of IfaceWidget with two tabs
// (Overview + Traffic Counters) and partial/up/down classification.
//
// Pure presentational: parent passes the raw API response and owns the
// filter / sort / tab state.
//
// Extracted from App.tsx.

import { Panel } from "../../components/Panel";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

export interface IfaceDetailSortState {
  col: string;
  dir: "asc" | "desc";
}

export interface IfaceDetailWidgetProps {
  open: boolean;
  raw: any;
  filter: "all" | "up" | "partial" | "down";
  setFilter: (f: "all" | "up" | "partial" | "down") => void;
  tab: "overview" | "traffic";
  setTab: (t: "overview" | "traffic") => void;
  sort: IfaceDetailSortState;
  setSort: (updater: (prev: IfaceDetailSortState) => IfaceDetailSortState) => void;
  animatePie: boolean;
  onClose: () => void;
}

export function IfaceDetailWidget({
  open, raw, filter, setFilter, tab, setTab, sort, setSort, animatePie, onClose,
}: IfaceDetailWidgetProps) {
  if (!open) return null;
  const payloadDet: any = raw?.result?.payload ?? raw?.payload ?? {};
  const metaDet: any = payloadDet?.meta ?? {};
  const itemsDet: any[] = Array.isArray(payloadDet?.items) ? payloadDet.items : [];

  const switchIpDet: string = metaDet?.switch_ip ?? "";

  const _detIfState = (x: any): "up" | "partial" | "down" => {
    const ifs = String(x?.if_state ?? "").toLowerCase();
    const lps = String(x?.line_protocol_state ?? "").toLowerCase();
    if (ifs === "up" && lps === "up") return "up";
    if (ifs === "up" && lps !== "up") return "partial";
    return "down";
  };

  const upDet = itemsDet.filter((x) => _detIfState(x) === "up").length;
  const partialDet = itemsDet.filter((x) => _detIfState(x) === "partial").length;
  const downDet = itemsDet.filter((x) => _detIfState(x) === "down").length;
  const totalDet = itemsDet.length;

  const pieDet = [
    { name: "Up", value: upDet },
    { name: "Partial", value: partialDet },
    { name: "Down", value: downDet },
  ].filter((d) => d.value > 0);
  const PIE_COLORS_DET = ["var(--accent)", "rgba(255,180,0,0.8)", "rgba(137,129,229,0.35)"];

  const filteredDet = itemsDet.filter((x: any) => {
    const st = _detIfState(x);
    if (filter === "up") return st === "up";
    if (filter === "partial") return st === "partial";
    if (filter === "down") return st === "down";
    return true;
  });

  const padNums = (s: string) => s.replace(/\d+/g, (n) => n.padStart(6, "0"));

  const sortedDet = [...filteredDet].sort((a: any, b: any) => {
    const col = sort.col;
    const stateOrd = { up: 0, partial: 1, down: 2 };
    let av: any = col === "status"
      ? stateOrd[_detIfState(a)]
      : col === "name"
        ? padNums(String(a?.if_name ?? "").toLowerCase())
        : col === "in_bytes" ? (a?.counters?.ifHCInOctets ?? 0)
        : col === "out_bytes" ? (a?.counters?.ifHCOutOctets ?? 0)
        : (a?.[col] ?? "");
    let bv: any = col === "status"
      ? stateOrd[_detIfState(b)]
      : col === "name"
        ? padNums(String(b?.if_name ?? "").toLowerCase())
        : col === "in_bytes" ? (b?.counters?.ifHCInOctets ?? 0)
        : col === "out_bytes" ? (b?.counters?.ifHCOutOctets ?? 0)
        : (b?.[col] ?? "");
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });

  const detSortToggle = (col: string) =>
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );
  const detSortIcon = (col: string) =>
    sort.col !== col ? " ↕" : sort.dir === "asc" ? " ↑" : " ↓";

  const fmtBytes = (n: number): string => {
    if (!n) return "0";
    if (n >= 1e12) return (n / 1e12).toFixed(1) + " TB";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
    return String(n);
  };
  const fmtNum = (n: number): string => {
    if (!n) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  };

  const stateColor = (st: "up" | "partial" | "down") =>
    st === "up" ? "var(--accent)" : st === "partial" ? "rgba(255,180,0,0.9)" : "rgba(137,129,229,0.7)";

  const tdStyle: React.CSSProperties = { padding: "7px 10px", borderBottom: "1px solid var(--divider)", whiteSpace: "nowrap", opacity: 0.95 };
  const thStyle: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", opacity: 0.9, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--bg1)", zIndex: 1 };

  return (
    <Panel key="if-detail-inline" title="Interface Detail" onClose={onClose}>
      <p style={{ marginTop: 0, opacity: 0.85 }}>
        {switchIpDet || "switch"} — {upDet} up, {partialDet > 0 ? `${partialDet} partial, ` : ""}{downDet} down, {totalDet} total
      </p>

      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip cursor={{ fill: "transparent" }} />
            <Pie data={pieDet} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2} isAnimationActive={animatePie}>
              {pieDet.map((_, idx) => (
                <Cell key={idx} fill={PIE_COLORS_DET[idx % PIE_COLORS_DET.length]} stroke="var(--subtle-border)" />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {(["all", "up", "partial", "down"] as const).map((f) => {
          const count = f === "all" ? totalDet : f === "up" ? upDet : f === "partial" ? partialDet : downDet;
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: active ? "var(--accent)" : "transparent",
                border: "1px solid var(--border)",
                color: active ? "#0b0b0f" : "var(--text)",
                borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {f === "all" ? `All (${count})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${count})`}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
        {(["overview", "traffic"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t ? "var(--accent)" : "var(--text)",
              padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            {t === "overview" ? "Overview" : "Traffic Counters"}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 380 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {([
                  { col: "name", label: "Interface" },
                  { col: "status", label: "State / Proto" },
                  { col: "port_mode", label: "Mode" },
                  { col: "port_role", label: "Role" },
                  { col: "actual_line_speed", label: "Speed" },
                  { col: "mac", label: "MAC" },
                  { col: "mtu", label: "MTU" },
                  { col: "ip_mtu", label: "IP MTU" },
                  { col: "description", label: "Description" },
                ] as const).map(({ col, label }) => (
                  <th key={col} onClick={() => detSortToggle(col)} style={thStyle}>
                    {label}{detSortIcon(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedDet.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: "24px 10px", textAlign: "center", opacity: 0.4 }}>No interfaces match the current filter</td></tr>
              ) : sortedDet.map((iface: any, i: number) => {
                const st = _detIfState(iface);
                const ifs = String(iface?.if_state ?? "—");
                const lps = String(iface?.line_protocol_state ?? "—");
                return (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{iface?.if_name || "—"}</td>
                    <td style={tdStyle}>
                      <span style={{ color: stateColor(st), fontWeight: 600 }}>{ifs}</span>
                      <span style={{ opacity: 0.55 }}> / </span>
                      <span style={{ color: stateColor(lps === "up" ? "up" : "down"), fontWeight: 600 }}>{lps}</span>
                    </td>
                    <td style={tdStyle}>{iface?.port_mode || "—"}</td>
                    <td style={tdStyle}>{iface?.port_role || "—"}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{iface?.actual_line_speed && iface.actual_line_speed !== "nil" ? iface.actual_line_speed : "—"}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{iface?.mac || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{iface?.mtu != null ? iface.mtu : "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{iface?.ip_mtu != null ? iface.ip_mtu : "—"}</td>
                    <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={iface?.description ?? ""}>{iface?.description || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "traffic" && (
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 380 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {([
                  { col: "name", label: "Interface" },
                  { col: "in_bytes", label: "In Bytes" },
                  { col: "in_ucast", label: "In Unicast" },
                  { col: "in_mcast", label: "In Mcast" },
                  { col: "in_bcast", label: "In Bcast" },
                  { col: "in_err", label: "In Errors" },
                  { col: "out_bytes", label: "Out Bytes" },
                  { col: "out_ucast", label: "Out Unicast" },
                  { col: "out_mcast", label: "Out Mcast" },
                  { col: "out_bcast", label: "Out Bcast" },
                  { col: "out_err", label: "Out Errors" },
                ] as const).map(({ col, label }) => (
                  <th key={col} onClick={() => detSortToggle(col)} style={{ ...thStyle, textAlign: col === "name" ? "left" : "right" }}>
                    {label}{detSortIcon(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedDet.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: "24px 10px", textAlign: "center", opacity: 0.4 }}>No interfaces match the current filter</td></tr>
              ) : sortedDet.map((iface: any, i: number) => {
                const c = iface?.counters ?? {};
                const hasTraffic = (c.ifHCInOctets ?? 0) > 0 || (c.ifHCOutOctets ?? 0) > 0;
                return (
                  <tr key={i} style={{ opacity: hasTraffic ? 1 : 0.45 }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{iface?.if_name || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtBytes(c.ifHCInOctets ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtNum(c.ifHCInUcastPkts ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtNum(c.ifHCInMulticastPkts ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtNum(c.ifHCInBroadcastPkts ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12, color: (c.ifHCInErrors ?? 0) > 0 ? "rgba(255,80,80,0.9)" : undefined }}>{fmtNum(c.ifHCInErrors ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtBytes(c.ifHCOutOctets ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtNum(c.ifHCOutUcastPkts ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtNum(c.ifHCOutMulticastPkts ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{fmtNum(c.ifHCOutBroadcastPkts ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", fontSize: 12, color: (c.ifHCOutErrors ?? 0) > 0 ? "rgba(255,80,80,0.9)" : undefined }}>{fmtNum(c.ifHCOutErrors ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
