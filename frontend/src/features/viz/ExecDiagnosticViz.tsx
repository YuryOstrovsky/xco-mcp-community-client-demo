// Execution Diagnostic viz — status pill + endpoint card + execution
// log. Rendered when viz.kind === "exec_diagnostic".
//
// Pure presentational. Extracted from App.tsx.

export interface ExecDiagnosticVizProps {
  data: any;
}

export function ExecDiagnosticViz({ data: ex }: ExecDiagnosticVizProps) {
  if (!ex) return null;
  const failed = ex.status === "failed";
  const levelColor = (lvl: string) =>
    lvl === "error" ? "rgba(255,80,80,0.95)"
    : lvl === "warn" || lvl === "warning" ? "rgba(255,200,0,0.95)"
    : lvl === "debug" ? "rgba(140,140,160,0.8)"
    : "rgba(180,200,255,0.8)";
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-white/5" style={{
        padding: 14,
        borderColor: failed ? "rgba(255,80,80,0.35)" : "rgba(60,220,120,0.35)",
      }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="px-3 py-1 rounded-full text-xs font-bold" style={{
            background: failed ? "rgba(255,80,80,0.18)" : "rgba(60,220,120,0.18)",
            color: failed ? "rgba(255,100,100,0.95)" : "rgba(60,220,120,0.95)",
            border: `1px solid ${failed ? "rgba(255,80,80,0.35)" : "rgba(60,220,120,0.35)"}`,
          }}>
            {ex.status.toUpperCase()}
          </span>
          <span className="text-xs opacity-50 font-mono">{ex.executionId}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <div className="text-xs opacity-60 mb-1">Endpoint</div>
            <div className="font-mono text-xs rounded px-2 py-1" style={{ background: "rgba(0,0,0,0.3)" }}>
              <span className="opacity-60">{ex.method} </span>{ex.urlPath}
            </div>
            {ex.urlParams && (
              <div className="font-mono text-xs opacity-50 mt-1 pl-2 truncate">?{ex.urlParams}</div>
            )}
          </div>
          <div>
            <div className="text-xs opacity-60">Started</div>
            <div style={{ fontWeight: 600 }}>{ex.startTime.replace("T", " ").replace("Z", " UTC")}</div>
          </div>
          <div>
            <div className="text-xs opacity-60">Duration</div>
            <div style={{ fontWeight: 600 }}>{ex.duration}</div>
          </div>
        </div>
      </div>

      {ex.logLines.length > 0 && (
        <div>
          <div className="text-xs opacity-60 mb-2">Execution log</div>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            {ex.logLines.map((l: any, i: number) => {
              const lvl: string = String(l?.level ?? "info").toLowerCase();
              const time: string = String(l?.["@time"] ?? l?.time ?? "").split(".")[0].replace(" UTC","");
              const msg: string = String(l?.msg ?? "");
              return (
                <div key={i} className="flex items-start gap-2 px-3 py-1 text-xs"
                  style={{ borderTop: i ? "1px solid var(--subtle-bg)" : undefined,
                    background: lvl === "error" ? "rgba(255,80,80,0.06)" : undefined }}>
                  <span className="opacity-40 shrink-0 font-mono">{time.split("T")[1] || time}</span>
                  <span className="px-1 rounded shrink-0 font-bold text-xs" style={{ color: levelColor(lvl) }}>{lvl.toUpperCase()}</span>
                  <span className="opacity-85">{msg}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
