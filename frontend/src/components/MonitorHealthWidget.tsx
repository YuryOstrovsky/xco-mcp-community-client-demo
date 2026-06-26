// MonitorHealthWidget — renders the monitor-health tool-result payload.
export function MonitorHealthWidget({
  items,
  host,
  onClose,
}: {
  items: any[];
  host: string;
  onClose: () => void;
}) {
  // HQI colour → palette
  const hqiColor = (color: string) => {
    const v = String(color || "").toLowerCase();
    if (v === "green")  return { dot: "rgba(60,220,120,0.9)",  bg: "rgba(60,220,120,0.10)",  border: "rgba(60,220,120,0.30)"  };
    if (v === "red")    return { dot: "rgba(255,80,80,0.9)",   bg: "rgba(255,80,80,0.10)",   border: "rgba(255,80,80,0.30)"   };
    if (v === "yellow") return { dot: "rgba(255,200,50,0.9)",  bg: "rgba(255,200,50,0.10)",  border: "rgba(255,200,50,0.30)"  };
    // "Black" / unknown → neutral accent
    return               { dot: "rgba(137,129,229,0.75)", bg: "rgba(137,129,229,0.08)", border: "rgba(137,129,229,0.25)" };
  };

  const statusColor = (status: string) => {
    const v = String(status || "").toLowerCase();
    if (v === "success") return { bg: "rgba(60,220,120,0.10)", border: "rgba(60,220,120,0.30)", color: "rgba(60,220,120,0.9)" };
    if (v === "error" || v === "failed" || v === "failure")
                         return { bg: "rgba(255,80,80,0.10)",  border: "rgba(255,80,80,0.30)",  color: "rgba(255,80,80,0.9)"  };
    return                { bg: "var(--subtle-bg)", border: "var(--subtle-border)", color: "rgba(255,255,255,0.65)" };
  };

  const allOk = items.length > 0 && items.every((it) => String(it.StatusText || "").toLowerCase() === "success");
  const anyFail = items.some((it) => {
    const s = String(it.StatusText || "").toLowerCase();
    return s === "error" || s === "failed" || s === "failure";
  });

  const bannerBg     = allOk ? "rgba(60,220,120,0.10)"  : anyFail ? "rgba(255,80,80,0.10)"  : "var(--subtle-bg)";
  const bannerBorder = allOk ? "rgba(60,220,120,0.30)"  : anyFail ? "rgba(255,80,80,0.30)"  : "var(--subtle-border)";
  const bannerColor  = allOk ? "rgba(60,220,120,0.95)"  : anyFail ? "rgba(255,80,80,0.95)"  : "rgba(255,255,255,0.7)";
  const bannerText   = allOk ? "All resources healthy"  : anyFail ? "Some resources degraded" : "Status unknown";
  const bannerDot    = allOk ? "rgba(60,220,120,0.9)"   : anyFail ? "rgba(255,80,80,0.9)"   : "rgba(200,200,200,0.5)";

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 600 }}>Monitor Health</div>
          <div className="text-xs" style={{ opacity: 0.55, marginTop: 2 }}>
            {host || "health manager"}&nbsp;·&nbsp;{items.length} resource{items.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
        >✕</button>
      </div>

      {/* overall status banner */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9,
        background: bannerBg, border: `1px solid ${bannerBorder}`,
        borderRadius: 10, padding: "10px 16px", marginBottom: 16,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: bannerDot, flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: bannerColor }}>{bannerText}</span>
        <span className="text-xs" style={{ marginLeft: "auto", opacity: 0.5 }}>{items.length} resource{items.length !== 1 ? "s" : ""} checked</span>
      </div>

      {/* resources table */}
      {items.length === 0 ? (
        <div className="text-xs" style={{ opacity: 0.5, textAlign: "center", padding: "12px 0" }}>No health items returned.</div>
      ) : (
        <div style={{ background: "var(--subtle-bg)", border: "1px solid var(--subtle-border)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--subtle-border)" }}>
                {["Resource", "Status", "HQI", "HQI Value"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 14px", opacity: 0.45, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, i: number) => {
                const resource: string = item.Resource ?? "—";
                const statusText: string = item.StatusText ?? "—";
                const hqiColor_str: string = item.HQI?.Color ?? "";
                const hqiValue: number | string = item.HQI?.Value ?? "—";
                const sc = statusColor(statusText);
                const hc = hqiColor(hqiColor_str);
                return (
                  <tr key={i} style={{ borderBottom: i < items.length - 1 ? "1px solid var(--subtle-bg)" : "none" }}>
                    <td style={{ padding: "8px 14px", fontFamily: "monospace", fontWeight: 600, opacity: 0.9 }}>{resource}</td>
                    <td style={{ padding: "8px 14px" }}>
                      <span style={{
                        background: sc.bg, border: `1px solid ${sc.border}`,
                        color: sc.color, borderRadius: 12, padding: "2px 9px", fontSize: 11, fontWeight: 600,
                      }}>{statusText}</span>
                    </td>
                    <td style={{ padding: "8px 14px" }}>
                      {hqiColor_str ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6,
                          background: hc.bg, border: `1px solid ${hc.border}`,
                          borderRadius: 12, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: hc.dot, display: "inline-block", flexShrink: 0 }} />
                          {hqiColor_str}
                        </span>
                      ) : <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                    <td style={{ padding: "8px 14px", fontFamily: "monospace", opacity: 0.8 }}>{hqiValue}</td>
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

