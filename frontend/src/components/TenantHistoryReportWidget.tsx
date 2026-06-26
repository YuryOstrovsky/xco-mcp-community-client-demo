// TenantHistoryReportWidget — renders the tenant-history report tool-result payload.

import { useState, useEffect, useRef } from "react";
export function TenantHistoryReportWidget({
  payload,
  tenantNames,
  tenantNamesLoading,
  selectedTenantName,
  onTenantChange,
  windowDays,
  onWindowChange,
  allowUnscoped,
  onAllowUnscopedChange,
  nlRunning,
  onLoadTenants,
  onRun,
  onClose,
}: {
  payload: any;
  tenantNames: string[];
  tenantNamesLoading: boolean;
  selectedTenantName: string;
  onTenantChange: (name: string) => void;
  windowDays: 7 | 30;
  onWindowChange: (days: 7 | 30) => void;
  allowUnscoped: boolean;
  onAllowUnscopedChange: (v: boolean) => void;
  nlRunning: boolean;
  onLoadTenants: () => void;
  onRun: (name: string, days: 7 | 30, allowUnscoped: boolean) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"alerts" | "alarms" | "actions">("alerts");

  // Auto-load tenant list if we don't have it yet (e.g. widget opened via NL console)
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (!didAutoLoad.current && tenantNames.length === 0 && !tenantNamesLoading) {
      didAutoLoad.current = true;
      onLoadTenants();
    }
  }, []);

  // ── helpers ──────────────────────────────────────────────────────────────
  const sevColor = (sev: string) => {
    const v = String(sev || "").toLowerCase();
    if (v === "critical") return { dot: "#ef4444", label: "text-red-400",  cardBg: "bg-red-900/30",    cardBorder: "border-red-900/50",   pillBg: "bg-red-900/40",    pillBorder: "border-red-900/50",   pillText: "text-red-400"   };
    if (v === "major")    return { dot: "#f97316", label: "text-orange-400", cardBg: "bg-orange-900/30", cardBorder: "border-orange-900/50", pillBg: "bg-orange-900/40", pillBorder: "border-orange-900/50", pillText: "text-orange-400" };
    if (v === "warning" || v === "warn")
                          return { dot: "#eab308", label: "text-yellow-400", cardBg: "bg-yellow-900/30", cardBorder: "border-yellow-900/50", pillBg: "bg-yellow-900/40", pillBorder: "border-yellow-900/50", pillText: "text-yellow-400" };
    if (v === "minor")    return { dot: "#3b82f6", label: "text-blue-400",  cardBg: "bg-blue-900/30",   cardBorder: "border-blue-900/50",  pillBg: "bg-blue-900/40",   pillBorder: "border-blue-900/50",  pillText: "text-blue-400"  };
    return                       { dot: "#64748b", label: "text-slate-400", cardBg: "bg-slate-700/50",   cardBorder: "border-slate-600",    pillBg: "bg-slate-700/50",  pillBorder: "border-slate-600",    pillText: "text-slate-400" };
  };

  const SevPill = ({ value }: { value: string }) => {
    const c = sevColor(value);
    return (
      <span className={`${c.pillBg} ${c.pillText} border ${c.pillBorder} px-3 py-1 rounded text-xs font-medium flex-shrink-0`}>
        {value || "—"}
      </span>
    );
  };

  const fmtTs = (ts: string) => {
    if (!ts) return "—";
    try { return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return ts; }
  };

  // ── data extraction ───────────────────────────────────────────────────────
  const tenantName: string     = payload?.tenant_name ?? payload?.tenant ?? "—";
  const payloadWindowDays: number = payload?.window_days ?? windowDays;
  const generatedAt: string    = payload?.generated_at ?? payload?.timestamp ?? "";
  const alerts: any[]        = Array.isArray(payload?.alerts)  ? payload.alerts  : [];
  const alarms: any[]        = Array.isArray(payload?.alarms)  ? payload.alarms  : [];
  const nextActions: any[]   = Array.isArray(payload?.next_actions) ? payload.next_actions : [];
  const warnings: string[]   = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const suggestedTenants: string[] = Array.isArray(payload?.suggested_tenants) ? payload.suggested_tenants : [];

  // ── summary / scope ───────────────────────────────────────────────────────
  const summary: any            = payload?.summary ?? {};
  const alertsFetched: number   = summary.alerts_total_fetched ?? 0;
  const alarmsFetched: number   = summary.alarms_total_fetched ?? 0;
  const alertsReturned: number  = summary.returned_alerts ?? alerts.length;
  const alarmsReturned: number  = summary.returned_alarms ?? alarms.length;
  const topUnscopedAlerts: [string, number][] =
    Array.isArray(summary.top_unscoped_resources) ? summary.top_unscoped_resources : [];
  const topUnscopedAlarms: [string, number][] =
    Array.isArray(summary.top_unscoped_alarm_resources) ? summary.top_unscoped_alarm_resources : [];
  const hasUnscopedActivity = topUnscopedAlerts.length > 0 || topUnscopedAlarms.length > 0;

  const scope: any              = payload?.scope ?? {};
  const epgCount: number        = scope.epg_count ?? 0;
  const vrfCount: number        = scope.vrf_count ?? 0;
  const scopeTerms: string[]    = Array.isArray(scope.scope_terms_sample) ? scope.scope_terms_sample : [];

  // severity breakdown across both alerts + alarms
  const sevCounts: Record<string, number> = {};
  for (const a of [...alerts, ...alarms]) {
    const s = String(a?.severity ?? a?.alarm_severity ?? "unknown").toLowerCase();
    sevCounts[s] = (sevCounts[s] ?? 0) + 1;
  }
  const sevOrder: Record<string, number> = { critical: 0, major: 1, warning: 2, warn: 2, minor: 3 };
  const topSev = Object.keys(sevCounts).sort((a, b) => (sevOrder[a] ?? 9) - (sevOrder[b] ?? 9))[0] ?? "";

  const isError = !!(payload?.error || suggestedTenants.length);

  return (
    <div className="w-full max-w-6xl bg-slate-800 rounded-xl shadow-xl overflow-hidden border border-slate-700">
      {/* Header */}
      <div className="bg-indigo-300/10 px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-slate-200 text-lg font-medium">
              EPG History Report
            </h2>
            {!isError && tenantName !== "—" && (
              <p className="text-slate-400 text-sm mt-0.5">
                {tenantName} · last {payloadWindowDays}d
                {generatedAt ? <> · {fmtTs(generatedAt)}</> : null}
              </p>
            )}
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

      {/* Controls bar */}
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3 flex-wrap">
        <select
          className="flex-1 min-w-[140px] bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 text-sm hover:bg-slate-800 transition-colors focus:outline-none focus:border-slate-600"
          value={selectedTenantName}
          onChange={(e) => onTenantChange(e.target.value)}
          disabled={tenantNamesLoading}
        >
          {tenantNamesLoading
            ? <option value="">Loading tenants...</option>
            : tenantNames.length === 0
              ? <option value="">No tenants found</option>
              : tenantNames.map((n) => <option key={n} value={n}>{n}</option>)
          }
        </select>
        <select
          className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 text-sm hover:bg-slate-800 transition-colors focus:outline-none focus:border-slate-600"
          value={windowDays}
          onChange={(e) => onWindowChange(Number(e.target.value) === 30 ? 30 : 7)}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer ml-2 select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={allowUnscoped}
            onChange={(e) => onAllowUnscopedChange(e.target.checked)}
            className="rounded bg-slate-900 border-slate-600"
          />
          Include unscoped
        </label>
        <button
          className="ml-auto bg-indigo-400 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 px-6 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          disabled={nlRunning || !selectedTenantName || tenantNamesLoading}
          onClick={() => onRun(selectedTenantName, windowDays, allowUnscoped)}
        >
          {nlRunning ? "Running..." : "Run Report"}
        </button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* error / not-found case */}
        {isError && (
          <div className="bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-3">
            <p className="text-red-300 text-sm">
              {payload?.error ?? "Tenant not found."}
            </p>
            {suggestedTenants.length > 0 && (
              <p className="text-slate-400 text-xs mt-2">
                Suggested: {suggestedTenants.join(", ")}
              </p>
            )}
          </div>
        )}

        {/* warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3">
                <p className="text-slate-300 text-sm">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* Stats Grid */}
        {!isError && (
          <div className="grid grid-cols-5 gap-4">
            {/* Alerts */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4">
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Alerts</div>
              <div className="text-slate-200 text-3xl font-medium">{alertsReturned}</div>
              {alertsFetched > alertsReturned && (
                <div className="text-slate-500 text-xs mt-1">{alertsFetched} fetched</div>
              )}
            </div>
            {/* Alarms */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4">
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Alarms</div>
              <div className="text-slate-200 text-3xl font-medium">{alarmsReturned}</div>
              {alarmsFetched > alarmsReturned && (
                <div className="text-slate-500 text-xs mt-1">{alarmsFetched} fetched</div>
              )}
            </div>
            {/* Scope */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4">
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Scope</div>
              <div className="text-slate-200 text-3xl font-medium">{epgCount}</div>
              <div className="text-slate-500 text-xs mt-1">
                EPG{epgCount !== 1 ? "s" : ""}{vrfCount > 0 ? ` · ${vrfCount} VRF` : ""}
              </div>
            </div>
            {/* Worst severity */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4">
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Worst</div>
              {topSev ? (() => { const c = sevColor(topSev); return (
                <div className={`${c.label} text-xl font-medium capitalize flex items-center gap-2`}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
                  {topSev}
                </div>
              ); })() : (
                <div className="text-slate-400 text-xl font-medium">—</div>
              )}
            </div>
            {/* By Severity */}
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-4">
              <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">By Severity</div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {Object.entries(sevCounts).length > 0 ? (
                  Object.entries(sevCounts)
                    .sort((a, b) => (sevOrder[a[0]] ?? 9) - (sevOrder[b[0]] ?? 9))
                    .map(([sev, cnt]) => (
                      <div key={sev} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sevColor(sev).dot }} />
                        <span className="text-slate-300 text-sm">{sev} · {cnt}</span>
                      </div>
                    ))
                ) : (
                  <span className="text-slate-500 text-sm">—</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scope Terms */}
        {!isError && scopeTerms.length > 0 && (
          <div>
            <div className="text-slate-400 text-sm uppercase tracking-wide mb-3">Scope Terms</div>
            <div className="flex flex-wrap gap-2">
              {scopeTerms.map((t, i) => (
                <span
                  key={i}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-300 text-xs font-mono"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Top unscoped activity — shown when alerts/alarms arrays are empty but system activity exists */}
        {!isError && hasUnscopedActivity && alertsReturned === 0 && alarmsReturned === 0 && (
          <div className="bg-blue-900/20 border border-blue-900/40 rounded-lg p-4">
            <div className="text-blue-300 text-sm font-semibold mb-3">
              Top Activity (unscoped / system-wide)
            </div>
            {topUnscopedAlerts.length > 0 && (
              <>
                <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Alerts</div>
                {topUnscopedAlerts.map(([res, cnt], i) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-1.5 ${i < topUnscopedAlerts.length - 1 ? "border-b border-slate-700/50" : ""}`}>
                    <span className="text-slate-400 font-mono text-xs break-all flex-1 mr-3">{res}</span>
                    <span className="text-slate-200 font-semibold whitespace-nowrap">{cnt}</span>
                  </div>
                ))}
              </>
            )}
            {topUnscopedAlerts.length > 0 && topUnscopedAlarms.length > 0 && <div className="mt-3" />}
            {topUnscopedAlarms.length > 0 && (
              <>
                <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">Alarms</div>
                {topUnscopedAlarms.map(([res, cnt], i) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-1.5 ${i < topUnscopedAlarms.length - 1 ? "border-b border-slate-700/50" : ""}`}>
                    <span className="text-slate-400 font-mono text-xs break-all flex-1 mr-3">{res}</span>
                    <span className="text-slate-200 font-semibold whitespace-nowrap">{cnt}</span>
                  </div>
                ))}
              </>
            )}
            <p className="text-slate-500 text-xs mt-3">
              Enable "Include unscoped" above and re-run to include these in results.
            </p>
          </div>
        )}

        {/* Tabs */}
        {!isError && (alerts.length > 0 || alarms.length > 0 || nextActions.length > 0) && (
          <>
            <div className="flex gap-1 border-b border-slate-700">
              <button
                onClick={() => setActiveTab("alerts")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "alerts"
                    ? "border-indigo-400 text-slate-200"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                Alerts{alerts.length > 0 ? ` (${alerts.length})` : ""}
              </button>
              <button
                onClick={() => setActiveTab("alarms")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "alarms"
                    ? "border-indigo-400 text-slate-200"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                Alarms{alarms.length > 0 ? ` (${alarms.length})` : ""}
              </button>
              {nextActions.length > 0 && (
                <button
                  onClick={() => setActiveTab("actions")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "actions"
                      ? "border-indigo-400 text-slate-200"
                      : "border-transparent text-slate-400 hover:text-slate-300"
                  }`}
                >
                  Next Steps ({nextActions.length})
                </button>
              )}
            </div>

            {/* Alerts tab */}
            {activeTab === "alerts" && (
              <div className="space-y-2" style={{ maxHeight: 400, overflowY: "auto" }}>
                {alerts.length === 0 ? (
                  <div className="text-slate-500 text-sm py-4">No alerts in this window.</div>
                ) : alerts.map((a: any, i: number) => {
                  const sev = String(a.severity ?? a.alert_severity ?? "").toLowerCase();
                  const leftBorder = sev === "critical" ? "border-l-red-500/60" : sev === "major" ? "border-l-orange-500/60" : "border-l-transparent";
                  return (
                  <div key={i} className={`bg-slate-900/50 border border-slate-700 ${leftBorder} border-l-2 rounded-lg px-4 py-3 hover:bg-slate-900/70 transition-colors`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-slate-200 text-sm">
                          {a.message ?? a.description ?? a.alert_name ?? a.name ?? "Alert"}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-slate-500 text-xs">
                          <span>{fmtTs(a.timestamp ?? a.raised_at ?? a.created_at ?? "")}</span>
                          {a.resource && (
                            <>
                              <span>·</span>
                              <span>{String(a.resource).split("/").pop()}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <SevPill value={a.severity ?? a.alert_severity ?? ""} />
                    </div>
                  </div>
                  );
                })}
              </div>
            )}

            {/* Alarms tab */}
            {activeTab === "alarms" && (
              <div className="space-y-2" style={{ maxHeight: 400, overflowY: "auto" }}>
                {alarms.length === 0 ? (
                  <div className="text-slate-500 text-sm py-4">No alarms in this window.</div>
                ) : alarms.map((a: any, i: number) => {
                  const sev = String(a.severity ?? a.alarm_severity ?? "").toLowerCase();
                  const leftBorder = sev === "critical" ? "border-l-red-500/60" : sev === "major" ? "border-l-orange-500/60" : "border-l-transparent";
                  return (
                  <div key={i} className={`bg-slate-900/50 border border-slate-700 ${leftBorder} border-l-2 rounded-lg px-4 py-3 hover:bg-slate-900/70 transition-colors`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-slate-200 text-sm">
                          {a.alarm_name ?? a.name ?? a.message ?? a.description ?? "Alarm"}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-slate-500 text-xs">
                          <span>{fmtTs(a.raised_at ?? a.timestamp ?? a.created_at ?? "")}</span>
                          {(a.resource ?? a.epg ?? a.vrf) && (
                            <>
                              <span>·</span>
                              <span>{a.resource ?? a.epg ?? a.vrf}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <SevPill value={a.severity ?? a.alarm_severity ?? ""} />
                    </div>
                  </div>
                  );
                })}
              </div>
            )}

            {/* Next actions tab */}
            {activeTab === "actions" && nextActions.length > 0 && (
              <div className="space-y-2">
                {nextActions.map((a: any, i: number) => (
                  <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3">
                    <p className="text-slate-200 text-sm font-medium">
                      {a.action ?? a.label ?? String(a)}
                    </p>
                    {a.hint && (
                      <p className="text-slate-500 text-xs mt-1">{a.hint}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!isError && alertsReturned === 0 && alarmsReturned === 0 && nextActions.length === 0 && !hasUnscopedActivity && (
          <div className="text-slate-500 text-sm text-center py-8">
            No alerts or alarms found for this tenant in the selected window.
          </div>
        )}
      </div>
    </div>
  );
}

