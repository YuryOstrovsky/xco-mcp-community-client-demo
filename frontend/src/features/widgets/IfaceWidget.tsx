// Interface Status widget — donut chart + sortable/filterable table of
// switch interfaces (Up/Down/All).
//
// Pure presentational: parent unwraps the API payload itself by passing
// raw, and owns the filter + sort state and the close callback. Pie
// animation suppression is wired via `animatePie`.
//
// Extracted from App.tsx.

import { Panel } from "../../components/Panel";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

export interface IfaceSortState {
  col: string;
  dir: "asc" | "desc";
}

export interface IfaceWidgetProps {
  open: boolean;
  /** Raw API response (resp.raw). */
  raw: any;
  filter: "all" | "up" | "down";
  setFilter: (f: "all" | "up" | "down") => void;
  sort: IfaceSortState;
  setSort: (updater: (prev: IfaceSortState) => IfaceSortState) => void;
  /** Whether the pie should animate (off when streaming an execution). */
  animatePie: boolean;
  onClose: () => void;
}

export function IfaceWidget({
  open, raw, filter, setFilter, sort, setSort, animatePie, onClose,
}: IfaceWidgetProps) {
  if (!open) return null;
  const payloadIf: any = raw?.result?.payload ?? raw?.payload ?? {};
  const metaIf: any = payloadIf?.meta ?? {};
  const summaryIf: any = payloadIf?.summary ?? {};
  const itemsIf: any[] = Array.isArray(payloadIf?.items) ? payloadIf.items : [];

  const switchIpIf: string = metaIf?.switch_ip ?? "";
  const totalIf: number = summaryIf?.total_interfaces ?? summaryIf?.total ?? itemsIf.length;

  const _isIfaceUp = (x: any): boolean => {
    const os = String(x?.oper_status ?? "").toLowerCase();
    if (os === "up" || os === "online") return true;
    if (os === "down" || os === "offline") return false;
    const lp = String(x?.line_protocol ?? "").toLowerCase();
    if (lp === "up") return true;
    if (lp === "down") return false;
    const t = String(x?.type ?? "").toLowerCase();
    if (t.includes("management")) return true;
    return String(x?.shutdown ?? "").toLowerCase() !== "true";
  };

  const activeIf: number = itemsIf.filter(_isIfaceUp).length;
  const downIf: number = totalIf - activeIf;

  const pieData = [
    { name: "Up", value: activeIf },
    { name: "Down", value: downIf },
  ].filter((d) => d.value > 0);

  const filteredItems = itemsIf.filter((x: any) => {
    if (filter === "up") return _isIfaceUp(x);
    if (filter === "down") return !_isIfaceUp(x);
    return true;
  });

  const padNums = (s: string) => s.replace(/\d+/g, (n) => n.padStart(6, "0"));

  const sortedItems = [...filteredItems].sort((a: any, b: any) => {
    const col = sort.col;
    let av: any = col === "status" ? (_isIfaceUp(a) ? 0 : 1)
      : col === "name" ? padNums((String(a?.type ?? "") + "_" + String(a?.name ?? "")).toLowerCase())
      : (a?.[col] ?? "");
    let bv: any = col === "status" ? (_isIfaceUp(b) ? 0 : 1)
      : col === "name" ? padNums((String(b?.type ?? "") + "_" + String(b?.name ?? "")).toLowerCase())
      : (b?.[col] ?? "");
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });

  const sortToggle = (col: string) =>
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );

  const sortIcon = (col: string) =>
    sort.col !== col ? " ↕" : sort.dir === "asc" ? " ↑" : " ↓";

  return (
    <Panel key="if-inline" title="Interface Status" onClose={onClose}>
      <p style={{ marginTop: 0, opacity: 0.85 }}>
        {switchIpIf || "switch"} — {activeIf} up, {downIf} down, {totalIf} total
      </p>

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip cursor={{ fill: "transparent" }} />
            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2} isAnimationActive={animatePie}>
              {pieData.map((_, idx) => (
                <Cell key={idx} fill={idx === 0 ? "var(--accent)" : "rgba(137,129,229,0.35)"} stroke="var(--subtle-border)" />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {(["all", "up", "down"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? "var(--accent)" : "transparent",
              border: "1px solid var(--border)",
              color: filter === f ? "#0b0b0f" : "var(--text)",
              borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {f === "all" ? `All (${totalIf})` : f === "up" ? `Up (${activeIf})` : `Down (${downIf})`}
          </button>
        ))}
      </div>

      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 360 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {([
                { col: "name", label: "Interface" },
                { col: "status", label: "Status" },
                { col: "description", label: "Description" },
                { col: "ip_addresses", label: "IP Address" },
                { col: "channel_group", label: "Ch-Group" },
              ] as const).map(({ col, label }) => (
                <th
                  key={col}
                  onClick={() => sortToggle(col)}
                  style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", opacity: 0.9, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--bg1)", zIndex: 1 }}
                >
                  {label}{sortIcon(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: "24px 10px", textAlign: "center", opacity: 0.4 }}>No interfaces match the current filter</td></tr>
            ) : sortedItems.map((iface: any, i: number) => {
              const isDown = !_isIfaceUp(iface);
              const ips: string[] = Array.isArray(iface?.ip_addresses)
                ? iface.ip_addresses
                : iface?.ip_address ? [iface.ip_address] : [];
              const rawName = String(iface?.name ?? "").trim();
              const ifType = String(iface?.type ?? "").toLowerCase().replace(/[-\s]/g, "_");
              const displayName = !rawName ? "—"
                : ifType.includes("management") ? `Management ${rawName}`
                : ifType.includes("ethernet") ? `Ethernet ${rawName}`
                : ifType.includes("port_channel") ? `Port-channel ${rawName}`
                : rawName;
              return (
                <tr key={i}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--divider)", opacity: 0.95, whiteSpace: "nowrap" }}>
                    {displayName}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--divider)", opacity: 0.95, whiteSpace: "nowrap" }}>
                    {isDown ? "Down" : "Up"}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--divider)", opacity: 0.95, whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={iface?.description ?? ""}>
                    {iface?.description || "—"}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--divider)", opacity: 0.95, whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>
                    {ips.length ? ips.join(", ") : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--divider)", opacity: 0.95, whiteSpace: "nowrap" }}>
                    {iface?.channel_group || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
