// SoftwareVersionMismatchWidget — renders the software-version-mismatch tool-result payload.

import { Fragment } from "react";

export function SoftwareVersionMismatchWidget({
  payload,
  onClose,
}: {
  payload: any;
  onClose: () => void;
}) {
  const summary: any     = payload?.summary    ?? {};
  const groups: any[]    = payload?.groups     ?? [];
  const recs: string[]   = payload?.recommendations ?? [];
  const warnings: any[]  = payload?.signals?.warnings ?? [];
  const headline: string = payload?.headline   ?? "";
  const filter: any      = payload?.filter     ?? {};

  const hasMismatch = (summary?.groups_with_mismatch ?? 0) > 0;
  const groupBy: string = filter?.group_by ?? "fabric";

  const switchesScanned = Number(summary?.switches_scanned ?? 0);
  const groupsScanned = Number(summary?.groups_scanned ?? groups.length ?? 0);
  const groupsWithMismatch = Number(summary?.groups_with_mismatch ?? 0);
  const dominantVersion = String(summary?.global_dominant_version ?? "—");
  const missingVersionCount = Number(summary?.missing_version_count ?? 0);

  const visibleRecs = recs.length
    ? recs
    : [`Global dominant firmware/version is '${dominantVersion}'.`];

  return (
    <div className="w-full max-w-6xl bg-slate-800 rounded-xl shadow-xl overflow-hidden border border-slate-700">
      {/* Header */}
      <div className="bg-indigo-300/10 px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-slate-200 text-lg font-medium">
              Software Version Consistency
            </h2>
            <p className="text-slate-400 text-sm mt-0.5">
              grouped by {groupBy} · {switchesScanned} switches · {groupsScanned} groups
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
        {/* Status Banner */}
        <div className={`flex items-start gap-3 rounded-lg px-4 py-3 ${
          hasMismatch
            ? "bg-red-500/10 border border-red-500/30"
            : "bg-cyan-500/10 border border-cyan-500/30"
        }`}>
          <svg className={`mt-0.5 flex-shrink-0 ${hasMismatch ? "text-red-400" : "text-cyan-400"}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <p className={`text-sm ${hasMismatch ? "text-red-400/90" : "text-cyan-400/90"}`}>
            {headline || (hasMismatch
              ? `${groupsWithMismatch} group${groupsWithMismatch !== 1 ? "s" : ""} have version mismatches.`
              : `All ${switchesScanned} switches are on ${dominantVersion} — no mismatches detected.`)}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">
              Dominant Version
            </div>
            <div className="text-indigo-300 text-4xl font-medium">{dominantVersion}</div>
            <div className="text-slate-500 text-sm mt-1">{switchesScanned} switches</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">
              Mismatches
            </div>
            <div className="text-slate-200 text-4xl font-medium">{groupsWithMismatch}</div>
            <div className="text-slate-500 text-sm mt-1">of {groupsScanned} groups</div>
          </div>
        </div>

        {/* Table */}
        {groups.length > 0 && (
          <div>
            <div className="text-slate-400 text-xs uppercase tracking-wide mb-3">
              By {groupBy}
            </div>
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-slate-700 bg-slate-900/30">
                <div className="col-span-3 text-slate-500 text-xs uppercase tracking-wide">Group</div>
                <div className="col-span-4 text-slate-500 text-xs uppercase tracking-wide">Switches/Versions</div>
                <div className="col-span-3 text-slate-500 text-xs uppercase tracking-wide">Dominant</div>
                <div className="col-span-2 text-slate-500 text-xs uppercase tracking-wide">Status</div>
              </div>

              {/* Table Rows */}
              {groups.map((g: any, i: number) => {
                const key = Array.isArray(g.key) ? g.key.join(", ") : String(g.key ?? "—");
                const versions = Object.entries(g.versions ?? {}) as [string, number][];
                const versionText = versions.map(([v, c]) => `${v}${c ? ` +${c}` : ""}`).join(" · ");
                const isMismatch = g.mismatch === true;

                return (
                  <Fragment key={i}>
                  <div
                    className={`grid grid-cols-12 gap-4 px-4 py-3 hover:bg-slate-900/70 transition-colors ${
                      i < groups.length - 1 && !isMismatch ? "border-b border-slate-700/50" : ""
                    }`}
                  >
                    <div className="col-span-3 text-slate-200 text-sm">{key}</div>
                    <div className="col-span-4 text-slate-300 text-sm font-mono">
                      {Number(g?.switches ?? 0)}&nbsp;&nbsp;<span className="text-slate-500">{versionText || "—"}</span>
                    </div>
                    <div className="col-span-3 text-slate-300 text-sm">{String(g?.group_dominant_version ?? "—")}</div>
                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isMismatch ? "bg-red-500" : "bg-cyan-500"}`} />
                        <span className={`text-sm uppercase tracking-wide ${isMismatch ? "text-red-400" : "text-slate-300"}`}>
                          {isMismatch ? "Mismatch" : "OK"}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isMismatch && Array.isArray(g.outliers) && g.outliers.length > 0 && (
                    <div className="px-4 py-2 bg-red-500/5 border-b border-slate-700/50">
                      <div className="text-slate-500 text-xs uppercase mb-2 pl-4">Mismatched switches</div>
                      {g.outliers.map((o: any, oi: number) => (
                        <div key={oi} className="flex items-center justify-between pl-4 py-1.5">
                          <div className="flex items-center gap-3">
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171" }} />
                            <span className="text-slate-200 text-sm font-medium">{o.name || o.ip}</span>
                            {o.name && <code className="text-slate-400 text-xs">{o.ip}</code>}
                            <span className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-slate-400 border border-slate-600">{o.role}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-red-400 text-sm font-mono">{o.firmware}</span>
                            <span className="text-slate-600 text-xs">needs {String(g.reference_version || g.group_dominant_version || "—")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Missing version warning */}
        {missingVersionCount > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
            <p className="text-yellow-300 text-sm font-medium">
              {missingVersionCount} switches are missing a reported software version.
            </p>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
            <div className="text-yellow-300 text-xs uppercase tracking-wide mb-2">Warnings</div>
            {warnings.map((w: any, j: number) => (
              <p key={j} className="text-yellow-200/80 text-sm">
                {typeof w === "string" ? w : JSON.stringify(w)}
              </p>
            ))}
          </div>
        )}

        {/* Recommendations */}
        <div>
          <div className="text-slate-400 text-xs uppercase tracking-wide mb-3">
            Recommendations
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3">
            {visibleRecs.map((r: string, j: number) => (
              <div key={j} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-2 flex-shrink-0" />
                <p className="text-slate-300 text-sm">{r}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

