// Server Settings admin panel — runtime configuration that takes effect
// immediately (auth token TTL, rate limit, RESTCONF defaults, XCO timeouts).
//
// Pure presentational: parent owns the data fetch + persistence. The panel
// calls onChangeSetting(key, value) when the user blurs a field or clicks
// the Update button, and the parent decides whether/how to PATCH the API.
//
// Extracted from App.tsx.

import { FG, widgetContainer, btnClose, hoverClose } from "../../lib/figmaStyles";

export interface ServerSettingsValues {
  oauth2_token_ttl?: number;
  rate_limit_rpm?: number;
  restconf_username?: string;
  restconf_password?: string;
  xco_timeout_seconds?: number;
  stale_plan_max_age_minutes?: number;
  [key: string]: any;
}

export interface ServerSettingsPanelProps {
  open: boolean;
  loading: boolean;
  err: string;
  settings: ServerSettingsValues;
  onChangeSetting: (key: string, value: any) => void;
  onClose: () => void;
  /** Extra config sections composed below the runtime settings — MCP
   *  server / Ollama / OpenAI-key sections live here so the panel is the
   *  single home for client configuration. */
  children?: React.ReactNode;
}

export function ServerSettingsPanel({
  open, loading, err, settings, onChangeSetting, onClose, children,
}: ServerSettingsPanelProps) {
  if (!open) return null;
  const fld: React.CSSProperties = { background: "rgba(0,0,0,0.3)", border: "1px solid var(--subtle-border)", borderRadius: 6, padding: "6px 10px", color: "var(--heading-color)", fontSize: 13 };
  const lbl: React.CSSProperties = { color: "var(--muted-color)", fontSize: 11, marginBottom: 3 };
  const sectionTitle: React.CSSProperties = { color: "var(--muted-color)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8, marginTop: 16 };
  return (
    <div style={widgetContainer()}>
      <div style={{ background: "var(--header-tint-bg)", padding: "16px 24px", borderBottom: "1px solid var(--container-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, color: FG.headingColor, fontSize: 18, fontWeight: 500 }}>Server Settings</h2>
          <p style={{ margin: "2px 0 0", color: "var(--dim-color)", fontSize: 12 }}>Runtime configuration — changes take effect immediately</p>
        </div>
        <button onClick={onClose} style={btnClose()} {...hoverClose()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div style={{ padding: 24 }}>
        {loading && <div style={{ color: "var(--muted-color)", textAlign: "center", padding: 24 }}>Loading settings...</div>}
        {err && <div className="bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-3 text-red-300 text-sm mb-4">{err}</div>}
        {!loading && (
          <div>
            {/* Authentication */}
            <div style={sectionTitle}>Authentication</div>
            <div className="flex gap-3 mb-3">
              <div style={{ flex: 1 }}>
                <div style={lbl}>Token TTL (seconds)</div>
                <input type="number" defaultValue={settings.oauth2_token_ttl ?? 3600}
                  onBlur={(e) => onChangeSetting("oauth2_token_ttl", Number(e.target.value))}
                  style={{ ...fld, width: "100%" }} />
                <div style={{ color: "var(--dim-color)", fontSize: 10, marginTop: 2 }}>Only affects new tokens</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Rate Limit (requests/min)</div>
                <input type="number" defaultValue={settings.rate_limit_rpm ?? 60}
                  onBlur={(e) => onChangeSetting("rate_limit_rpm", Number(e.target.value))}
                  style={{ ...fld, width: "100%" }} />
              </div>
            </div>

            {/* Switch Access */}
            <div style={sectionTitle}>Switch Access (RESTCONF)</div>
            <div className="flex gap-3 mb-3">
              <div style={{ flex: 1 }}>
                <div style={lbl}>Default Username</div>
                <input defaultValue={settings.restconf_username ?? "admin"}
                  onBlur={(e) => onChangeSetting("restconf_username", e.target.value)}
                  style={{ ...fld, width: "100%" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Default Password</div>
                <div className="flex gap-2">
                  <input type="password" placeholder="***" id="rcPass"
                    style={{ ...fld, flex: 1 }} />
                  <button onClick={() => {
                    const v = (document.getElementById("rcPass") as HTMLInputElement)?.value;
                    if (v) onChangeSetting("restconf_password", v);
                  }}
                    className="px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 transition-colors">
                    Update
                  </button>
                </div>
                <div style={{ color: "var(--dim-color)", fontSize: 10, marginTop: 2 }}>Global default for all switch access</div>
              </div>
            </div>

            {/* XCO Communication */}
            <div style={sectionTitle}>XCO Communication</div>
            <div className="flex gap-3 mb-3">
              <div style={{ flex: 1 }}>
                <div style={lbl}>XCO Timeout (seconds)</div>
                <input type="number" defaultValue={settings.xco_timeout_seconds ?? 20}
                  onBlur={(e) => onChangeSetting("xco_timeout_seconds", Number(e.target.value))}
                  style={{ ...fld, width: "100%" }} />
                <div style={{ color: "var(--dim-color)", fontSize: 10, marginTop: 2 }}>Increase for slow networks</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Stale Plan Max Age (minutes)</div>
                <input type="number" defaultValue={settings.stale_plan_max_age_minutes ?? 60}
                  onBlur={(e) => onChangeSetting("stale_plan_max_age_minutes", Number(e.target.value))}
                  style={{ ...fld, width: "100%" }} />
                <div style={{ color: "var(--dim-color)", fontSize: 10, marginTop: 2 }}>Pending plans older than this are cleaned up</div>
              </div>
            </div>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
