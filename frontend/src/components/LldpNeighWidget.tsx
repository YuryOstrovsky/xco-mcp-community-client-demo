// LldpNeighWidget — renders the LLDP-neighbors tool-result payload.

import { useState } from "react";
export function LldpNeighWidget({
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
  const [selected, setSelected] = useState<number | null>(null);

  const neighborCount  = summary?.neighbors ?? items.length;
  const uniqueSystems  = summary?.unique_remote_systems ?? neighborCount;

  // Classify by name to pick colour
  const classify = (name: string): "leaf" | "border" | "spine" | "other" => {
    const n = name.toLowerCase();
    if (n.includes("leaf"))                           return "leaf";
    if (n.includes("br") || n.includes("border"))    return "border";
    if (n.includes("spine"))                          return "spine";
    return "other";
  };

  const NODE_COLORS: Record<string, { stroke: string; fill: string; edge: string }> = {
    leaf:   { stroke: "#8981E5", fill: "rgba(137,129,229,0.13)", edge: "rgba(137,129,229,0.40)" },
    border: { stroke: "#5BBFAA", fill: "rgba(91,187,170,0.13)",  edge: "rgba(91,187,170,0.40)"  },
    spine:  { stroke: "#E8924A", fill: "rgba(232,146,74,0.13)",  edge: "rgba(232,146,74,0.40)"  },
    other:  { stroke: "rgba(255,255,255,0.55)", fill: "var(--divider)", edge: "rgba(255,255,255,0.20)" },
  };

  // Shorten port strings: "Ethernet 0/50" → "0/50", "Eth 0/25" → "0/25"
  const shortPort = (p: string) => p.replace(/^ethernet\s*/i, "").replace(/^eth\s*/i, "").trim();

  // Star layout geometry
  const SVG_W = 600, SVG_H = 420;
  const cx = SVG_W / 2, cy = SVG_H / 2 - 10;
  const RADIUS = 150;
  const NODE_R = 22;

  const nodes = items.map((item, i) => {
    const angle = (-Math.PI / 2) + (2 * Math.PI * i) / items.length;
    const nx = cx + RADIUS * Math.cos(angle);
    const ny = cy + RADIUS * Math.sin(angle);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const kind = classify(item.remote_system_name ?? "");
    const colors = NODE_COLORS[kind];
    return { ...item, nx, ny, ux, uy, kind, colors, angle };
  });

  const selItem = selected !== null ? nodes[selected] : null;

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>LLDP Neighbors</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 3 }}>
            {switchIp && <>{switchIp} &nbsp;·&nbsp;</>}
            {neighborCount} {neighborCount === 1 ? "neighbor" : "neighbors"}
            &nbsp;·&nbsp; {uniqueSystems} unique systems
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Summary stat row */}
      <div style={{ display: "flex", gap: 0, marginBottom: 22, borderBottom: "1px solid var(--border)", paddingBottom: 18 }}>
        {[
          { label: "Neighbors",      val: String(neighborCount), color: "var(--text)" },
          { label: "Unique Systems", val: String(uniqueSystems), color: "var(--accent)" },
          { label: "Leaf Links",     val: String(nodes.filter(n => n.kind === "leaf").length),   color: "#8981E5" },
          { label: "Border Links",   val: String(nodes.filter(n => n.kind === "border").length), color: "#5BBFAA" },
        ].map(({ label, val, color }, i) => (
          <div key={label} style={{ flex: 1, paddingLeft: i > 0 ? 14 : 0, borderLeft: i > 0 ? "1px solid var(--border)" : "none" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.5, marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 300, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Star topology SVG */}
      {items.length > 0 && (
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ width: "100%", height: "auto", display: "block", marginBottom: 16 }}
        >
          {/* Subtle radial grid ring — was var(--subtle-bg) which is too
              faint in both themes (~3% alpha). Bump to container-border so
              the ring is visible without being loud. */}
          <circle cx={cx} cy={cy} r={RADIUS} fill="none" stroke="var(--container-border)" strokeWidth={1} />

          {/* Edges + nodes */}
          {nodes.map((node, i) => {
            const isSel = selected === i;
            const labelAnchor = node.ux > 0.3 ? "start" : node.ux < -0.3 ? "end" : "middle";
            const lx = node.nx + node.ux * (NODE_R + 14);
            const ly = node.ny + node.uy * (NODE_R + 14) + 4;
            // Port label on edge: 55% from center toward node
            const plx = cx + 0.55 * (node.nx - cx);
            const ply = cy + 0.55 * (node.ny - cy);

            return (
              <g key={i} onClick={() => setSelected(isSel ? null : i)} style={{ cursor: "pointer" }}>
                {/* Edge */}
                <line
                  x1={cx} y1={cy} x2={node.nx} y2={node.ny}
                  stroke={isSel ? node.colors.stroke : node.colors.edge}
                  strokeWidth={isSel ? 2 : 1.5}
                  strokeDasharray={node.kind === "border" ? "5 3" : undefined}
                />
                {/* Local port label on edge — keep the dark chip in both
                    themes (high-contrast pill), but bump text alpha so the
                    port label reads cleanly. */}
                <rect
                  x={plx - 14} y={ply - 8} width={28} height={12} rx={3}
                  fill="#161B27" opacity={0.85}
                />
                <text x={plx} y={ply + 3} textAnchor="middle" fontSize={8}
                  fill="rgba(255,255,255,0.9)" fontFamily="ui-monospace,monospace">
                  {shortPort(node.local_interface ?? "")}
                </text>

                {/* Node circle */}
                <circle
                  cx={node.nx} cy={node.ny} r={NODE_R}
                  fill={isSel ? node.colors.stroke + "33" : node.colors.fill}
                  stroke={node.colors.stroke}
                  strokeWidth={isSel ? 2 : 1.5}
                />
                {/* Remote port inside node */}
                <text x={node.nx} y={node.ny + 4} textAnchor="middle" fontSize={9}
                  fill="rgba(255,255,255,0.75)" fontFamily="ui-monospace,monospace">
                  {shortPort(node.remote_port_id ?? "")}
                </text>

                {/* System name outside node */}
                <text x={lx} y={ly} textAnchor={labelAnchor} fontSize={11} fontWeight="600"
                  fill={isSel ? node.colors.stroke : node.colors.stroke} opacity={isSel ? 1 : 0.85}>
                  {node.remote_system_name}
                </text>

                <title>{node.remote_system_name} · {node.local_interface} → {node.remote_port_id} · chassis {node.remote_chassis_id}</title>
              </g>
            );
          })}

          {/* Centre node — uses theme-aware tokens so it's visible in both
              dark and light. Was rgba(255,255,255,...) values that vanished
              on the white surface in light mode. */}
          <circle cx={cx} cy={cy} r={36}
            fill="var(--subtle-bg)" stroke="var(--container-border)" strokeWidth={2} />
          <text x={cx} y={cy - 7} textAnchor="middle" fontSize={10} fontWeight="700"
            fill="var(--heading-color)" letterSpacing="0.12em">SPINE</text>
          <text x={cx} y={cy + 7} textAnchor="middle" fontSize={9}
            fill="var(--muted-color)" fontFamily="ui-monospace,monospace">{switchIp}</text>

          {/* Legend */}
          {[
            { label: "Leaf", color: "#8981E5", x: 16 },
            { label: "Border", color: "#5BBFAA", x: 70 },
          ].map(({ label, color, x }) => (
            <g key={label}>
              <circle cx={x + 6} cy={SVG_H - 14} r={5} fill={color + "22"} stroke={color} strokeWidth={1.5} />
              <text x={x + 16} y={SVG_H - 10} fontSize={10} fill={color} opacity={0.75}>{label}</text>
            </g>
          ))}
        </svg>
      )}

      {/* Selected node detail panel */}
      {selItem && (
        <div style={{ background: "#161B27", border: `1px solid ${selItem.colors.stroke}55`, borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: selItem.colors.stroke }}>{selItem.remote_system_name}</span>
            <button
              onClick={() => setSelected(null)}
              style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer", padding: 0, lineHeight: 1 }}
            >✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", marginTop: 10, fontSize: 12 }}>
            {[
              ["Local interface",  selItem.local_interface],
              ["Remote port",      selItem.remote_port_id],
              ["Chassis ID",       selItem.remote_chassis_id],
              ["Port description", selItem.remote_port_description || "—"],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.45, marginBottom: 2 }}>{label}</div>
                <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, opacity: 0.9 }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection list */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Local", "Remote System", "Remote Port", "Chassis ID"].map(h => (
                <th key={h} style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.5, paddingBottom: 7, textAlign: "left", paddingRight: 16, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map((node, i) => (
              <tr
                key={i}
                onClick={() => setSelected(selected === i ? null : i)}
                style={{
                  borderBottom: "1px solid var(--subtle-bg)",
                  background: selected === i ? node.colors.fill : i % 2 === 0 ? "transparent" : "var(--subtle-bg)",
                  cursor: "pointer",
                }}
              >
                <td style={{ paddingTop: 7, paddingBottom: 7, paddingRight: 16, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", opacity: 0.7 }}>
                  {shortPort(node.local_interface ?? "")}
                </td>
                <td style={{ paddingTop: 7, paddingBottom: 7, paddingRight: 16, fontWeight: 600, color: node.colors.stroke, whiteSpace: "nowrap" }}>
                  {node.remote_system_name}
                </td>
                <td style={{ paddingTop: 7, paddingBottom: 7, paddingRight: 16, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", opacity: 0.7 }}>
                  {shortPort(node.remote_port_id ?? "")}
                </td>
                <td style={{ paddingTop: 7, paddingBottom: 7, fontFamily: "ui-monospace,monospace", opacity: 0.45, whiteSpace: "nowrap" }}>
                  {node.remote_chassis_id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

