// VrfSummaryWidget — renders the VRF-summary tool-result payload.

export function VrfSummaryWidget({
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
  const vrfCount: number = summary?.vrf_count ?? items.length;

  const dash = (v: any) => (v != null && v !== "" ? String(v) : "—");

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 600 }}>VRF Summary</div>
          <div className="text-xs" style={{ opacity: 0.55, marginTop: 2 }}>
            {switchIp || "switch"}&nbsp;·&nbsp;{vrfCount} VRF{vrfCount !== 1 ? "s" : ""} configured
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
        >✕</button>
      </div>

      {/* count card */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{
          background: "var(--subtle-bg)", border: "1px solid var(--subtle-border)",
          borderRadius: 8, padding: "8px 20px", textAlign: "center",
        }}>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{vrfCount}</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 4 }}>Total VRFs</div>
        </div>
      </div>

      {/* table */}
      {items.length === 0 ? (
        <div className="text-xs" style={{ opacity: 0.5, textAlign: "center", padding: "12px 0" }}>No VRFs returned.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--subtle-border)" }}>
                {["VRF Name", "VRF ID", "Route Distinguisher", "VNI", "Router ID"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", opacity: 0.5, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((vrf: any, idx: number) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--subtle-bg)" }}>
                  <td style={{ padding: "7px 10px", fontWeight: 600 }}>{dash(vrf.name)}</td>
                  <td style={{ padding: "7px 10px", fontFamily: "monospace", opacity: 0.75 }}>{dash(vrf.vrf_id)}</td>
                  <td style={{ padding: "7px 10px", fontFamily: "monospace", opacity: 0.75 }}>{dash(vrf.rd)}</td>
                  <td style={{ padding: "7px 10px", fontFamily: "monospace", opacity: 0.75 }}>{dash(vrf.vni)}</td>
                  <td style={{ padding: "7px 10px", fontFamily: "monospace", opacity: 0.75 }}>{dash(vrf.router_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* what is a VRF */}
      <div style={{
        marginTop: 16, background: "rgba(137,129,229,0.07)", border: "1px solid rgba(137,129,229,0.18)",
        borderRadius: 8, padding: "10px 14px",
      }}>
        <div className="text-xs" style={{ fontWeight: 600, opacity: 0.8, marginBottom: 5, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          About VRFs
        </div>
        <div className="text-xs" style={{ opacity: 0.7, lineHeight: 1.65 }}>
          A <strong>Virtual Routing and Forwarding (VRF)</strong> instance creates an isolated Layer-3 routing
          domain on the switch. VRFs allow overlapping IP address spaces and are essential for multi-tenant
          fabrics. The <em>Route Distinguisher (RD)</em> makes routes unique across VRFs when exchanged via
          BGP, while the <em>VNI</em> maps the VRF to a VXLAN segment in overlay networks.
        </div>
      </div>
    </div>
  );
}

