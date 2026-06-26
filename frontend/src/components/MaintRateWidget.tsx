// MaintRateWidget — renders the maintenance-rate tool-result payload.

export function MaintRateWidget({
  items,
  summary,
  warnings,
  switchIp,
  onClose,
}: {
  items: any[];
  summary: any;
  warnings: string[];
  switchIp: string;
  onClose: () => void;
}) {
  const hasData: boolean = summary?.has_data === true;

  // When active, items are per-interface entries from the RPC output.
  // Each item may have: interface-name / interface_name, local-state / local_state,
  // rate, description, exception, status_code.
  const activeItems = hasData
    ? items.filter((it) => it?.["interface-name"] || it?.interface_name || it?.["interface_name"])
    : [];

  const normKey = (it: any, ...keys: string[]) => {
    for (const k of keys) if (it[k] !== undefined) return it[k];
    return "—";
  };

  const stateColor = (s: string) => {
    const v = String(s || "").toLowerCase();
    if (v === "up" || v === "active") return "rgba(60,220,120,0.9)";
    if (v === "down" || v === "inactive") return "rgba(255,80,80,0.9)";
    return "rgba(200,200,200,0.6)";
  };

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>
      {/* ── header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 600 }}>Maintenance Mode · Rate Monitor</div>
          <div className="text-xs" style={{ opacity: 0.55, marginTop: 2 }}>
            {switchIp || "switch"} &nbsp;·&nbsp; brocade-system-maintenance RPC
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
        >✕</button>
      </div>

      {/* ── status badge ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: hasData ? "rgba(60,220,120,0.12)" : "rgba(200,200,200,0.08)",
          border: `1px solid ${hasData ? "rgba(60,220,120,0.35)" : "rgba(200,200,200,0.2)"}`,
          borderRadius: 20, padding: "4px 14px",
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: hasData ? "rgba(60,220,120,0.9)" : "rgba(180,180,180,0.55)",
            display: "inline-block",
          }} />
          <span className="text-xs" style={{ fontWeight: 600, opacity: hasData ? 1 : 0.65 }}>
            {hasData ? "Maintenance mode active" : "Not in maintenance mode"}
          </span>
        </div>
      </div>

      {/* ── what is maintenance mode ── */}
      <div style={{
        background: "rgba(137,129,229,0.07)", border: "1px solid rgba(137,129,229,0.18)",
        borderRadius: 8, padding: "12px 14px", marginBottom: 16,
      }}>
        <div className="text-xs" style={{ fontWeight: 600, opacity: 0.8, marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          What is Maintenance Mode?
        </div>
        <div className="text-xs" style={{ opacity: 0.75, lineHeight: 1.65 }}>
          Maintenance mode is a <strong>planned graceful-removal</strong> operation on SLX-OS switches.
          When activated, the switch signals its peers (via BGP/OSPF withdrawal and ECMP re-hashing) to
          reroute traffic away before any disruptive work (upgrades, hardware replacement, reboots) begins.
        </div>
        <div className="text-xs" style={{ opacity: 0.75, lineHeight: 1.65, marginTop: 6 }}>
          The <em>rate monitoring</em> RPC tracks <strong>per-interface traffic rates</strong> in real time
          during the drain phase. The goal is to confirm that rates approach zero — meaning traffic has
          fully migrated — before the maintenance window proceeds safely.
        </div>
        <div className="text-xs" style={{ opacity: 0.65, lineHeight: 1.65, marginTop: 6 }}>
          <strong>To activate:</strong> &nbsp;
          <code style={{ background: "var(--subtle-border)", padding: "1px 6px", borderRadius: 4 }}>
            configure terminal → system maintenance → mode activate
          </code>
        </div>
      </div>

      {/* ── no-data notice ── */}
      {!hasData && (
        <div className="text-xs" style={{ opacity: 0.55, textAlign: "center", padding: "12px 0" }}>
          {warnings.length > 0
            ? warnings[0]
            : "No rate monitoring data — switch is operating normally."}
        </div>
      )}

      {/* ── per-interface table (active only) ── */}
      {hasData && activeItems.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--subtle-border)" }}>
                {["Interface", "State", "Rate", "Exception"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", opacity: 0.5, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeItems.map((it: any, idx: number) => {
                const iface = normKey(it, "interface-name", "interface_name");
                const state = normKey(it, "local-state", "local_state", "state");
                const rate  = normKey(it, "rate");
                const exc   = normKey(it, "exception");
                return (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--subtle-bg)" }}>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{iface}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ color: stateColor(state), fontWeight: 600 }}>{state}</span>
                    </td>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{rate}</td>
                    <td style={{ padding: "7px 10px", opacity: 0.65 }}>{exc}</td>
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

