// MediaWidget — extracted from App.tsx as part of the incremental UI split.

import { useState } from "react";
export function MediaWidget({
  items,
  switchIp,
  onClose,
}: {
  items: any[];
  summary: any;
  switchIp: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<any | null>(null);

  // Figma colors: #00BCD4 teal for high-speed, #7E57C2 purple for lower-speed
  const FIGMA_TEAL   = "#00BCD4";
  const FIGMA_PURPLE = "#7E57C2";

  const speedColor = (speed: string) => {
    const s = (speed || "").toLowerCase();
    // 25G and above → Figma teal; 10G and below → Figma purple
    if (s.includes("400") || s.includes("100") || s.includes("40") || s.includes("25")) return FIGMA_TEAL;
    return FIGMA_PURPLE;
  };

  const fmtConnector = (c: string) => {
    if (!c || c === "unknown") return "—";
    if (c.includes("cat-5") || c.includes("copper")) return "Copper (RJ45)";
    if (c.includes("no-separable")) return "Direct Attach";
    if (c.includes("lc")) return "LC fiber";
    if (c.includes("sc")) return "SC fiber";
    return c.replace(/-/g, " ");
  };

  const fmtKind = (k: string) => (k || "SFP").toUpperCase().replace(/-/g, "+");

  const fmtWavelength = (w: string | number) => {
    const n = parseInt(String(w));
    return n > 0 ? `${n} nm` : null;
  };

  const fmtDate = (d: string) => {
    if (!d || d.length < 6) return d || "—";
    const yy = d.substring(0, 2), mm = d.substring(2, 4), dd = d.substring(4, 6);
    return `20${yy}-${mm}-${dd}`;
  };

  const fiberCount  = items.filter(it => parseInt(String(it.wavelength)) > 0).length;
  const copperCount = items.length - fiberCount;

  const speedGroups: Record<string, number> = {};
  items.forEach(it => { const s = it.speed || "?"; speedGroups[s] = (speedGroups[s] || 0) + 1; });

  const detailRows: [string, string][] = selected ? [
    ["Speed",       selected.speed || "—"],
    ["Form factor", fmtKind(selected.media_kind)],
    ["Connector",   fmtConnector(selected.connector)],
    ["Encoding",    selected.encoding || "—"],
    ["Distance",    selected.distance && selected.distance !== "unknown" ? selected.distance.replace(/-/g, " ") : "—"],
    ["Wavelength",  fmtWavelength(selected.wavelength) ?? "— (copper)"],
    ["Vendor",      selected.vendor_name || "—"],
    ["Part no.",    (selected.vendor_part_number || "").trim()],
    ["Rev",         selected.vendor_rev || "—"],
    ["Serial",      (selected.serial_number || "").trim()],
    ["Mfg date",    fmtDate(selected.date_code)],
    ["OUI",         selected.vendor_oui || "—"],
  ] : [];

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>

      {/* Header — gradient grounds the purple, avoids flat neon look on dark bg */}
      <div style={{ background: "linear-gradient(135deg, #3D0E65 0%, #6A1B9A 100%)", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Transceivers</div>
          <div className="text-xs" style={{ color: "rgba(255,255,255,0.75)", marginTop: 3 }}>
            {switchIp && <>{switchIp} &nbsp;·&nbsp;</>}
            {items.length} {items.length === 1 ? "transceiver" : "transceivers"} installed
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Stats band — Figma: gray-50 section, numbers in #6A1B9A */}
      <div style={{ background: "var(--bg0)", borderBottom: "1px solid var(--border)", padding: "16px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
          {[
            { label: "Installed",    val: String(items.length) },
            { label: "Fiber",        val: String(fiberCount)   },
            { label: "Copper / DAC", val: String(copperCount)  },
          ].map(({ label, val }, i) => (
            <div key={label} style={{ paddingLeft: i > 0 ? 16 : 0, borderLeft: i > 0 ? "1px solid var(--border)" : "none" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.65, marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 300, color: "#A462D0" }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Speed legend row — dot + label (Figma style, no pill background) */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
        {Object.entries(speedGroups)
          .sort(([a], [b]) => (parseFloat(b) || 0) - (parseFloat(a) || 0))
          .map(([speed, count]) => (
            <div key={speed} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: speedColor(speed), flexShrink: 0 }} />
              <span style={{ fontSize: 13, opacity: 0.8 }}>{count}× {speed}</span>
            </div>
          ))}
      </div>

      {/* Card grid — recessed bg, 2-column (Figma layout) */}
      <div style={{ background: "var(--bg0)", padding: "16px" }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.5, textAlign: "center", padding: "24px 0" }}>No transceiver data returned.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: selected ? 12 : 0 }}>
            {items.map((it, idx) => {
              const sc = speedColor(it.speed);
              const isSelected = selected?.interface_name === it.interface_name;
              const wl = fmtWavelength(it.wavelength);
              return (
                <div
                  key={idx}
                  onClick={() => setSelected(isSelected ? null : it)}
                  style={{
                    border: `2px solid ${isSelected ? sc : sc + "70"}`,
                    borderRadius: 8, overflow: "hidden", cursor: "pointer",
                    transition: "border-color 0.15s",
                  }}
                >
                  {/* Colored header strip — key Figma pattern */}
                  <div style={{ background: sc, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(0,0,0,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                          {fmtKind(it.media_kind)}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", fontFamily: "ui-monospace,monospace", lineHeight: 1 }}>
                          {it.interface_short || it.interface_name}
                        </div>
                      </div>
                      {wl && (
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.85)", fontFamily: "ui-monospace,monospace" }}>{wl}</span>
                      )}
                    </div>
                  </div>

                  {/* Card body */}
                  <div style={{ background: "var(--bg1)", padding: "10px 14px" }}>
                    <div style={{ marginBottom: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        background: `${sc}22`, color: sc,
                        padding: "2px 8px", borderRadius: 4,
                      }}>
                        {it.speed}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {it.vendor_name}
                    </div>
                    <div style={{ fontSize: 11, fontFamily: "ui-monospace,monospace", opacity: 0.4, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(it.vendor_part_number || "").trim() || (it.serial_number || "").trim()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Expanded detail panel */}
        {selected && (
          <div style={{
            background: "var(--bg1)",
            border: `1px solid ${speedColor(selected.speed)}66`,
            borderRadius: 8, padding: "14px 16px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "ui-monospace,monospace" }}>{selected.interface_name}</span>
                <span style={{ fontWeight: 400, opacity: 0.45, fontSize: 12, marginLeft: 10 }}>{fmtKind(selected.media_kind)}</span>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
              {detailRows.map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", opacity: 0.45, marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 12, fontFamily: ["serial", "part no.", "oui"].includes(label.toLowerCase()) ? "ui-monospace,monospace" : undefined, wordBreak: "break-all" }}>
                    {val}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

