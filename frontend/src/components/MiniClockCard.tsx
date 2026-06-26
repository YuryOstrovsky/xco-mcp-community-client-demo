// Compact analog+digital clock card for one switch, used in the "All Switch
// Clocks" grid. Seeds the device time from a sample (currentTime) and then
// ticks locally using wall-clock drift to keep the second hand alive without
// re-polling the switch. Uses UTC (the switches' canonical clock).
//
// Extracted from App.tsx — pure component, no closure dependencies.

import { useEffect, useMemo, useState } from "react";

export function MiniClockCard({ data }: {
  data: { ip: string; name: string; currentTime: string; timezone: string; uptime: string; source: string; error?: string };
}) {
  const seed = useMemo(() => {
    if (data.error || !data.currentTime) return null;
    const deviceMs = new Date(data.currentTime).getTime();
    return isNaN(deviceMs) ? null : { deviceMs, wallMs: Date.now() };
  }, [data.currentTime, data.error]);

  const [now, setNow] = useState<Date>(() => seed ? new Date(seed.deviceMs) : new Date());

  useEffect(() => {
    if (!seed) return;
    const id = setInterval(() => {
      setNow(new Date(seed.deviceMs + (Date.now() - seed.wallMs)));
    }, 1000);
    return () => clearInterval(id);
  }, [seed]);

  if (data.error) {
    return (
      <div style={{
        background: "var(--inner-card-bg)", border: "1px solid var(--container-border)", borderRadius: 8,
        padding: 16, display: "flex", flexDirection: "column", alignItems: "center",
        gap: 8, opacity: 0.5, minHeight: 240, justifyContent: "center",
        transition: "border-color 0.15s",
      }}>
        <div style={{ color: "var(--heading-color)", fontSize: 14, fontWeight: 500 }}>{data.name}</div>
        <div style={{ color: "var(--dim-color)", fontSize: 12, fontFamily: "monospace" }}>{data.ip}</div>
        <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{data.error}</div>
      </div>
    );
  }

  const h = now.getUTCHours() % 12;
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();
  const hourAngle = (h * 30) + (m * 0.5) - 90;
  const minuteAngle = (m * 6) + (s * 0.1) - 90;

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad2(now.getUTCHours())}:${pad2(m)}:${pad2(s)}`;

  return (
    <div style={{
      background: "var(--inner-card-bg)", border: "1px solid var(--container-border)", borderRadius: 8,
      padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      transition: "border-color 0.15s",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--btn-secondary-border)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--container-border)"; }}
    >
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ color: "var(--heading-color)", fontSize: 14, fontWeight: 500 }}>{data.name}</div>
        <div style={{ color: "var(--dim-color)", fontSize: 12, fontFamily: "monospace", marginTop: 2 }}>{data.ip}</div>
      </div>

      <div style={{ position: "relative", width: 128, height: 128 }}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: "#0f172a", border: "2px solid #334155",
          boxShadow: "0 4px 6px -1px rgba(0,0,0,0.3)",
        }} />
        <svg viewBox="0 0 100 100" width={128} height={128} style={{ position: "relative", zIndex: 1 }}>
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 30) * (Math.PI / 180);
            const isMain = i % 3 === 0;
            const r1 = isMain ? 35 : 38;
            const r2 = isMain ? 42 : 40;
            return (
              <line key={i}
                x1={50 + Math.cos(angle) * r1} y1={50 + Math.sin(angle) * r1}
                x2={50 + Math.cos(angle) * r2} y2={50 + Math.sin(angle) * r2}
                stroke={isMain ? "#94a3b8" : "#64748b"}
                strokeWidth={isMain ? 2 : 1.5}
                strokeLinecap="round"
              />
            );
          })}
          <line
            x1={50} y1={50}
            x2={50 + Math.cos(hourAngle * Math.PI / 180) * 22}
            y2={50 + Math.sin(hourAngle * Math.PI / 180) * 22}
            stroke="#cbd5e1" strokeWidth={3.5} strokeLinecap="round"
          />
          <line
            x1={50} y1={50}
            x2={50 + Math.cos(minuteAngle * Math.PI / 180) * 32}
            y2={50 + Math.sin(minuteAngle * Math.PI / 180) * 32}
            stroke="#e2e8f0" strokeWidth={2.5} strokeLinecap="round"
          />
          <circle cx={50} cy={50} r={3} fill="#64748b" />
          <circle cx={50} cy={50} r={1.5} fill="#cbd5e1" />
        </svg>
      </div>

      <div style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: 20, fontWeight: 400, letterSpacing: 2, color: "var(--heading-color)", marginTop: 4 }}>
        {timeStr}
      </div>

      <div style={{ color: "var(--dim-color)", fontSize: 12, marginTop: 2 }}>{data.timezone}</div>

      {data.uptime && (
        <div style={{
          marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 4, fontSize: 11,
          background: "rgba(51,65,85,0.5)", color: "var(--muted-color)",
          border: "1px solid var(--btn-secondary-border)",
        }}>
          Uptime: {data.uptime}
        </div>
      )}
    </div>
  );
}
