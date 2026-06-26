// ClockWidget — renders a switch clock / NTP-sync tool-result payload.

import { useState, useEffect, useMemo } from "react";

export function ClockWidget({
  currentTime,
  timezone,
  switchIp,
  uptime,
  onFetchUptime,
  onClose,
}: {
  currentTime: string;
  timezone: string;
  switchIp: string;
  uptime?: string;
  onFetchUptime?: () => Promise<void>;
  onClose: () => void;
}) {
  const [fetchingUptime, setFetchingUptime] = useState(false);

  const handleFetchUptime = async () => {
    if (!onFetchUptime) return;
    setFetchingUptime(true);
    try { await onFetchUptime(); } finally { setFetchingUptime(false); }
  };

  const seed = useMemo(() => {
    const deviceMs = new Date(currentTime).getTime();
    return isNaN(deviceMs) ? { deviceMs: Date.now(), wallMs: Date.now() } : { deviceMs, wallMs: Date.now() };
  }, [currentTime]);

  const [now, setNow] = useState<Date>(() => new Date(seed.deviceMs));

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date(seed.deviceMs + (Date.now() - seed.wallMs)));
    }, 1000);
    return () => clearInterval(id);
  }, [seed]);

  const h = now.getUTCHours() % 12;
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();

  // angles in degrees, 0 = 12 o'clock
  const hourDeg  = h * 30 + m * 0.5;
  const minDeg   = m * 6  + s * 0.1;
  const secDeg   = s * 6;

  const cx = 100, cy = 100, R = 86;

  const handEnd = (deg: number, len: number) => {
    const rad = (deg - 90) * (Math.PI / 180);
    return { x2: cx + len * Math.cos(rad), y2: cy + len * Math.sin(rad) };
  };

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad2(now.getUTCHours())}:${pad2(m)}:${pad2(s)}`;
  const dateStr = now.toISOString().substring(0, 10);

  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="text-base" style={{ fontWeight: 600 }}>Device Clock</div>
          <div className="text-xs" style={{ opacity: 0.55, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{switchIp} &nbsp;·&nbsp; {timezone}</span>
            {uptime ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                &nbsp;·&nbsp; {uptime}
                {onFetchUptime && (
                  <button
                    onClick={handleFetchUptime}
                    disabled={fetchingUptime}
                    title="Refresh uptime"
                    style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: "0 2px", fontSize: 11, opacity: fetchingUptime ? 0.4 : 0.6, lineHeight: 1 }}
                  >{fetchingUptime ? "…" : "↻"}</button>
                )}
              </span>
            ) : onFetchUptime ? (
              <button
                onClick={handleFetchUptime}
                disabled={fetchingUptime}
                style={{ background: "var(--subtle-border)", border: "1px solid var(--subtle-border)", color: "inherit", cursor: "pointer", borderRadius: 4, padding: "1px 7px", fontSize: 10, opacity: fetchingUptime ? 0.5 : 0.8 }}
              >{fetchingUptime ? "fetching…" : "Get Uptime"}</button>
            ) : null}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
        >✕</button>
      </div>

      {/* clock face */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <svg viewBox="0 0 200 200" width={220} height={220}>
          {/* outer glow ring */}
          <circle cx={cx} cy={cy} r={R + 4} fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.25} />
          {/* face */}
          <circle cx={cx} cy={cy} r={R} fill="var(--subtle-bg)" stroke="var(--border)" strokeWidth={1} />

          {/* minute ticks */}
          {Array.from({ length: 60 }, (_, i) => {
            if (i % 5 === 0) return null;
            const a = (i * 6 - 90) * (Math.PI / 180);
            return (
              <line key={i}
                x1={cx + (R - 7) * Math.cos(a)} y1={cy + (R - 7) * Math.sin(a)}
                x2={cx + (R - 1) * Math.cos(a)} y2={cy + (R - 1) * Math.sin(a)}
                stroke="var(--text)" strokeWidth={0.8} opacity={0.3}
              />
            );
          })}

          {/* hour ticks + numbers */}
          {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n, i) => {
            const a = (i * 30 - 90) * (Math.PI / 180);
            const tx = cx + (R - 18) * Math.cos(a);
            const ty = cy + (R - 18) * Math.sin(a);
            return (
              <g key={n}>
                <line
                  x1={cx + (R - 13) * Math.cos(a)} y1={cy + (R - 13) * Math.sin(a)}
                  x2={cx + (R - 1)  * Math.cos(a)} y2={cy + (R - 1)  * Math.sin(a)}
                  stroke="var(--text)" strokeWidth={2.5} opacity={0.75}
                />
                <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central"
                  fontSize={9.5} fill="var(--text)" opacity={0.6} fontFamily="monospace">
                  {n}
                </text>
              </g>
            );
          })}

          {/* hour hand */}
          {(() => { const { x2, y2 } = handEnd(hourDeg, 48); return (
            <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="var(--text)" strokeWidth={5} strokeLinecap="round" opacity={0.9} />
          ); })()}

          {/* minute hand */}
          {(() => { const { x2, y2 } = handEnd(minDeg, 68); return (
            <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="var(--text)" strokeWidth={3} strokeLinecap="round" opacity={0.85} />
          ); })()}

          {/* second hand */}
          {(() => { const { x2, y2 } = handEnd(secDeg, 76); return (
            <>
              <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={1.2} strokeLinecap="round" />
              {/* counterweight tail */}
              {(() => { const { x2: tx, y2: ty } = handEnd(secDeg + 180, 18); return (
                <line x1={cx} y1={cy} x2={tx} y2={ty} stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
              ); })()}
            </>
          ); })()}

          {/* center cap */}
          <circle cx={cx} cy={cy} r={5} fill="var(--accent)" />
          <circle cx={cx} cy={cy} r={2} fill="var(--bg1)" />
        </svg>

        {/* digital readout */}
        <div style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: 26, fontWeight: 700, letterSpacing: 3 }}>
          {timeStr}
        </div>
        <div style={{ opacity: 0.5, fontSize: 12, letterSpacing: 1 }}>
          {dateStr}
        </div>

      </div>
    </div>
  );
}

