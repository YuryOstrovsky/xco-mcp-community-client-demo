// Natural Language Examples modal — categorized command list that fills
// the AI Console when clicked. Examples include fabric/switch names
// from the live inventory so they're paste-ready.
//
// Pure presentational: parent computes the substitution names (fab,
// leaves, spines) and passes them in, then handles the click via
// onPick(cmd).
//
// Extracted from App.tsx.
//
// #146: print / save-as-PDF support via native window.print() + a
// scoped @media print stylesheet. Zero npm deps — the browser's
// print dialog already supports "Save as PDF" on every desktop OS
// (and iOS via the Share sheet). The Print button expands all
// categories first so the printout is the complete cheat-sheet,
// then restores the previous expanded state after the dialog closes.

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

// Print stylesheet — injected into <head> on first mount. Targets
// data-help-print attributes (not class names) so it can't collide
// with anything else in the app's CSS.
//
// Strategy: hide the whole document except the modal, strip the dark
// theme to white-on-black for readable / toner-friendly print, and
// add page-break hints between categories. The backdrop, close
// button, print button itself, and footer all carry
// data-help-print="hide" so they vanish on paper.
const PRINT_STYLE_ID = "help-widget-print-css";
const PRINT_CSS = `
@media print {
  /* Hide everything by default — then re-show only the help modal. */
  body * { visibility: hidden !important; }
  [data-help-print="modal"],
  [data-help-print="modal"] * { visibility: visible !important; }

  /* Anything explicitly opted-out stays hidden (backdrop, close X,
     print button, footer pro-tip). */
  [data-help-print="hide"] { display: none !important; }

  /* Flatten the fixed-position modal into a normal-flow document. */
  [data-help-print="modal"] {
    position: static !important;
    inset: auto !important;
    transform: none !important;
    width: 100% !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: white !important;
    color: black !important;
    box-shadow: none !important;
    overflow: visible !important;
  }
  /* Strip the dark theme on everything inside. */
  [data-help-print="modal"] * {
    background: white !important;
    color: black !important;
    border-color: #999 !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }
  /* Category gradient chips → plain outline so the printout is
     toner-friendly. The chip stays as a visual anchor for the
     category name. */
  [data-help-print="modal"] [class*="bg-gradient"] {
    background: white !important;
    border: 1px solid black !important;
  }
  [data-help-print="modal"] svg { color: black !important; stroke: black !important; }
  /* The body container's overflow:auto messes with print pagination —
     let content flow. */
  [data-help-print="body"] {
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
    padding: 8mm 6mm !important;
  }
  /* Page-break hints: keep each category together when possible,
     never split mid-row. */
  [data-help-print="category"] {
    page-break-inside: avoid;
    break-inside: avoid;
    margin-bottom: 8pt !important;
  }
  [data-help-print="row"] {
    page-break-inside: avoid;
    break-inside: avoid;
    padding: 4pt 6pt !important;
    border-bottom: 1px dotted #ccc !important;
  }
  /* Compact typography for paper. */
  [data-help-print="modal"] h2 { font-size: 16pt !important; margin: 0 0 4pt !important; }
  [data-help-print="modal"] h3 { font-size: 11pt !important; margin: 6pt 0 4pt !important; letter-spacing: 0.04em !important; }
  [data-help-print="modal"] code { font-size: 10pt !important; font-family: monospace !important; }
  [data-help-print="modal"] [data-help-print="desc"] { font-size: 9pt !important; color: #555 !important; }
  /* Page setup — A4 / Letter with reasonable margins. */
  @page { margin: 12mm; }
}
`;

export interface HelpCommandItem {
  cmd: string;
  desc: string;
}

export interface HelpCategory {
  id: string;
  label: string;
  gradient: string;
  items: HelpCommandItem[];
}

export interface HelpWidgetProps {
  open: boolean;
  expandedCats: Set<string>;
  setExpandedCats: Dispatch<SetStateAction<Set<string>>>;
  /** Live fabric/tenant/leaf/spine names for example substitution. */
  exampleNames: {
    fab: string;
    /** A real tenant name from the current site (tenant-scoped examples). */
    tenant: string;
    /** Leaf-N name lookup. Falls back to "Leaf-N+1" inside. */
    leaf: (i: number) => string;
    /** Spine-N name lookup. Falls back to "Spine-N+1" inside. */
    spine: (i: number) => string;
  };
  onClose: () => void;
  onPick: (cmd: string) => void;
}

export function HelpWidget({ open, expandedCats, setExpandedCats, exampleNames, onClose, onPick }: HelpWidgetProps) {
  // Inject the print stylesheet once per page load. Safe to call
  // even when the widget is closed — we want the rules ready when
  // the user does open + print. Using a stable id so multiple mounts
  // (rare, but possible with strict-mode) don't duplicate.
  useEffect(() => {
    if (document.getElementById(PRINT_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = PRINT_STYLE_ID;
    el.textContent = PRINT_CSS;
    document.head.appendChild(el);
    // Don't clean up on unmount — leaving it in is harmless and
    // avoids re-injection cost if the user opens/closes the modal
    // many times.
  }, []);

  // Free-text filter over command + description (and category label).
  const [query, setQuery] = useState("");

  if (!open) return null;
  const { fab, tenant: ten, leaf: l, spine: sp } = exampleNames;
  const toggleCat = (id: string) => setExpandedCats((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Print / Save-as-PDF handler. Expands every category so the
  // printout is the complete cheat-sheet (not whatever the operator
  // happened to have open), waits one frame for React to commit the
  // expansion, fires the native print dialog, then restores the
  // previous expanded state after the dialog returns. The browser's
  // print dialog has a "Save as PDF" destination on every desktop
  // OS — that's the export path with zero new dependencies.
  function handlePrint() {
    const prevExpanded = expandedCats;
    const allIds = new Set<string>([
      "monitoring", "switch", "fleet-reports", "find-host", "xco-health",
      "tenant", "admin",
    ]);
    setExpandedCats(allIds);
    // Two RAFs: first lets React commit the state change, second
    // lets the browser paint with the new DOM. window.print() is
    // synchronous and blocks until the dialog closes.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setExpandedCats(prevExpanded);
      });
    });
  }

  const cats: HelpCategory[] = [
    { id: "monitoring", label: "Monitoring & Visibility", gradient: "from-cyan-500 via-blue-500 to-indigo-600", items: [
      { cmd: "show fabrics", desc: "Fabric health overview" },
      { cmd: "show fabric health for " + fab, desc: "Drill into a specific fabric — health + device counts" },
      { cmd: "show switches", desc: "Switch topology overview (donut + summary table by role/fabric)" },
      { cmd: "list switches", desc: "Same — alternate phrasing for the topology overview" },
      { cmd: "show software versions", desc: "Firmware consistency check" },
      { cmd: "any alarms?", desc: "Alarm details with severity breakdown" },
      { cmd: "how is my network?", desc: "Overall health summary" },
      { cmd: "check BGP status", desc: "All switches BGP neighbors" },
      { cmd: "check BGP status for switch " + sp(0), desc: "Single switch BGP neighbors" },
      { cmd: "show tenants", desc: "Tenant list" },
      { cmd: "show EPGs", desc: "Endpoint groups" },
      { cmd: "what's running?", desc: "Execution status" },
      { cmd: "show uptime", desc: "All switch clocks/uptime" },
      { cmd: "show clock on switch " + sp(0), desc: "Single switch clock" },
    ]},
    { id: "switch", label: "Per-Switch Details", gradient: "from-violet-500 via-purple-500 to-fuchsia-600", items: [
      { cmd: "show running config on switch " + l(0), desc: "Full running configuration" },
      { cmd: "show interfaces on switch " + sp(0), desc: "Interface table" },
      { cmd: "show vlan brief on switch " + (l(1) || l(0)), desc: "VLAN summary" },
      { cmd: "show vrf on switch " + l(0), desc: "VRF summary (restconf_get_vrf_summary)" },
      { cmd: "show arp on switch " + l(0), desc: "ARP table (restconf_get_arp_table)" },
      { cmd: "show port stats on switch " + sp(0), desc: "Port statistics (restconf_get_port_statistics_summary)" },
      { cmd: "show firmware version on switch " + l(0), desc: "Per-switch firmware (restconf_show_firmware_version)" },
      { cmd: "show media on switch " + sp(0), desc: "Per-port visual: SFP/optics for one switch" },
      { cmd: "show LLDP", desc: "Neighbor discovery topology" },
      { cmd: "show LLDP with seed " + sp(0), desc: "LLDP from specific switch" },
      { cmd: "show LLDP with seed " + sp(0) + " with depth 2", desc: "2-hop neighbor discovery" },
    ]},
    { id: "fleet-reports", label: "Fleet Inventory & Reports", gradient: "from-sky-500 via-blue-500 to-violet-600", items: [
      { cmd: "show media", desc: "Fleet-wide transceiver table (vendor / part # / serial / port / rev / mfg date) with CSV export" },
      { cmd: "list all serial numbers", desc: "Same fleet-wide transceiver table" },
      { cmd: "give me part numbers", desc: "Fleet transceiver table — sort/filter/export" },
      { cmd: "show all transceivers", desc: "Fleet transceiver table" },
      { cmd: "media inventory across fabric " + fab, desc: "Fleet transceiver table, pre-scoped to one fabric" },
      { cmd: "fleet inventory", desc: "Sortable / filterable chassis table — switch · IP · model · SKU · serial · firmware · health · CSV export" },
      { cmd: "chassis inventory", desc: "Same as fleet inventory — full table widget" },
      { cmd: "inventory chassis info", desc: "Same — reverse word order also works" },
      { cmd: "chassis inventory in fabric " + fab, desc: "Chassis table pre-scoped to one fabric" },
    ]},
    { id: "find-host", label: "Find a host (IP / MAC / port)", gradient: "from-teal-500 via-cyan-500 to-sky-600", items: [
      { cmd: "where is 10.10.10.125", desc: "ARP lookup across the fleet. If the entry is on an SVI (Ve N), auto-chases the MAC table for the actual access port" },
      { cmd: "where is MAC 0004.96d6.8649", desc: "MAC-table lookup across the fleet — returns switch + access port + VLAN" },
      { cmd: "where is aa:bb:cc:dd:ee:ff", desc: "Same — accepts colon, dotted-quad, or hyphen MAC formats" },
      { cmd: "show MACs in VLAN 100", desc: "Every MAC learned in VLAN 100 across the fabric (server-side pushdown for smaller payloads)" },
      { cmd: "what's plugged into 0/51 on " + l(0), desc: "MACs learned on a single port — scoped to one switch" },
    ]},
    { id: "xco-health", label: "XCO Health & Probes", gradient: "from-yellow-400 via-amber-500 to-orange-600", items: [
      { cmd: "is xco healthy", desc: "Open XCO Health panel + auto-run firmware orchestration probe" },
      { cmd: "check xco", desc: "Same — quick functional probe (not just liveness)" },
      { cmd: "xco status", desc: "Open XCO Health panel — pick which probe to run" },
      { cmd: "probe firmware orchestration", desc: "Run the goinventory-service wedge probe directly" },
      { cmd: "show xco services", desc: "Standalone XCO Services panel — live kubectl snapshot of every XCO/EFA service with a per-service Restart (typed-confirm + approval; nothing restarts on the click alone)" },
      { cmd: "restart xco service goinventory-service", desc: "Open XCO Services with that service highlighted, ready to restart via the audited plan pipeline" },
    ]},
    // ── Tenant Operations (read-only views). The community client is
    //    single-XCO and read-only — only the GET/list tenant queries are
    //    wired; tenant/VRF/EPG/port-channel mutations are not available.
    { id: "tenant", label: "Tenant Operations", gradient: "from-emerald-500 via-green-500 to-teal-600", items: [
      { cmd: "list tenants", desc: "Read-only tenant list (tenant_get_tenants)" },
      { cmd: "show tenants", desc: "Same — alternate phrasing" },
      { cmd: "show EPGs", desc: "Endpoint groups across every tenant (tenant_get_all_endpoint_groups)" },
      { cmd: "show EPGs for tenant " + ten, desc: "Endpoint groups, scoped to one tenant" },
    ]},
    { id: "admin", label: "Admin", gradient: "from-slate-400 via-slate-500 to-slate-600", items: [
      // System health — direct system_* tools
      { cmd: "cluster health", desc: "HA cluster / node / storage status (system_get_ha_and_node_health_summary)" },
      { cmd: "unreachable devices", desc: "Devices XCO can't currently reach (inventory_get_unreachable_devices)" },
      { cmd: "show certificates", desc: "Certificates expiring soon (system_get_certificates_expiring_soon)" },
    ]},
  ];

  // Apply the search filter: keep items whose command OR description matches;
  // a match on the category label keeps the whole category. Empty query → all.
  const q = query.trim().toLowerCase();
  const filteredCats: HelpCategory[] = q
    ? cats
        .map((c) => {
          const labelHit = c.label.toLowerCase().includes(q);
          const items = labelHit ? c.items : c.items.filter((it) => it.cmd.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q));
          return { ...c, items };
        })
        .filter((c) => c.items.length > 0)
    : cats;
  const matchCount = filteredCats.reduce((n, c) => n + c.items.length, 0);

  return (
    <>
      <div
        onClick={onClose}
        data-help-print="hide"
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 9990 }}
      />
      <div data-help-print="modal" style={{
        position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 9991,
        width: "min(95vw, 960px)", maxHeight: "88vh", display: "flex", flexDirection: "column",
        background: "linear-gradient(135deg, #0f172a 0%, #0f172a 60%, #1e293b 100%)",
        border: "1px solid var(--subtle-border)", borderRadius: 16,
        boxShadow: "0 20px 80px -20px rgba(0,0,0,0.8)", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(59,130,246,0.03), transparent, rgba(168,85,247,0.03))", pointerEvents: "none" }} />

        <div style={{ position: "relative", borderBottom: "1px solid var(--subtle-border)" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(59,130,246,0.05), rgba(168,85,247,0.05), rgba(236,72,153,0.05))" }} />
          <div style={{ position: "relative", padding: "24px 32px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ padding: 10, borderRadius: 12, background: "linear-gradient(135deg, rgba(59,130,246,0.1), rgba(168,85,247,0.1))", border: "1px solid var(--subtle-border)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2"><path d="M12 3l1.5 4.5H18l-3.5 2.5L16 14.5 12 11.5 8 14.5l1.5-4.5L6 7.5h4.5z"/></svg>
                </div>
                <div>
                  <h2 style={{ fontSize: 22, color: "white", letterSpacing: "-0.02em", margin: 0 }}>Natural Language Examples</h2>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Click any command to load it into the AI Console — or type your own</p>
                </div>
              </div>
              <div data-help-print="hide" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Print / Save-as-PDF: native browser dialog. Operators get
                    "Save as PDF" as a destination on every desktop OS — no
                    extra deps needed. Expands all categories first so the
                    printout is the complete cheat-sheet. */}
                <button
                  onClick={handlePrint}
                  title="Print or save as PDF (browser native dialog)"
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)", padding: "6px 12px",
                    borderRadius: 8, cursor: "pointer", fontSize: 12, letterSpacing: "0.02em",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9"/>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                    <rect x="6" y="14" width="12" height="8"/>
                  </svg>
                  Print / PDF
                </button>
                <button onClick={onClose} style={{ color: "rgba(255,255,255,0.3)", background: "transparent", border: "none", padding: 8, borderRadius: 8, cursor: "pointer" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            {/* Search — filters commands + descriptions live. */}
            <div data-help-print="hide" style={{ position: "relative", marginTop: 16 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search examples — e.g. tenant, reboot, serial, ping…"
                autoFocus
                style={{
                  width: "100%", boxSizing: "border-box", padding: "10px 38px", borderRadius: 10,
                  background: "rgba(255,255,255,0.04)", border: "1px solid var(--subtle-border)",
                  color: "white", fontSize: 13.5, outline: "none",
                }}
              />
              {query ? (
                <button onClick={() => setQuery("")} title="Clear" aria-label="Clear search"
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
              ) : null}
            </div>
            {q ? (
              <div data-help-print="hide" style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                {matchCount} {matchCount === 1 ? "match" : "matches"} across {filteredCats.length} {filteredCats.length === 1 ? "category" : "categories"}
              </div>
            ) : null}
          </div>
        </div>

        <div data-help-print="body" style={{ position: "relative", flex: 1, overflowY: "auto", padding: "24px 32px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {q && matchCount === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", color: "rgba(255,255,255,0.4)", fontSize: 14 }}>
                No examples match <code style={{ color: "#60a5fa" }}>{query}</code>. Try a different word, or type your command directly into the AI Console.
              </div>
            ) : null}
            {filteredCats.map((cat) => {
              const isExp = q ? true : expandedCats.has(cat.id);   // search → expand matches
              return (
                <div key={cat.id} data-help-print="category">
                  <button onClick={() => toggleCat(cat.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, marginBottom: isExp ? 14 : 0, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                    <div className={"p-2.5 rounded-xl bg-gradient-to-br " + cat.gradient} style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.3)", transition: "transform 0.2s", flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="12" y2="13"/></svg>
                    </div>
                    <h3 style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, margin: 0 }}>{cat.label}</h3>
                    <div style={{ flex: 1, height: 1, background: "linear-gradient(to right, var(--subtle-border), transparent)" }} />
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", minWidth: 16, textAlign: "right" }}>{cat.items.length}</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: "rgba(255,255,255,0.2)", transform: isExp ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.25s" }}>
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {isExp && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 4, marginBottom: 16 }}>
                      {cat.items.map((item, idx) => (
                        <button
                          key={idx}
                          data-help-print="row"
                          onClick={() => { onClose(); onPick(item.cmd); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 20, padding: "14px 20px", borderRadius: 12,
                            background: "transparent", border: "1px solid transparent", cursor: "pointer",
                            transition: "all 0.15s", textAlign: "left",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--subtle-bg)"; e.currentTarget.style.borderColor = "var(--divider)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.4)" strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                          <code style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.75)", fontFamily: "monospace" }}>{item.cmd}</code>
                          <span data-help-print="desc" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "right", maxWidth: 300, flexShrink: 0 }}>{item.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div data-help-print="hide" style={{ position: "relative", borderTop: "1px solid var(--divider)", background: "linear-gradient(to bottom, var(--subtle-bg), var(--subtle-bg))", padding: "16px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
            <div style={{ padding: 6, borderRadius: 8, background: "var(--subtle-bg)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.5)" strokeWidth="2"><path d="M12 3l1.5 4.5H18l-3.5 2.5L16 14.5 12 11.5 8 14.5l1.5-4.5L6 7.5h4.5z"/></svg>
            </div>
            <span>Pro tip: Type commands naturally — try "what happened today?", "list serial numbers", "is xco healthy"</span>
          </div>
        </div>
      </div>
    </>
  );
}
