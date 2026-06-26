// Notification Delivery viz — status pill + KPI row + scanned/failed
// bar + recent failures + warnings + suggestions. Rendered when
// viz.kind === "notif_delivery".
//
// Pure presentational. Extracted from App.tsx.

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export interface NotifDeliveryVizProps {
  data: any;
  /** Generic viz.data bar payload from the parent (already shaped for the chart). */
  barData: any[];
}

export function NotifDeliveryViz({ data: nd, barData }: NotifDeliveryVizProps) {
  if (!nd) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1 rounded-xl border bg-white/5 flex flex-col items-center justify-center" style={{
          padding: 14, minHeight: 90,
          borderColor: nd.healthy ? "rgba(60,220,120,0.35)" : "rgba(255,80,80,0.35)",
        }}>
          <div style={{ fontSize: 28 }}>{nd.healthy ? "✓" : "✗"}</div>
          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4,
            color: nd.healthy ? "rgba(60,220,120,0.95)" : "rgba(255,80,80,0.95)" }}>
            {nd.healthy ? "All Clear" : "Failures Found"}
          </div>
        </div>
        {[
          { label: "Window",   value: `${nd.windowHours}h` },
          { label: "Scanned",  value: nd.scanned },
          { label: "Failed",   value: nd.failedCount,
            color: nd.failedCount ? "rgba(255,80,80,0.95)" : undefined },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-white/10 bg-white/5"
            style={{ padding: 14 }}>
            <div className="text-xs opacity-60">{k.label}</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>
          <BarChart data={barData ?? []} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fill: "#cfd3ff" }} />
            <YAxis tick={{ fill: "#cfd3ff" }} allowDecimals={false} />
            <Tooltip cursor={{ fill: "transparent" }} />
            <Bar dataKey="value" fill="var(--accent)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="text-xs opacity-50">Mode: {nd.modeUsed}</div>

      {nd.recentFailed.length > 0 && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="text-xs opacity-70 px-3 py-2" style={{ background: "var(--subtle-bg)" }}>
            Recent failures
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--subtle-bg)" }}>
                {["time","status","subscriber","message"].map(c => (
                  <th key={c} style={{ padding: "5px 10px", textAlign: "left", opacity: 0.7 }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nd.recentFailed.map((f: any, i: number) => (
                <tr key={i} style={{ borderTop: "1px solid var(--divider)" }}>
                  <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>{String(f?.start_time ?? f?.time ?? "—").replace("T"," ").replace("Z","")}</td>
                  <td style={{ padding: "5px 10px", color: "rgba(255,80,80,0.9)" }}>{f?.status ?? "—"}</td>
                  <td style={{ padding: "5px 10px" }}>{f?.subscriber ?? f?.name ?? "—"}</td>
                  <td style={{ padding: "5px 10px", opacity: 0.75, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f?.message ?? f?.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nd.warnings.length > 0 && (
        <div className="space-y-1">
          {nd.warnings.map((w: string, i: number) => (
            <div key={i} className="rounded-lg text-xs px-3 py-2"
              style={{ background: "rgba(217,119,6,0.10)", border: "1px solid rgba(217,119,6,0.35)", color: "var(--warn)", fontWeight: 500 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      {nd.nextActions.length > 0 && (
        <div>
          <div className="text-xs opacity-60 mb-2">Suggestions</div>
          <div className="space-y-1">
            {nd.nextActions.map((a: any, i: number) => (
              <div key={i} className="rounded-lg text-xs px-3 py-2"
                style={{ background: "rgba(137,129,229,0.08)", border: "1px solid rgba(137,129,229,0.2)" }}>
                {a?.hint ?? "—"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
