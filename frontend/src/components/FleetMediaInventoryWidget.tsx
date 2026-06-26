// FleetMediaInventoryWidget — fleet-wide media (transceiver / SFP / QSFP)
// inventory. Each row is one transceiver in one port on one switch.
//
// Same data shape per item that the single-switch MediaWidget uses — the
// payload from `restconf_get_media_detail`. The hook (useFleetMediaInventory)
// fans the tool call out across every switch returned by
// `inventory_getswitches`, flattens, and tags each row with the originating
// switch's name + IP.
//
// Pure presentational; parent owns the items + the loading/progress flags.
// Operator can:
//   • filter by free-text (matches switch / port / vendor / part / serial)
//   • filter by switch via dropdown
//   • filter by media-kind via dropdown (qsfp28 / sfp+ / …)
//   • sort by any column
//   • export the (filtered) table to CSV — same in-browser Blob pattern as
//     the other admin panels
//
// CSV format is frozen for ops portability — header order doesn't change
// when columns reorder in the UI.

import { useMemo, useState, type CSSProperties } from "react";
import { FG, widgetContainer, btnClose, hoverClose } from "../lib/figmaStyles";

/** One transceiver row. Field names mirror restconf_get_media_detail. */
export interface FleetMediaRow {
  // Switch context — populated by the orchestrator (the hook), not the
  // upstream tool.
  switch_name?: string;
  switch_ip?: string;
  fabric?: string;
  // Per-port media fields as returned by the MCP tool.
  interface_name?: string;
  interface_short?: string;
  interface_type?: string;
  speed?: string;
  media_kind?: string;
  media_form_factor?: string;
  connector?: string;
  encoding?: string;
  distance?: string;
  wavelength?: string | number;
  vendor_name?: string;
  vendor_oui?: string;
  vendor_part_number?: string;
  serial_number?: string;
  vendor_rev?: string;
  date_code?: string;
  [k: string]: unknown;
}

export interface FleetMediaInventoryWidgetProps {
  items: FleetMediaRow[];
  /** Pre-populated free-text filter (set by the NL dispatcher when the
   *  operator scoped the request to a specific switch / port). */
  initialFilter?: string;
  /** Pre-populated fabric dropdown — NL "in fabric X" lands here. */
  initialFabric?: string;
  /** Whole-of-fleet load state from the hook. */
  loading?: boolean;
  /** Switches whose media call failed — surfaces partial results clearly. */
  errors?: Array<{ switch_name?: string; switch_ip: string; error: string }>;
  /** Progress text like "Polled 3 of 8 switches…" while loading. */
  progress?: string;
  onClose: () => void;
}

type SortKey =
  | "switch_name" | "interface_name" | "speed" | "media_kind"
  | "vendor_name" | "vendor_part_number" | "serial_number" | "vendor_rev" | "date_code";
type SortDir = "asc" | "desc";

export function FleetMediaInventoryWidget({
  items, initialFilter = "", initialFabric = "", loading, errors, progress, onClose,
}: FleetMediaInventoryWidgetProps) {
  const [filter, setFilter] = useState(initialFilter);
  const [switchFilter, setSwitchFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [fabricFilter, setFabricFilter] = useState<string>(initialFabric);
  const [sortKey, setSortKey] = useState<SortKey>("switch_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const switchOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(r => r.switch_name && set.add(r.switch_name));
    return Array.from(set).sort();
  }, [items]);

  const kindOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(r => r.media_kind && set.add(r.media_kind));
    return Array.from(set).sort();
  }, [items]);

  const fabricOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(r => r.fabric && set.add(String(r.fabric)));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return items.filter(r => {
      if (fabricFilter && String(r.fabric || "") !== fabricFilter) return false;
      if (switchFilter && r.switch_name !== switchFilter) return false;
      if (kindFilter && r.media_kind !== kindFilter) return false;
      if (!needle) return true;
      return (
        (r.switch_name || "").toLowerCase().includes(needle) ||
        (r.switch_ip || "").toLowerCase().includes(needle) ||
        (r.interface_name || "").toLowerCase().includes(needle) ||
        (r.vendor_name || "").toLowerCase().includes(needle) ||
        (r.vendor_part_number || "").toLowerCase().includes(needle) ||
        (r.serial_number || "").toLowerCase().includes(needle)
      );
    });
  }, [items, filter, switchFilter, kindFilter, fabricFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
    });
  }, [filtered, sortKey, sortDir]);

  function setSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function exportCsv() {
    const headers = [
      "switch_name", "switch_ip", "fabric",
      "interface_name", "speed", "media_kind", "media_form_factor",
      "connector", "encoding", "distance", "wavelength",
      "vendor_name", "vendor_part_number", "serial_number",
      "vendor_rev", "date_code", "vendor_oui",
    ];
    const lines = [headers.join(",")];
    for (const r of sorted) {
      lines.push(headers.map(h => csvCell((r as any)[h])).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleet-media-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  return (
    <div style={widgetContainer()}>
      {/* Header */}
      <div style={{
        background: "var(--header-tint-bg)", padding: "16px 24px",
        borderBottom: `1px solid ${FG.containerBorder}`,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      }}>
        <div>
          <h2 style={{ margin: 0, color: FG.headingColor, fontSize: 18, fontWeight: 500 }}>
            Fleet Media Inventory
          </h2>
          <p style={{ margin: "4px 0 0", color: FG.dimColor, fontSize: 14 }}>
            {sorted.length} of {items.length} transceiver{items.length === 1 ? "" : "s"}
            {switchOptions.length > 0 && <> · {switchOptions.length} switch{switchOptions.length === 1 ? "" : "es"}</>}
            {progress && <> · <span style={{ color: "#a5b4fc" }}>{progress}</span></>}
            {filter && <> · filter: <strong>{filter}</strong></>}
          </p>
        </div>
        <button onClick={onClose} style={btnClose()} {...hoverClose()} aria-label="Close">✕</button>
      </div>

      {/* Toolbar */}
      <div style={{
        padding: "12px 24px", display: "flex", flexWrap: "wrap",
        gap: 10, alignItems: "center",
        borderBottom: `1px solid ${FG.containerBorder}`,
        background: "rgba(15,23,42,0.4)",
      }}>
        <input
          type="text"
          placeholder="Filter by switch / port / vendor / part / serial…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 280 }}
        />
        <select
          value={fabricFilter}
          onChange={(e) => setFabricFilter(e.target.value)}
          style={{ ...inputStyle, minWidth: 140 }}
          aria-label="Fabric filter"
        >
          <option value="">All fabrics ({fabricOptions.length})</option>
          {fabricOptions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select
          value={switchFilter}
          onChange={(e) => setSwitchFilter(e.target.value)}
          style={{ ...inputStyle, minWidth: 140 }}
          aria-label="Switch filter"
        >
          <option value="">All switches ({switchOptions.length})</option>
          {switchOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          style={{ ...inputStyle, minWidth: 140 }}
          aria-label="Media kind filter"
        >
          <option value="">All form factors</option>
          {kindOptions.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <button
          onClick={exportCsv}
          disabled={sorted.length === 0}
          style={primaryBtn(sorted.length === 0)}
          title="Download the visible (filtered + sorted) rows as CSV"
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Partial-failure banner. #171 — neutral surface; warning state
          conveyed by an 8px dot + plain text, not a yellow wash. */}
      {errors && errors.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 24px",
          background: FG.subtleBg,
          borderBottom: `1px solid ${FG.containerBorder}`,
          color: FG.bodyColor, fontSize: 13,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: FG.warningYellow, flexShrink: 0,
          }} />
          <span>
            {errors.length} switch{errors.length === 1 ? "" : "es"} returned no media data
            ({errors.slice(0, 3).map(e => e.switch_name || e.switch_ip).join(", ")}
            {errors.length > 3 && `, +${errors.length - 3} more`}).
            Other switches' media still listed below.
          </span>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
        {sorted.length === 0 ? (
          <div style={emptyStateBox}>
            {loading ? "Polling switches…" : "No transceivers match the current filter."}
          </div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th onClick={() => setSort("switch_name")}        active={sortKey === "switch_name"}        dir={sortDir}>Switch</Th>
                <Th onClick={() => setSort("interface_name")}     active={sortKey === "interface_name"}     dir={sortDir}>Port</Th>
                <Th onClick={() => setSort("speed")}              active={sortKey === "speed"}              dir={sortDir}>Speed</Th>
                <Th onClick={() => setSort("media_kind")}         active={sortKey === "media_kind"}         dir={sortDir}>Form factor</Th>
                <Th onClick={() => setSort("vendor_name")}        active={sortKey === "vendor_name"}        dir={sortDir}>Vendor</Th>
                <Th onClick={() => setSort("vendor_part_number")} active={sortKey === "vendor_part_number"} dir={sortDir}>Part #</Th>
                <Th onClick={() => setSort("serial_number")}      active={sortKey === "serial_number"}      dir={sortDir}>Serial #</Th>
                <Th onClick={() => setSort("vendor_rev")}         active={sortKey === "vendor_rev"}         dir={sortDir}>Rev</Th>
                <Th onClick={() => setSort("date_code")}          active={sortKey === "date_code"}          dir={sortDir}>Mfg date</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={`${r.switch_ip || ""}-${r.interface_name || i}`}
                    style={{ borderTop: `1px solid rgba(71,85,105,0.25)` }}>
                  <td style={tdStyle}>
                    <strong style={{ color: FG.headingColor }}>{r.switch_name || "—"}</strong>
                    {r.switch_ip && (
                      <span style={{ marginLeft: 6, color: FG.dimColor, fontSize: 10.5 }}>
                        ({r.switch_ip})
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>{r.interface_name || r.interface_short || "—"}</td>
                  <td style={tdStyle}>{r.speed || "—"}</td>
                  <td style={tdStyle}>{(r.media_kind || "").toUpperCase().replace(/-/g, "+") || "—"}</td>
                  <td style={tdStyle}>{r.vendor_name || "—"}</td>
                  <td style={tdStyle}><code style={{ fontSize: 11.5 }}>{r.vendor_part_number || "—"}</code></td>
                  <td style={tdStyle}><code style={{ fontSize: 11.5 }}>{r.serial_number || "—"}</code></td>
                  <td style={tdStyle}>{r.vendor_rev || "—"}</td>
                  <td style={tdStyle}>{fmtDate(r.date_code)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sortValue(r: FleetMediaRow, key: SortKey): string {
  return String((r as any)[key] || "").toLowerCase();
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** SLX-OS encodes mfg date as YYMMDD; normalize to ISO. */
function fmtDate(d?: string | unknown): string {
  if (!d) return "—";
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s; // already ISO
  if (/^\d{6}$/.test(s)) {
    return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  }
  return s;
}

function Th({ children, onClick, active, dir }: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    <th
      onClick={onClick}
      style={{
        ...thStyle,
        cursor: "pointer",
        color: active ? FG.headingColor : FG.dimColor,
        userSelect: "none",
      }}
      title="Click to sort"
    >
      {children}
      {active && <span style={{ marginLeft: 4 }}>{dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: FG.bodyColor,
};
const thStyle: CSSProperties = {
  padding: "10px 12px", textAlign: "left",
  background: "rgba(15,23,42,0.6)",
  borderBottom: `1px solid ${FG.containerBorder}`,
  fontSize: 11, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: 0.4,
  whiteSpace: "nowrap",
};
const tdStyle: CSSProperties = {
  padding: "8px 12px", verticalAlign: "middle",
};
const inputStyle: CSSProperties = {
  background: "var(--bg0)", border: "1px solid var(--border)", color: "var(--text)",
  borderRadius: 6, padding: "6px 10px", fontSize: 13,
};
const emptyStateBox: CSSProperties = {
  color: FG.dimColor, fontSize: 13, padding: "24px",
  textAlign: "center", fontStyle: "italic",
};

function primaryBtn(disabled: boolean): CSSProperties {
  return {
    padding: "6px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 6,
    background: disabled ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.22)",
    color: disabled ? "#a5b4fc" : "#e0e7ff",
    border: "1px solid rgba(99,102,241,0.55)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    whiteSpace: "nowrap",
  };
}
