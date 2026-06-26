// FirmwareVersionWidget — extracted from App.tsx as part of the incremental UI split.

export function FirmwareVersionWidget({
  item,
  summary,
  switchIp,
  onClose,
}: {
  item: any;
  summary: any;
  switchIp: string;
  onClose: () => void;
}) {
  const dash = (v: any) => (v != null && v !== "" ? String(v) : "—");

  const osVersion: string       = dash(item.os_version      ?? summary?.os_version);
  const fwFull: string          = dash(item.firmware_full_version ?? summary?.firmware_full_version);
  const uptime: string          = dash(item.system_uptime   ?? summary?.system_uptime);
  const osName: string          = dash(item.os_name);
  const kernelVersion: string   = dash(item.kernel_version);
  const buildTime: string       = dash(item.build_time);
  const installTime: string     = dash(item.install_time);
  const cpu: string             = dash(item.cpu);
  const memoryMb: string        = dash(item.memory_mb);

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "OS Name",          value: osName },
    { label: "Kernel Version",   value: kernelVersion, mono: true },
    { label: "Build Time",       value: buildTime },
    { label: "Install Time",     value: installTime },
    { label: "CPU",              value: cpu },
    { label: "Memory",           value: memoryMb },
  ];

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 600 }}>Firmware &amp; System Info</div>
          <div className="text-xs" style={{ opacity: 0.55, marginTop: 2 }}>
            {switchIp || "switch"} &nbsp;·&nbsp; SLX-OS
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
        >✕</button>
      </div>

      {/* version + uptime hero row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {/* firmware version card */}
        <div style={{
          flex: "1 1 120px", background: "rgba(137,129,229,0.08)", border: "1px solid rgba(137,129,229,0.25)",
          borderRadius: 10, padding: "12px 16px", textAlign: "center",
        }}>
          <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Firmware</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", letterSpacing: 1 }}>{fwFull}</div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>OS {osVersion}</div>
        </div>

        {/* uptime card */}
        <div style={{
          flex: "2 1 180px", background: "rgba(137,129,229,0.08)", border: "1px solid rgba(137,129,229,0.25)",
          borderRadius: 10, padding: "12px 16px",
        }}>
          <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>⏱ System Uptime</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace" }}>{uptime}</div>
          <div className="text-xs" style={{ opacity: 0.5, marginTop: 4, lineHeight: 1.5 }}>
            Time elapsed since the last reboot or power cycle of the switch.
          </div>
        </div>
      </div>

      {/* detail rows */}
      <div style={{ background: "var(--subtle-bg)", border: "1px solid var(--subtle-border)", borderRadius: 8, overflow: "hidden" }}>
        {rows.map(({ label, value, mono }, idx) => (
          <div key={label} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 14px",
            borderBottom: idx < rows.length - 1 ? "1px solid var(--subtle-bg)" : "none",
          }}>
            <span className="text-xs" style={{ opacity: 0.5, minWidth: 110 }}>{label}</span>
            <span className="text-xs" style={{ fontFamily: mono ? "monospace" : "inherit", textAlign: "right", opacity: 0.85, wordBreak: "break-word", maxWidth: "60%" }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

