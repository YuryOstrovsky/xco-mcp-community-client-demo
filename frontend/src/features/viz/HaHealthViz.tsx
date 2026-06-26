// HA Health viz — pod donut + signal KPI boxes + node cards +
// subsystems table + warnings. Rendered when viz.kind === "ha_health".
//
// Pure presentational. Extracted from App.tsx.

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

export interface HaHealthVizProps {
  data: any;
  animatePie: boolean;
}

export function HaHealthViz({ data: ha, animatePie }: HaHealthVizProps) {
  if (!ha) return null;
  const hqiColor = (c: string) =>
    c.toLowerCase() === "green"  ? "rgba(60,220,120,0.95)"
    : c.toLowerCase() === "red"  ? "rgba(255,80,80,0.95)"
    : c.toLowerCase() === "yellow" ? "rgba(255,200,0,0.95)"
    : "rgba(180,180,190,0.7)";
  const sigColor = (ok: boolean) => ok ? "rgba(60,220,120,0.95)" : "rgba(255,80,80,0.95)";
  return (
    <div className="grid grid-cols-12 gap-4 items-start">
      <div className="col-span-12 lg:col-span-5">
        <div style={{ width: "100%", height: 210 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={ha.pie} dataKey="value" nameKey="name"
                innerRadius={60} outerRadius={95} paddingAngle={2} isAnimationActive={animatePie}>
                {ha.pie.map((p: any, idx: number) => {
                  const t = String(p?.tone ?? "").toLowerCase();
                  const fill = t === "bad"  ? "rgba(255,80,80,0.95)"
                             : t === "warn" ? "rgba(255,200,0,0.95)"
                             : t === "good" ? "rgba(60,220,120,0.95)"
                             : "rgba(137,129,229,0.35)";
                  return <Cell key={idx} fill={fill} />;
                })}
              </Pie>
              <Tooltip cursor={{ fill: "transparent" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="text-xs text-center mb-3" style={{ opacity: 0.6 }}>Pods</div>
        <div className="grid grid-cols-2 gap-2">
          {(["ha", "storage", "nodes", "health"] as const).map((k) => (
            <div key={k} className="rounded-xl border border-white/10 bg-white/5" style={{ padding: 10 }}>
              <div className="text-xs opacity-60 capitalize">{k}</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: sigColor(ha.signals[k]) }}>
                {ha.signals[k] ? "OK" : "Problem"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="col-span-12 lg:col-span-7 space-y-3">
        {ha.nodes.map((n: any, i: number) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5" style={{ padding: 12 }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-2 h-2 rounded-full" style={{
                background: String(n.status).toLowerCase() === "up"
                  ? "rgba(60,220,120,0.95)" : "rgba(255,80,80,0.95)"
              }} />
              <span style={{ fontWeight: 800 }}>{n.name}</span>
              <span className="text-xs opacity-60">{n.role} · {n.ip}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs opacity-60">Pods running</div>
                <div style={{ fontWeight: 700 }}>{n.podsRunning}</div>
              </div>
              <div>
                <div className="text-xs opacity-60">Failed</div>
                <div style={{ fontWeight: 700, color: n.podsFailed ? "rgba(255,80,80,0.95)" : undefined }}>
                  {n.podsFailed}
                </div>
              </div>
              <div>
                <div className="text-xs opacity-60">Stopped</div>
                <div style={{ fontWeight: 700 }}>{n.podsStopped}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs opacity-60">K3s version</div>
                <div style={{ fontWeight: 700 }}>{n.k3sVersion}</div>
              </div>
              <div>
                <div className="text-xs opacity-60">K3s status</div>
                <div style={{ fontWeight: 700, color: n.k3sStatus === "Ready" ? "rgba(60,220,120,0.95)" : "rgba(255,80,80,0.95)" }}>
                  {n.k3sStatus}
                </div>
              </div>
            </div>
          </div>
        ))}

        {ha.subsystems.length > 0 && (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--subtle-bg)" }}>
                  <th style={{ padding: "6px 10px", textAlign: "left", opacity: 0.7 }}>Subsystem</th>
                  <th style={{ padding: "6px 10px", textAlign: "left", opacity: 0.7 }}>HQI</th>
                  <th style={{ padding: "6px 10px", textAlign: "left", opacity: 0.7 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {ha.subsystems.map((s: any, i: number) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--divider)" }}>
                    <td style={{ padding: "6px 10px" }}>{s.label}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full"
                          style={{ background: hqiColor(s.color) }} />
                        {s.color}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px", opacity: 0.85 }}>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ha.warnings.length > 0 && (
          <div className="space-y-1">
            {ha.warnings.map((w: string, i: number) => (
              <div key={i} className="rounded-lg text-xs px-3 py-2"
                style={{ background: "rgba(217,119,6,0.10)", border: "1px solid rgba(217,119,6,0.35)", color: "var(--warn)", fontWeight: 500 }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
