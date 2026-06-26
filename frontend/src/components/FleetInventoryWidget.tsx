// FleetInventoryWidget — table of every switch across the fleet with
// part number, model code, MAC, firmware, role, fabric, health, and serial.
//
// Data comes from inventory_getswitches (fleet-wide; no per-switch enrichment
// today). Part number is the `chassis_name` field (e.g. "SLX9250-32C") which
// is the actual marketing part number. `model` is the internal board code
// (e.g. "3012"). Serial is whatever the upstream returns under `serial` /
// `serial_number` — empty in this lab because XCO doesn't populate it.
// Once the MCP server team ships `restconf_get_chassis`, the widget will
// enrich per-switch and the Serial column will populate automatically.
//
// Pure presentational. Parent owns the fetched items + filter state defaults.
// Operator can:
//   • filter by free-text (matches Name OR IP OR Fabric)
//   • filter by fabric via dropdown
//   • sort by any column
//   • export the (filtered) table to CSV
//
// Pattern mirrors MediaWidget.tsx (also a result widget driven by an NL
// tool call) but renders a multi-row table instead of a per-port grid.

import { useMemo, useState, type CSSProperties } from "react";
import { FG, widgetContainer, btnClose, hoverClose } from "../lib/figmaStyles";

/** One row in the fleet inventory table. Shape mirrors the
 *  inventory_getswitches response with the fields we actually render. */
export interface FleetInventoryRow {
  name?: string;
  ip_address?: string;
  fabric?: string | { fabric_name?: string };
  role?: string;
  chassis_name?: string;     // part number (e.g. SLX9250-32C)
  model?: string;            // internal board code (e.g. 3012)
  mac_address?: string;
  firmware?: string;
  device_health?: string;
  admin_state?: string;
  serial?: string;           // chassis serial — populated by useFleetInventory
                             //                  from inventory_get_chassis_info_bulk
  serial_number?: string;    // alternate field name we tolerate
  part_number_sku?: string;  // orderable SKU (e.g. "801113-00-AA") — distinct
                             // from chassis_name which is the marketing model
                             // (e.g. "SLX9250-32C"). Source:
                             // inventory_get_chassis_info_bulk.part_number
  // Allow extra keys without TS complaints — the CSV exporter iterates
  // a fixed column list, so extras are silently ignored.
  [k: string]: unknown;
}

export interface FleetInventoryWidgetProps {
  items: FleetInventoryRow[];
  /** Pre-populated filter text — set by the NL dispatcher when the user
   *  typed something like "serial numbers for Spine-1" or "for 10.9.140.31". */
  initialFilter?: string;
  /** Pre-populated fabric dropdown value — NL "in fabric X" lands here. */
  initialFabric?: string;
  onClose: () => void;
}

type SortKey = "name" | "ip_address" | "fabric" | "role" | "chassis_name" | "part_number_sku" | "firmware" | "device_health" | "serial";
type SortDir = "asc" | "desc";

export function FleetInventoryWidget({
  items, initialFilter = "", initialFabric = "", onClose,
}: FleetInventoryWidgetProps) {
  const [filter, setFilter] = useState(initialFilter);
  const [fabricFilter, setFabricFilter] = useState<string>(initialFabric);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Normalize rows once — different fabric / serial field names coalesced.
  const rows = useMemo(() => items.map(normalizeRow), [items]);

  // Fabric dropdown options
  const fabricOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => r._fabric && set.add(r._fabric));
    return Array.from(set).sort();
  }, [rows]);

  // Apply filters
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows.filter(r => {
      if (fabricFilter && r._fabric !== fabricFilter) return false;
      if (!needle) return true;
      return (
        (r.name || "").toLowerCase().includes(needle) ||
        (r.ip_address || "").toLowerCase().includes(needle) ||
        (r._fabric || "").toLowerCase().includes(needle) ||
        (r.chassis_name || "").toLowerCase().includes(needle) ||
        (r.part_number_sku || "").toLowerCase().includes(needle) ||
        (r._serial || "").toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, fabricFilter]);

  // Sort
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
    // CSV column list — frozen so the file format is stable across UI changes.
    // chassis_name is the marketing model (e.g. SLX9250-32C); part_number is
    // the orderable SKU (e.g. 801113-00-AA) from inventory_get_chassis_info_bulk.
    const headers = [
      "name", "ip_address", "fabric", "role",
      "model", "part_number", "mac_address",
      "firmware", "device_health", "admin_state", "serial",
    ];
    const lines = [headers.join(",")];
    for (const r of sorted) {
      const fields = [
        r.name, r.ip_address, r._fabric, r.role,
        r.chassis_name, r.part_number_sku, r.mac_address,
        r.firmware, r.device_health, r.admin_state, r._serial,
      ];
      lines.push(fields.map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleet-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
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
            Fleet Inventory
          </h2>
          <p style={{ margin: "4px 0 0", color: FG.dimColor, fontSize: 14 }}>
            {sorted.length} of {rows.length} switch{rows.length === 1 ? "" : "es"}
            {fabricFilter && <> · fabric: <strong>{fabricFilter}</strong></>}
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
          placeholder="Filter by name / IP / fabric / part / serial…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 280 }}
        />
        <select
          value={fabricFilter}
          onChange={(e) => setFabricFilter(e.target.value)}
          style={{ ...inputStyle, minWidth: 160 }}
        >
          <option value="">All fabrics ({fabricOptions.length})</option>
          {fabricOptions.map(f => <option key={f} value={f}>{f}</option>)}
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

      {/* Table */}
      <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
        {sorted.length === 0 ? (
          <div style={emptyStateBox}>
            No switches match the current filter.
          </div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th onClick={() => setSort("name")}        active={sortKey === "name"}        dir={sortDir}>Switch</Th>
                <Th onClick={() => setSort("ip_address")}  active={sortKey === "ip_address"}  dir={sortDir}>IP</Th>
                <Th onClick={() => setSort("fabric")}      active={sortKey === "fabric"}      dir={sortDir}>Fabric</Th>
                <Th onClick={() => setSort("role")}        active={sortKey === "role"}        dir={sortDir}>Role</Th>
                <Th onClick={() => setSort("chassis_name")}    active={sortKey === "chassis_name"}    dir={sortDir}>Model</Th>
                <Th onClick={() => setSort("part_number_sku")} active={sortKey === "part_number_sku"} dir={sortDir}>Part #</Th>
                <Td as="th">MAC</Td>
                <Th onClick={() => setSort("firmware")}        active={sortKey === "firmware"}        dir={sortDir}>Firmware</Th>
                <Th onClick={() => setSort("device_health")}   active={sortKey === "device_health"}   dir={sortDir}>Health</Th>
                <Th onClick={() => setSort("serial")}          active={sortKey === "serial"}          dir={sortDir}>Serial</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={`${r.ip_address || r.name || i}`}
                    style={{ borderTop: `1px solid rgba(71,85,105,0.25)` }}>
                  <Td><strong style={{ color: FG.headingColor }}>{r.name || "—"}</strong></Td>
                  <Td><code>{r.ip_address || "—"}</code></Td>
                  <Td>{r._fabric || "—"}</Td>
                  <Td>{r.role || "—"}</Td>
                  <Td>{r.chassis_name || "—"}</Td>
                  <Td><code style={{ fontSize: 11.5 }}>{r.part_number_sku || "—"}</code></Td>
                  <Td><code style={{ fontSize: 11 }}>{r.mac_address || "—"}</code></Td>
                  <Td>{r.firmware || "—"}</Td>
                  <Td><HealthBadge h={r.device_health} /></Td>
                  <Td><code style={{ fontSize: 11.5 }}>{r._serial || <span style={{ color: FG.dimColor }} title="Chassis serial unavailable. Older MCP servers (pre-cc8c723) lack inventory_get_chassis_info_bulk.">—</span>}</code></Td>
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

/** Internal row shape — has _fabric and _serial pre-extracted so the
 *  filter + sort + render code doesn't need to handle the field-shape
 *  variants every time. */
type NormalRow = FleetInventoryRow & { _fabric: string; _serial: string };

function normalizeRow(r: FleetInventoryRow): NormalRow {
  const fab = r.fabric;
  const _fabric = typeof fab === "string"
    ? fab
    : (fab?.fabric_name || "");
  const _serial = (r.serial as string) || (r.serial_number as string) || "";
  return { ...r, _fabric, _serial };
}

function sortValue(r: NormalRow, key: SortKey): string {
  const v =
    key === "fabric"          ? r._fabric :
    key === "serial"          ? r._serial :
    key === "part_number_sku" ? (r.part_number_sku || "") :
    (r[key] as string) || "";
  return String(v).toLowerCase();
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

function Td({ children, as }: { children: React.ReactNode; as?: "th" }) {
  if (as === "th") return <th style={thStyle}>{children}</th>;
  return <td style={tdStyle}>{children}</td>;
}

function HealthBadge({ h }: { h?: string }) {
  // #171 — restraint pass. Neutral bg + small colored dot + plain
  // text label. Matches FabricHealthSummary KPI-card pattern.
  const s = (h || "").toLowerCase();
  const dotColor =
    s === "healthy" || s === "green" ? FG.successGreen :
    s === "degraded" || s === "amber" || s === "warning" ? FG.warningYellow :
    s === "critical" || s === "red" ? FG.errorRed :
    FG.dimColor;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      color: FG.bodyColor, border: `1px solid ${FG.containerBorder}`,
      background: "var(--inner-card-bg)", borderRadius: 4,
      padding: "2px 8px", fontSize: 11, fontWeight: 500,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: dotColor, flexShrink: 0,
      }} />
      {(h || "unknown").toUpperCase()}
    </span>
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
