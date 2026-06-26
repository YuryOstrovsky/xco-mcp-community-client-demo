// Running Config widget — renders `show running-config` output as a
// CLI-styled scroll with optional fullscreen overlay. Accepts the raw
// API payload; parent passes through `resp.raw`.
//
// Pure presentational: parent owns the fullscreen flag and the
// open/close state.
//
// Extracted from App.tsx.

import { Panel } from "../../components/Panel";
import { CopyButton } from "../../components/CopyButton";

export interface RunningConfigWidgetProps {
  open: boolean;
  /** Raw API response (resp.raw). The widget unwraps result.payload itself. */
  raw: any;
  fullscreen: boolean;
  setFullscreen: (v: boolean) => void;
  onClose: () => void;
}

export function RunningConfigWidget({ open, raw, fullscreen, setFullscreen, onClose }: RunningConfigWidgetProps) {
  if (!open) return null;
  const payload2: any = raw?.result?.payload ?? raw?.payload ?? {};
  const meta2: any = payload2?.meta ?? {};
  const summary2: any = payload2?.summary ?? {};
  const items2: any[] = Array.isArray(payload2?.items) ? payload2.items : [];
  const hostName2: string = summary2?.host_name ?? meta2?.switch_ip ?? "switch";
  const chassisName2: string = summary2?.chassis_name ?? "";
  const switchIp2: string = meta2?.switch_ip ?? "";

  const rcLines: string[] = [];
  rcLines.push(`${hostName2}# show running-config`);
  rcLines.push("!");

  const hasCliLines = items2.some((it: any) => Array.isArray(it?.cli_lines) && it.cli_lines.length > 0);

  if (hasCliLines) {
    for (const item of items2) {
      if (!Array.isArray(item?.cli_lines) || item.cli_lines.length === 0) continue;
      for (const line of item.cli_lines) rcLines.push(line);
      if (rcLines[rcLines.length - 1] !== "!") rcLines.push("!");
    }
  } else {
    if (chassisName2) {
      rcLines.push(`switch-attributes chassis-name ${chassisName2}`);
      rcLines.push(`switch-attributes host-name ${hostName2}`);
      rcLines.push("!");
    }
    const seen2 = new Set<string>();
    for (const item of items2) {
      const sec: string = item?.section ?? "";
      const self: string | null = item?.self ?? null;
      if (!sec) continue;
      const key2 = `${sec}::${self ?? ""}`;
      if (seen2.has(key2)) continue;
      seen2.add(key2);
      rcLines.push(sec);
      if (self) rcLines.push(` ! path: ${self}`);
      rcLines.push("!");
    }
  }

  const renderedCount: number = (summary2 as any)?.rendered_sections ?? items2.filter((it: any) => Array.isArray(it?.cli_lines)).length;
  rcLines.push(`! end  (${items2.length} sections, ${renderedCount} rendered)`);
  const cliText2 = rcLines.join("\n");

  const renderCliLines = (fs: boolean) => rcLines.map((line, i) => {
    const isPrompt     = line.includes("# show");
    const isBang       = line === "!";
    const isComment    = line.startsWith(" ! path:");
    const isEnd        = line.startsWith("! end");
    const isSectionHdr = !isPrompt && !isBang && !isComment && !isEnd && !line.startsWith(" ");
    const color = isPrompt     ? "#7ee787"
                : isBang       ? "#3A4458"
                : isComment    ? "rgba(248,248,251,0.35)"
                : isEnd        ? "rgba(248,248,251,0.45)"
                : isSectionHdr ? "var(--accent)"
                : "#e6edf3";
    return <div key={i} style={{ color, whiteSpace: "pre", fontSize: fs ? 13 : 12 }}>{line || " "}</div>;
  });

  const titleBar = (fs: boolean) => (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: fs ? "12px 18px" : "8px 14px",
      borderBottom: "1px solid var(--border)", flexShrink: 0,
    }}>
      <div>
        <span style={{ color: "#7ee787", fontWeight: 700, fontFamily: "monospace", fontSize: fs ? 14 : 12 }}>
          {hostName2}
        </span>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginLeft: 8 }}>
          {chassisName2 && `${chassisName2} · `}{switchIp2} · {items2.length} sections
        </span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <CopyButton text={cliText2} darkContext />
        {fs ? (
          <button style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "#e6edf3", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
            onClick={() => setFullscreen(false)}>
            ⊡ Exit Full Screen
          </button>
        ) : (
          <button style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "#e6edf3", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
            onClick={() => setFullscreen(true)}>
            ⛶ Full Screen
          </button>
        )}
        <button style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "#e6edf3", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
          onClick={() => { onClose(); setFullscreen(false); }}>
          ✕
        </button>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div key="rc-fs" style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={() => setFullscreen(false)}>
        <div style={{ width: "min(96vw,1100px)", height: "min(92vh,860px)", background: "#161B27", border: "1px solid var(--border)", borderRadius: 14, display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.7)" }}
          onClick={(e) => e.stopPropagation()}>
          {titleBar(true)}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", fontFamily: "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Courier New',monospace", lineHeight: 1.65 }}>
            {renderCliLines(true)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Panel key="rc-inline" title="Running Config" onClose={onClose}>
      <div style={{ background: "#161B27", borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border)" }}>
        {titleBar(false)}
        <div style={{ height: 420, overflowY: "auto", padding: "12px 16px", fontFamily: "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Courier New',monospace", lineHeight: 1.6 }}>
          {renderCliLines(false)}
        </div>
      </div>
    </Panel>
  );
}
