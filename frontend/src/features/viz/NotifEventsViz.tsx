// Notification Events viz — KPI row + severity bar + source coverage
// table + recent events + warnings + suggestions. Rendered when
// viz.kind === "notif_events".
//
// Pure presentational. Extracted from App.tsx.

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export interface NotifEventsVizProps {
  data: any;
}

export function NotifEventsViz({ data: ne }: NotifEventsVizProps) {
  if (!ne) return null;
  const statusColor = (s: string) =>
    s === "ok"          ? "rgba(60,220,120,0.9)"
    : s === "unsupported"? "rgba(255,80,80,0.7)"
    : "rgba(255,200,0,0.8)";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Events",  value: ne.totalEvents, color: ne.totalEvents ? undefined : "rgba(140,140,160,0.8)" },
          { label: "Sources", value: ne.sourcesUsed },
          { label: "Errors",  value: ne.errCount, color: ne.errCount ? "rgba(255,80,80,0.9)" : undefined },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-white/10 bg-white/5" style={{ padding: 14, textAlign: "center" }}>
            <div className="text-xs opacity-60">{k.label}</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {ne.sevData.length > 0 && (
        <div style={{ width: "100%", height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={ne.sevData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fill: "#cfd3ff" }} />
              <YAxis tick={{ fill: "#cfd3ff" }} allowDecimals={false} />
              <Tooltip cursor={{ fill: "transparent" }} />
              <Bar dataKey="value" fill="var(--accent)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="text-xs opacity-60 px-3 py-2" style={{ background: "var(--subtle-bg)" }}>
          Source coverage
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--subtle-bg)" }}>
              {["source","fetched","events","status"].map(c => (
                <th key={c} style={{ padding: "5px 10px", textAlign: "left", opacity: 0.6 }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ne.sourceRows.map((r: any, i: number) => (
              <tr key={i} style={{ borderTop: "1px solid var(--subtle-bg)" }}>
                <td style={{ padding: "5px 10px", fontWeight: 600 }}>{r.source}</td>
                <td style={{ padding: "5px 10px", opacity: 0.75 }}>{r.fetched}</td>
                <td style={{ padding: "5px 10px", opacity: 0.75 }}>{r.events}</td>
                <td style={{ padding: "5px 10px" }}>
                  <span style={{ color: statusColor(r.status), fontWeight: 600, fontSize: 11 }}>
                    {r.status.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ne.events.length > 0 && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="text-xs opacity-60 px-3 py-2" style={{ background: "var(--subtle-bg)" }}>Events</div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--subtle-bg)" }}>
                {["time","severity","source","message"].map(c => (
                  <th key={c} style={{ padding: "5px 10px", textAlign: "left", opacity: 0.6 }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ne.events.slice(0, 15).map((e: any, i: number) => (
                <tr key={i} style={{ borderTop: "1px solid var(--subtle-bg)" }}>
                  <td style={{ padding: "5px 10px", whiteSpace: "nowrap", opacity: 0.7 }}>{String(e?.timestamp ?? e?.time ?? "—").replace("T"," ").replace("Z","")}</td>
                  <td style={{ padding: "5px 10px" }}><span style={{ color: statusColor(String(e?.severity ?? "ok").toLowerCase() === "critical" || String(e?.severity ?? "").toLowerCase() === "major" ? "unsupported" : "ok"), fontWeight: 600 }}>{e?.severity ?? "—"}</span></td>
                  <td style={{ padding: "5px 10px", opacity: 0.7 }}>{typeof e?.source === "string" ? e.source : e?.source?.service ?? "—"}</td>
                  <td style={{ padding: "5px 10px", opacity: 0.8, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e?.message ?? e?.msg ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ne.warnings.length > 0 && (
        <div className="space-y-1">
          {ne.warnings.map((w: string, i: number) => (
            <div key={i} className="rounded-lg text-xs px-3 py-2"
              style={{ background: "rgba(217,119,6,0.10)", border: "1px solid rgba(217,119,6,0.35)", color: "var(--warn)", fontWeight: 500 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      {ne.nextActions.length > 0 && (
        <div>
          <div className="text-xs opacity-60 mb-2">Suggestions</div>
          <div className="space-y-1">
            {ne.nextActions.map((a: any, i: number) => (
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
