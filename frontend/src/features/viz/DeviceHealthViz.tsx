// Device Health viz — donut + per-fabric table + worst-drivers list.
// Rendered when the AI Console viz.kind === "device_health".
//
// Pure presentational: parent passes the viz.deviceHealth payload and
// the animation gate.
//
// Extracted from App.tsx.

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

export interface DeviceHealthPiePoint {
  name: string;
  value: number;
  tone?: string;
}

export interface DeviceHealthByFabricRow {
  fabric: string;
  health: string;
  devices: number;
  red: number;
  yellow: number;
  green: number;
}

export interface DeviceHealthDriver {
  name?: string;
  device_name?: string;
  ip?: string;
  ip_address?: string;
  reason?: string;
  cause?: string;
  message?: string;
  role?: string;
  model?: string;
  fabric?: string;
  severity?: string;
}

export interface DeviceHealthVizData {
  headline?: string;
  pie?: DeviceHealthPiePoint[];
  total?: number;
  counts?: { red?: number; yellow?: number; green?: number };
  byFabric?: DeviceHealthByFabricRow[];
  driversTop?: DeviceHealthDriver[];
}

export interface DeviceHealthVizProps {
  data: DeviceHealthVizData;
  /** Pie animation off while an execution stream is running. */
  animatePie: boolean;
}

export function DeviceHealthViz({ data, animatePie }: DeviceHealthVizProps) {
  return (
    <div className="grid grid-cols-12 gap-4 items-start">
      <div className="col-span-12 lg:col-span-5">
        {data?.headline ? (
          <div className="text-sm opacity-80 mb-2">{data.headline}</div>
        ) : null}

        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data?.pie ?? []}
                dataKey="value"
                nameKey="name"
                innerRadius={72}
                outerRadius={110}
                paddingAngle={2} isAnimationActive={animatePie}
              >
                {(data?.pie ?? []).map((p, idx) => {
                  const t = String(p?.tone ?? "").toLowerCase();
                  const fill =
                    t === "bad"
                      ? "rgba(255, 80, 80, 0.95)"
                      : t === "warn"
                      ? "rgba(255, 200, 0, 0.95)"
                      : t === "good"
                      ? "rgba(60, 220, 120, 0.95)"
                      : "rgba(137,129,229,0.35)";
                  return <Cell key={idx} fill={fill} />;
                })}
              </Pie>
              <Tooltip cursor={{ fill: "transparent" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-xl border border-white/10 bg-white/5" style={{ padding: 12 }}>
            <div className="text-xs opacity-70">Devices</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{data?.total ?? "—"}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5" style={{ padding: 12 }}>
            <div className="text-xs opacity-70">Red</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{data?.counts?.red ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5" style={{ padding: 12 }}>
            <div className="text-xs opacity-70">Yellow</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{data?.counts?.yellow ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5" style={{ padding: 12 }}>
            <div className="text-xs opacity-70">Green</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{data?.counts?.green ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="col-span-12 lg:col-span-7">
        {Array.isArray(data?.byFabric) && data.byFabric.length ? (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-3 py-2">fabric</th>
                  <th className="text-left px-3 py-2">health</th>
                  <th className="text-right px-3 py-2">devices</th>
                  <th className="text-right px-3 py-2">red</th>
                  <th className="text-right px-3 py-2">yellow</th>
                  <th className="text-right px-3 py-2">green</th>
                </tr>
              </thead>
              <tbody>
                {data.byFabric.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white/0" : "bg-white/5"}>
                    <td className="px-3 py-2">{r.fabric}</td>
                    <td className="px-3 py-2" style={{ fontWeight: 700 }}>{r.health}</td>
                    <td className="px-3 py-2 text-right">{r.devices}</td>
                    <td className="px-3 py-2 text-right">{r.red}</td>
                    <td className="px-3 py-2 text-right">{r.yellow}</td>
                    <td className="px-3 py-2 text-right">{r.green}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-3 text-sm opacity-80">Top drivers (worst first)</div>
        {Array.isArray(data?.driversTop) && data.driversTop.length ? (
          <div className="space-y-2 mt-2">
            {data.driversTop.map((d, i) => {
              const sev = String(d?.severity ?? "—").toUpperCase();
              const sevLc = String(d?.severity ?? "").toLowerCase();
              const dot =
                sevLc === "red" || sevLc === "critical"
                  ? "rgba(255, 80, 80, 0.95)"
                  : sevLc === "yellow" || sevLc === "warn" || sevLc === "warning"
                  ? "rgba(255, 200, 0, 0.95)"
                  : sevLc === "green" || sevLc === "ok" || sevLc === "healthy"
                  ? "rgba(60, 220, 120, 0.95)"
                  : "rgba(180, 180, 190, 0.95)";

              const name = d?.name ?? d?.device_name ?? "—";
              const ip = d?.ip ?? d?.ip_address ?? "";
              const reason = d?.reason ?? d?.cause ?? d?.message ?? "—";
              const role = d?.role ?? "";
              const model = d?.model ?? "";

              return (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: dot }} />
                    <div className="min-w-0">
                      <div className="truncate" style={{ fontWeight: 800 }}>
                        {name} {ip ? `(${ip})` : ""}
                      </div>
                      <div className="text-xs opacity-70 truncate">
                        {d?.fabric ? `Fabric: ${d.fabric}` : ""} {role ? `• ${role}` : ""} {model ? `• ${model}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div style={{ fontWeight: 800 }}>{sev}</div>
                    <div className="text-xs opacity-70">{reason}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-2 text-sm opacity-70">No drivers returned (everything might be healthy, or filtering is excluding them).</div>
        )}
      </div>
    </div>
  );
}
