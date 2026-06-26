// AlarmDetailsWidget — renders the alarm-details tool-result payload.

import { useState } from "react";
export function AlarmDetailsWidget({
  resolved,
  summary,
  explanation,
  instances,
  relatedAlerts,
  resourceHealth,
  warnings,
  nextActions,
  onClose,
}: {
  resolved: any;
  summary: any;
  explanation: string;
  instances: any[];
  relatedAlerts: any[];
  resourceHealth: Record<string, any>;
  warnings: string[];
  nextActions: any[];
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"instances" | "alerts" | "health">("instances");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const sevDot = (sev: string) => {
    const v = String(sev || "").toLowerCase();
    if (v === "critical") return "bg-red-500";
    if (v === "major")    return "bg-orange-500";
    if (v === "warning")  return "bg-yellow-500";
    if (v === "minor")    return "bg-blue-500";
    return "bg-slate-500";
  };

  const sevText = (sev: string) => {
    const v = String(sev || "").toLowerCase();
    if (v === "critical") return "text-red-400";
    if (v === "major")    return "text-orange-400";
    if (v === "warning")  return "text-yellow-400";
    if (v === "minor")    return "text-blue-400";
    return "text-slate-400";
  };

  const sevLeftBorder = (sev: string) => {
    const v = String(sev || "").toLowerCase();
    if (v === "critical") return "border-l-red-500/60";
    if (v === "major")    return "border-l-orange-500/60";
    return "border-l-transparent";
  };

  const hqiColor = (color: string) => {
    const v = String(color || "").toLowerCase();
    if (v === "green") return { dot: "bg-green-500", text: "text-green-400", border: "border-green-500/30" };
    if (v === "red")   return { dot: "bg-red-500",   text: "text-red-400",   border: "border-red-500/30"   };
    if (v === "black") return { dot: "bg-indigo-400", text: "text-indigo-400", border: "border-indigo-500/30" };
    return                    { dot: "bg-slate-500",  text: "text-slate-400",  border: "border-slate-700"     };
  };

  const fmtTs = (ts: string) => {
    if (!ts) return "\u2014";
    try {
      return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return ts; }
  };

  const shortResource = (r: string) => {
    if (!r) return "\u2014";
    const q = r.indexOf("?");
    const base = q >= 0 ? r.slice(0, q) : r;
    const parts = base.split("/").filter(Boolean);
    const params = q >= 0 ? r.slice(q + 1) : "";
    return parts[parts.length - 1] + (params ? `?${params}` : "");
  };

  // compute severity breakdown
  const sevCounts: Record<string, number> = {};
  for (const inst of instances) {
    const s = String(inst.severity || "unknown");
    sevCounts[s] = (sevCounts[s] ?? 0) + 1;
  }

  const severities = Object.keys(sevCounts).sort((a, b) => {
    const order: Record<string, number> = { critical: 0, major: 1, warning: 2, minor: 3 };
    return (order[a] ?? 9) - (order[b] ?? 9);
  });

  const filteredInstances = severityFilter === "all"
    ? instances
    : instances.filter(i => String(i.severity || "").toLowerCase() === severityFilter);

  const worstSev = severities[0] ?? "";

  const resourceHealthEntries = Object.entries(resourceHealth);

  return (
    <div className="w-full max-w-7xl bg-slate-800 rounded-xl shadow-xl overflow-hidden border border-slate-700">
      {/* Header */}
      <div className="bg-indigo-300/10 px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-slate-200 text-lg font-medium">Alarm Details</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              {resolved?.resolved_name ?? "all alarms"} &middot; {instances.length} instance{instances.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg p-2 transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-7 gap-3">
          {/* Worst */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Worst</div>
            {worstSev ? (
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${sevDot(worstSev)}`} />
                <span className={`text-lg font-medium capitalize ${sevText(worstSev)}`}>{worstSev}</span>
              </div>
            ) : (
              <div className="text-slate-200 text-lg font-medium">OK</div>
            )}
          </div>
          {/* Instances */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4 text-center">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Instances</div>
            <div className="text-slate-200 text-2xl font-medium">{summary?.alarm_instances ?? instances.length}</div>
          </div>
          {/* Alerts */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4 text-center">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Alerts</div>
            <div className="text-slate-200 text-2xl font-medium">{summary?.related_alerts_count ?? relatedAlerts.length}</div>
          </div>
          {/* Health */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4 text-center">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Health</div>
            <div className="flex items-center justify-center gap-2 mt-1">
              <span className="text-green-400 text-sm font-medium">{summary?.health_resources_ok ?? 0} ok</span>
              {(summary?.health_resources_error ?? 0) > 0 && (
                <span className="text-red-400 text-sm font-medium">{summary.health_resources_error} err</span>
              )}
            </div>
          </div>
          {/* Per-severity counts */}
          {severities.map(s => (
            <div key={s} className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4 text-center">
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-2 capitalize">{s}</div>
              <div className="flex items-center justify-center gap-2">
                <div className={`w-2 h-2 rounded-full ${sevDot(s)}`} />
                <span className={`text-2xl font-medium ${sevText(s)}`}>{sevCounts[s]}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Explanation / Description */}
        {explanation && (
          <div className="text-slate-300 text-sm">{explanation}</div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <div key={i} className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
                <p className="text-yellow-400/90 text-sm">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-700">
          <button
            onClick={() => setActiveTab("instances")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "instances"
                ? "border-indigo-400 text-slate-200"
                : "border-transparent text-slate-400 hover:text-slate-300"
            }`}
          >
            Instances ({instances.length})
          </button>
          {relatedAlerts.length > 0 && (
            <button
              onClick={() => setActiveTab("alerts")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "alerts"
                  ? "border-indigo-400 text-slate-200"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Related Alerts ({relatedAlerts.length})
            </button>
          )}
          {resourceHealthEntries.length > 0 && (
            <button
              onClick={() => setActiveTab("health")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "health"
                  ? "border-indigo-400 text-slate-200"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Resource Health ({resourceHealthEntries.length})
            </button>
          )}
        </div>

        {/* ── Instances tab ── */}
        {activeTab === "instances" && (
          <>
            {/* Severity filter pills */}
            <div className="flex gap-2 flex-wrap">
              {["all", ...severities].map(s => {
                const active = severityFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                      active
                        ? "bg-slate-700 text-slate-200"
                        : "bg-slate-900 text-slate-400 border border-slate-700 hover:bg-slate-800"
                    }`}
                  >
                    {s === "all" ? `All (${instances.length})` : `${s} (${sevCounts[s]})`}
                  </button>
                );
              })}
            </div>

            {/* Table */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-slate-700 bg-slate-900/30">
                <div className="col-span-2 text-slate-500 text-xs uppercase tracking-wide">Time</div>
                <div className="col-span-1 text-slate-500 text-xs uppercase tracking-wide">Severity</div>
                <div className="col-span-2 text-slate-500 text-xs uppercase tracking-wide">Name</div>
                <div className="col-span-2 text-slate-500 text-xs uppercase tracking-wide">Type</div>
                <div className="col-span-2 text-slate-500 text-xs uppercase tracking-wide">Resource</div>
                <div className="col-span-3 text-slate-500 text-xs uppercase tracking-wide">Message</div>
              </div>
              {/* Table Rows */}
              <div className="max-h-96 overflow-y-auto">
                {filteredInstances.map((inst: any, idx: number) => {
                  const lb = sevLeftBorder(inst.severity);
                  return (
                    <div
                      key={idx}
                      className={`grid grid-cols-12 gap-4 px-4 py-3 border-b border-slate-700/50 last:border-b-0 hover:bg-slate-900/70 transition-colors border-l-2 ${lb}`}
                    >
                      <div className="col-span-2 text-slate-400 text-xs">{fmtTs(inst.timestamp)}</div>
                      <div className="col-span-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${sevDot(inst.severity)}`} />
                          <span className="text-slate-300 text-xs font-medium">{inst.severity}</span>
                        </div>
                      </div>
                      <div className="col-span-2 text-slate-200 text-xs font-medium">{inst.name}</div>
                      <div className="col-span-2 text-slate-400 text-xs">{inst.alarm_type}</div>
                      <div className="col-span-2 text-slate-400 text-xs font-mono truncate" title={inst.resource}>{shortResource(inst.resource)}</div>
                      <div className="col-span-3 text-slate-300 text-xs">{inst.message}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── Related Alerts tab ── */}
        {activeTab === "alerts" && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-slate-700 bg-slate-900/30">
              <div className="col-span-2 text-slate-500 text-xs uppercase tracking-wide">Time</div>
              <div className="col-span-1 text-slate-500 text-xs uppercase tracking-wide">Severity</div>
              <div className="col-span-3 text-slate-500 text-xs uppercase tracking-wide">Resource</div>
              <div className="col-span-6 text-slate-500 text-xs uppercase tracking-wide">Message</div>
            </div>
            {/* Table Rows */}
            <div className="max-h-96 overflow-y-auto">
              {relatedAlerts.map((al: any, idx: number) => {
                const lb = sevLeftBorder(al.severity);
                return (
                  <div
                    key={idx}
                    className={`grid grid-cols-12 gap-4 px-4 py-3 border-b border-slate-700/50 last:border-b-0 hover:bg-slate-900/70 transition-colors border-l-2 ${lb}`}
                  >
                    <div className="col-span-2 text-slate-400 text-xs">{fmtTs(al.timestamp)}</div>
                    <div className="col-span-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${sevDot(al.severity)}`} />
                        <span className="text-slate-300 text-xs font-medium">{al.severity}</span>
                      </div>
                    </div>
                    <div className="col-span-3 text-slate-400 text-xs font-mono truncate" title={al.resource}>{shortResource(al.resource)}</div>
                    <div className="col-span-6 text-slate-300 text-xs">{al.message}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Resource Health tab ── */}
        {activeTab === "health" && (
          <div className="space-y-2">
            {resourceHealthEntries.map(([path, rh]: [string, any]) => {
              const color: string = rh?.HQI?.Color ?? "";
              const value: number = rh?.HQI?.Value ?? 0;
              const status: string = rh?.StatusText ?? "";
              const c = hqiColor(color);
              return (
                <div key={path} className={`bg-slate-900/50 border ${c.border} rounded-lg px-4 py-3 flex items-start gap-3`}>
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                    {color && <span className={`text-xs font-semibold ${c.text}`}>{color}</span>}
                    {value > 0 && <span className="text-slate-500 text-[10px]">HQI {value}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-300 text-xs font-mono break-all">{path}</div>
                    {status && <div className="text-slate-500 text-xs mt-1">{status}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Next Actions */}
        {nextActions.length > 0 && (
          <div>
            <div className="text-slate-400 text-xs uppercase tracking-wide mb-3">Next Actions</div>
            <div className="space-y-2">
              {nextActions.map((a: any, i: number) => (
                <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3">
                  <p className="text-slate-300 text-sm">
                    <span className="font-medium text-slate-200">{a.action}</span> &middot; {a.hint}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

