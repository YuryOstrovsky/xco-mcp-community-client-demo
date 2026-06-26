// PortStatsWidget — renders the port-statistics tool-result payload.

import { useState } from "react";
import { XN } from "../lib/xnPalette";

export function PortStatsWidget({
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
  const [selected, setSelected] = useState<any | null>(null);

  const fmtBytes = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
    return `${n || 0} B`;
  };

  const shortPort = (p: string) => p.replace(/^Ethernet\s+/i, "");

  const parsePortNum = (p: string) => {
    const m = p.match(/(\d+)\/(\d+)$/);
    return m ? parseInt(m[1]) * 1000 + parseInt(m[2]) : 9999;
  };

  const sortedItems = [...items].sort((a, b) => parsePortNum(a.port) - parsePortNum(b.port));

  const totals = summary?.totals ?? {};
  const top: any[] = (summary?.top ?? []).filter((t: any) => t.total_octets > 0);

  // Separate max for each bar column so each half fills its own range
  const maxIn  = Math.max(...top.map((t: any) => t.in_octets),  1);
  const maxOut = Math.max(...top.map((t: any) => t.out_octets), 1);

  const maxItemOctets = Math.max(...items.map((i: any) => i.total_octets), 1);

  // Simplified 4-state heat — down · low (teal) · mid (purple) · high (orange)
  const tileState = (item: any): "down" | "low" | "mid" | "high" => {
    const active = item.state === "up" && item.line_protocol === "up";
    if (!active || item.total_octets === 0) return "down";
    const r = item.total_octets / maxItemOctets;
    if (r > 0.5) return "high";
    if (r > 0.05) return "mid";
    return "low";
  };

  const tilePalette = {
    down: { bg: XN.tileDnBg, border: XN.tileDnBd, glow: false },
    low:  { bg: XN.tileLoBg, border: XN.tileLoBd, glow: false },
    mid:  { bg: XN.tileMiBg, border: XN.tileMiBd, glow: false },
    high: { bg: XN.tileHiBg, border: XN.tileHiBd, glow: true  },
  };

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 700, fontSize: 18 }}>Port Statistics</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 3 }}>
            {switchIp} &nbsp;·&nbsp; {summary?.ports_considered ?? items.length} ports &nbsp;·&nbsp; {fmtBytes(totals.total_octets ?? 0)} total
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* ── Flat totals — no card boxes, just columns ── */}
      <div style={{ display: "flex", gap: 0, marginBottom: 28, borderBottom: "1px solid var(--subtle-border)", paddingBottom: 22 }}>
        {[
          { label: "Total In",  val: fmtBytes(totals.in_octets  ?? 0), color: XN.accentSoft },
          { label: "Total Out", val: fmtBytes(totals.out_octets ?? 0), color: XN.teal       },
          { label: "Errors",    val: String(totals.total_errors ?? 0), color: (totals.total_errors ?? 0) > 0 ? "#ef4444" : "rgba(255,255,255,0.75)" },
        ].map(({ label, val, color }, i) => (
          <div key={label} style={{ flex: 1, paddingLeft: i > 0 ? 16 : 0, borderLeft: i > 0 ? "1px solid var(--subtle-border)" : "none" }}>
            <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.38, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── Top Talkers — split dual-column pill bars ── */}
      {top.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.38, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Top Talkers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {top.map((t: any, idx: number) => {
              const inRatio  = t.in_octets  / maxIn;
              const outRatio = t.out_octets / maxOut;
              return (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* port label */}
                  <div style={{ width: 40, fontSize: 11, opacity: 0.6, fontWeight: 600, textAlign: "right", flexShrink: 0, fontFamily: "monospace" }}>
                    {shortPort(t.port)}
                  </div>
                  {/* ingress pill bar */}
                  <div style={{ flex: 1, height: 20, borderRadius: 999, background: XN.barTrack, position: "relative" }}>
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0,
                      width: `${inRatio * 100}%`, minWidth: inRatio > 0 ? 10 : 0,
                      background: XN.accent, borderRadius: 999,
                      transition: "width 0.35s",
                    }} title={`In: ${fmtBytes(t.in_octets)}`} />
                  </div>
                  {/* egress pill bar */}
                  <div style={{ flex: 1, height: 20, borderRadius: 999, background: XN.barTrack, position: "relative" }}>
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0,
                      width: `${outRatio * 100}%`, minWidth: outRatio > 0 ? 10 : 0,
                      background: XN.teal, borderRadius: 999,
                      transition: "width 0.35s",
                    }} title={`Out: ${fmtBytes(t.out_octets)}`} />
                  </div>
                  {/* total */}
                  <div style={{ width: 58, fontSize: 10, opacity: 0.5, textAlign: "right", flexShrink: 0, fontFamily: "monospace" }}>
                    {fmtBytes(t.total_octets)}
                  </div>
                </div>
              );
            })}
            {/* bar legend — circle dots */}
            <div style={{ display: "flex", gap: 14, marginTop: 3, paddingLeft: 50 }}>
              {([[XN.accent, "Ingress"], [XN.teal, "Egress"]] as [string,string][]).map(([c, l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, opacity: 0.4 }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Port Map — 4-state heat, larger tiles ── */}
      <div style={{ marginBottom: selected ? 14 : 0 }}>
        <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.38, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Port Map</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {sortedItems.map((item: any, idx: number) => {
            const state  = tileState(item);
            const { bg, border, glow } = tilePalette[state];
            const isSel  = selected?.port === item.port;
            const portNum = (item.port.match(/\/(\d+)$/) || [])[1] ?? "?";
            return (
              <div
                key={idx}
                title={`${item.port} · ${item.state}/${item.line_protocol} · ${fmtBytes(item.total_octets)}`}
                onClick={() => setSelected(isSel ? null : item)}
                style={{
                  width: 34, height: 28, borderRadius: 5,
                  background: bg,
                  border: `1px solid ${isSel ? "rgba(255,255,255,0.8)" : border}`,
                  boxShadow: isSel
                    ? `0 0 0 2px ${XN.accent}, 0 0 10px ${XN.accent}55`
                    : glow ? `0 0 7px ${XN.orange}55` : undefined,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.65)",
                  fontFamily: "monospace", transition: "box-shadow 0.15s",
                }}
              >
                {portNum}
              </div>
            );
          })}
        </div>
        {/* 4-state legend — circle dots */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 9 }}>
          {([
            [XN.tileDnBd, "Down"],
            [XN.teal,     "Low traffic"],
            [XN.accent,   "Mid traffic"],
            [XN.orange,   "High traffic"],
          ] as [string,string][]).map(([c, l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
              <span style={{ fontSize: 9, opacity: 0.4 }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Selected port detail ── */}
      {selected && (() => {
        const state = tileState(selected);
        const accentColor = state === "high" ? XN.orange : state === "low" ? XN.teal : XN.accent;
        return (
          <div style={{ marginTop: 10, border: `1px solid ${accentColor}44`, borderRadius: 8, padding: "12px 14px", background: `${accentColor}0c` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {selected.port}
                <span style={{ fontWeight: 400, opacity: 0.45, fontSize: 11, marginLeft: 8 }}>
                  {selected.state} / {selected.line_protocol}
                  {selected.speed && selected.speed !== "nil" ? ` · ${selected.speed}` : ""}
                </span>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 15, cursor: "pointer", padding: 0 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 16px" }}>
              {([
                ["Ingress",    fmtBytes(selected.in_octets),  XN.accentSoft],
                ["Egress",     fmtBytes(selected.out_octets), XN.teal      ],
                ["Total",      fmtBytes(selected.total_octets), "var(--text)"],
                ["In errors",  String(selected.in_errors  ?? 0), selected.in_errors  > 0 ? "#ef4444" : "var(--text)"],
                ["Out errors", String(selected.out_errors ?? 0), selected.out_errors > 0 ? "#ef4444" : "var(--text)"],
                ["Speed",      selected.speed === "nil" ? "—" : (selected.speed || "—"), "var(--text)"],
              ] as [string, string, string][]).map(([label, val, color]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 9, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

