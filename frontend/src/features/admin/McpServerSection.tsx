// MCP server connection section of Client Config.
//
// URL plus Save + Test buttons. The Test button calls
// /api/client-settings/test-mcp and pops an alert with the result; Save
// patches the mcp_base_url client-setting field. The community MCP server
// needs no authentication, so there are no Client ID / Client Secret fields.

import { type CSSProperties } from "react";
import { postJSON } from "../../lib/api";

export interface McpServerSectionProps {
  config: any;
  saveSetting: (key: string, value: any) => void;
}

const sectionTitle: CSSProperties = { color: "var(--muted-color)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 0, marginBottom: 10 };
const fld: CSSProperties = { background: "rgba(0,0,0,0.3)", border: "1px solid var(--subtle-border)", borderRadius: 6, padding: "6px 10px", color: "var(--heading-color)", fontSize: 12, flex: 1 };
const lbl: CSSProperties = { color: "var(--muted-color)", fontSize: 11, marginBottom: 3 };

export function McpServerSection({ config, saveSetting }: McpServerSectionProps) {
  return (
    <>
      <div style={sectionTitle}>MCP Server Connection</div>
      <div className="space-y-3 mb-4">
        <div>
          <div style={lbl}>MCP Server URL</div>
          <div className="flex gap-2">
            <input defaultValue={config.mcp_base_url || ""} id="ccMcpUrl" placeholder="http://127.0.0.1:8000" style={fld} />
            <button onClick={async () => {
              const url = (document.getElementById("ccMcpUrl") as HTMLInputElement)?.value?.trim();
              if (url) await saveSetting("mcp_base_url", url);
            }} className="px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 transition-colors whitespace-nowrap">Save</button>
            <button onClick={async () => {
              try {
                const r = await postJSON<any>("/api/client-settings/test-mcp", {});
                alert(r?.ok ? `✓ Connected to ${r.mcp_base_url}` : `✗ Failed: ${r?.error}`);
              } catch (e: any) { alert(`Test failed: ${e.message}`); }
            }} className="px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 transition-colors whitespace-nowrap">Test</button>
          </div>
        </div>
      </div>
    </>
  );
}
