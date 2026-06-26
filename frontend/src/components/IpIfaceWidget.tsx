// IpIfaceWidget — extracted from App.tsx as part of the incremental UI split.
export function IpIfaceWidget({
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
  const ifaceCount  = summary?.interface_with_ip_count ?? items.length;
  const ipv4Count   = summary?.ipv4_address_count ?? 0;
  const ipv6Count   = summary?.ipv6_address_count ?? 0;

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 700, fontSize: 18 }}>IP Interfaces</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 3 }}>
            {switchIp && <>{switchIp} &nbsp;·&nbsp;</>}
            {ifaceCount} {ifaceCount === 1 ? "interface" : "interfaces"}
            &nbsp;·&nbsp; {ipv4Count} IPv4 &nbsp;·&nbsp; {ipv6Count} IPv6
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "var(--muted-color)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Summary row */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid var(--border)", paddingBottom: 20 }}>
        {[
          { label: "Interfaces", val: String(ifaceCount),  color: "var(--text)" },
          { label: "IPv4 Addrs", val: String(ipv4Count),   color: "var(--accent)" },
          { label: "IPv6 Addrs", val: String(ipv6Count),   color: ipv6Count > 0 ? "var(--accent-egress)" : "var(--dim-color)" },
        ].map(({ label, val, color }, i) => (
          <div key={label} style={{ flex: 1, paddingLeft: i > 0 ? 16 : 0, borderLeft: i > 0 ? "1px solid var(--border)" : "none" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.5, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 300, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Interface cards */}
      {items.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.5, textAlign: "center", padding: "24px 0" }}>No IP interface data returned.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((iface: any, idx: number) => {
            const name: string = iface?.name ?? `iface-${idx}`;
            const vrf: string | null = iface?.vrf ?? null;
            const ipv4: string[] = Array.isArray(iface?.ipv4) ? iface.ipv4 : [];
            const ipv6: string[] = Array.isArray(iface?.ipv6) ? iface.ipv6 : [];

            return (
              <div key={name} style={{ background: "var(--inner-card-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
                {/* Interface name row */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: ipv4.length || ipv6.length ? 10 : 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "ui-monospace,monospace" }}>{name}</span>
                  {vrf && (
                    <span style={{
                      fontSize: 11, padding: "1px 7px", borderRadius: 4,
                      background: "rgba(91,138,125,0.15)", border: "1px solid var(--accent-egress)",
                      color: "var(--accent-egress)", fontWeight: 600,
                    }}>
                      VRF: {vrf}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.45 }}>
                    {ipv4.length} IPv4{ipv6.length > 0 ? ` · ${ipv6.length} IPv6` : ""}
                  </span>
                </div>

                {/* Address pills */}
                {(ipv4.length > 0 || ipv6.length > 0) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {ipv4.map((addr: string) => (
                      <span key={addr} style={{
                        fontSize: 12, padding: "2px 9px", borderRadius: 4,
                        background: "rgba(139,143,216,0.12)", border: "1px solid var(--accent)",
                        color: "var(--accent)", fontFamily: "ui-monospace,monospace",
                      }}>
                        {addr}
                      </span>
                    ))}
                    {ipv6.map((addr: string) => (
                      <span key={addr} style={{
                        fontSize: 12, padding: "2px 9px", borderRadius: 4,
                        background: "rgba(91,138,125,0.12)", border: "1px solid var(--accent-egress)",
                        color: "var(--accent-egress)", fontFamily: "ui-monospace,monospace",
                      }}>
                        {addr}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

