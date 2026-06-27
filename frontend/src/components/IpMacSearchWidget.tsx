// IpMacSearchWidget — "Compass": one search box, auto-detect type.
//
// Single input box. Whatever the operator types, classify into one of
// {ip, mac, port, vlan} via the format. Show the detected type as a
// small badge next to the input. Fire the right tool automatically.
//
// Detection rules (mutually exclusive by construction):
//   IP   : \b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b   (IPv4)
//   MAC  : colon / hyphen / dotted-quad / bare 12-hex (case-insensitive)
//   PORT : N/M form (with optional eth/ethernet prefix)
//   VLAN : pure integer 1..4094
//
// Scope (which switch(es) to probe) is independent of the search
// value. Operator can:
//   - Leave the scope box empty → fleet sweep across all known switches
//   - Type one or more switch names/IPs (comma- or space-separated)
//     into the scope box
// Or via NL, "on Leaf-3" / "on 10.9.140.43" populates the scope box.
//
// Search dispatch:
//   IP   → restconf_get_arp_table(ip_filter)
//          if ARP entry's interface is Ve N (SVI), the access-port
//          chase needs the MAC table (see below — degraded here).
//   MAC  → MAC table (degraded — see below)
//   VLAN → MAC table (degraded — see below)
//   PORT → ARP table only (MAC table degraded — see below). SLX labs
//          frequently have empty MAC tables but populated ARP tables.
//
// COMMUNITY ADAPTATION (single-site, lean catalog):
//   - invokeToolTypedWithSite(tool, inputs, siteId) → invokeToolTyped(
//     tool, inputs). This client is single-site; there's no site
//     routing key, so the third arg + the siteId prop are dropped.
//   - MAC-table availability is detected from the generated catalog
//     (MAC_TABLE_AVAILABLE). When the server exposes
//     restconf_slx_get_mac_address_table, MAC / VLAN / port lookups use
//     it; when it is absent they degrade gracefully to ARP (with a
//     notice), so IP/ARP search keeps working against any server.
//
// Style discipline: neutral surfaces, dots and small chips as the only
// accent, FG.* tokens throughout.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { FG } from "../lib/figmaStyles";
import { Panel } from "./Panel";
import {
  Chip, ReadinessBanner, sectionLabel, tableStyles,
} from "../lib/widgetPrimitives";
import { invokeToolTyped } from "../lib/typedInvoke";
import { TOOL_NAMES } from "../lib/generated/tools.gen";
// MAC-format helpers. Single source of truth — same module the Compass
// NL parser reads.
import { isExactlyMac } from "../lib/nl/macFormats";

// Whether the server exposes the SLX MAC-address-table tool. Derived from
// the generated catalog (refreshed from the live server via `npm run
// sync-tools`), so this client adapts to whatever server it is built
// against: MAC / VLAN / port lookups use the tool when present and fall
// back to ARP (with a notice) when it is absent.
const MAC_TABLE_AVAILABLE = (TOOL_NAMES as readonly string[]).includes(
  "restconf_slx_get_mac_address_table",
);
const MAC_UNAVAILABLE_MSG =
  "MAC table unavailable on this server (restconf_slx_get_mac_address_table is not in the catalog).";

// ── Detection ───────────────────────────────────────────────────────
export type CompassKind = "ip" | "mac" | "port" | "vlan" | "unknown";

/** Classify a free-text query into one of the 4 supported types.
 *  Returns "unknown" when nothing matches — the widget surfaces that
 *  with a hint instead of guessing. */
export function detectKind(text: string): CompassKind {
  const t = text.trim();
  if (!t) return "unknown";
  // IPv4 — most distinct shape, win first.
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(t)) return "ip";
  // MAC — any of the four canonical forms (case-insensitive). Single
  // source of truth via isExactlyMac() in lib/nl/macFormats.ts.
  if (isExactlyMac(t)) return "mac";
  // Port — N/M form (with optional eth/ethernet/Ethernet prefix).
  if (/^(?:eth(?:ernet)?\s*)?\d{1,3}\/\d{1,3}$/i.test(t)) return "port";
  // VLAN — pure integer 1..4094.
  const asInt = parseInt(t, 10);
  if (/^\d{1,4}$/.test(t) && asInt >= 1 && asInt <= 4094) return "vlan";
  return "unknown";
}

/** Normalize a port string to the server's expected form (strip the
 *  "eth"/"Ethernet" prefix, keep N/M). */
function normalizePort(t: string): string {
  return t.replace(/^(?:eth(?:ernet)?\s*)/i, "").trim();
}

// ── Response shapes (v2 multi-switch from server team) ──────────────
interface ArpItem {
  switch_ip?: string;
  ip_address?: string;
  mac_address?: string;
  interface?: string;
  interface_short?: string;
  vlan?: number | null;
  type?: string;
}

interface MacItem {
  switch_ip?: string;
  vlan?: number | null;
  mac?: string;
  mac_dotted?: string;
  type?: string;
  state?: string;
  interface?: string;
  interface_short?: string;
}

interface MultiSwitchResp<T> {
  meta?: any;
  summary?: any;
  items?: T[];
  switch_level_data_by_ip?: Record<string, {
    total_in_table?: number;
    entries_seen?: number;
    returned?: number;
    by_type?: Record<string, number>;
    truncated?: boolean;
  }>;
  errors_by_ip?: Record<string, string>;
  warnings?: string[];
}

// ── Widget props ────────────────────────────────────────────────────
export interface IpMacSearchWidgetProps {
  open: boolean;
  /** Initial query (what to search for). NL handler fills this from
   *  the user's prompt — the widget classifies on every keystroke
   *  after that. */
  initialQuery: string;
  /** Initial per-switch scope IPs (empty = fleet sweep). Comes from
   *  "on Leaf-3" / "on 10.x.x.x" in the NL prompt. */
  initialScopeIps: string[];
  /** All known switch IPs in the current site — default fan-out when
   *  scope is empty. */
  fleetSwitchIps: string[];
  /** IP → display-name registry from App.tsx switchOptions. */
  switchNameByIp: Record<string, string>;
  /** Name → IP registry, for the scope input which accepts names too. */
  switchIpByName: Record<string, string>;
  onClose: () => void;
}

// ── Per-switch result group ─────────────────────────────────────────
function SwitchResultGroup({
  switchIp, switchName, byType, entriesSeen, totalInTable, truncated, children,
}: {
  switchIp: string;
  switchName?: string;
  byType?: Record<string, number>;
  entriesSeen?: number;
  totalInTable?: number;
  truncated?: boolean;
  children: React.ReactNode;
}) {
  const byTypeStr = byType
    ? Object.entries(byType).map(([k, n]) => `${n} ${k}`).join(" · ")
    : "";
  return (
    <div style={{
      border: `1px solid ${FG.containerBorder}`, borderRadius: 8,
      background: "var(--inner-card-bg)",
      marginBottom: 12, overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px", borderBottom: `1px solid ${FG.divider}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ color: FG.bodyColor, fontSize: 13, fontWeight: 500 }}>
          <code>{switchIp}</code>
          {switchName && <span style={{ color: FG.mutedColor }}> · {switchName}</span>}
        </div>
        {(byTypeStr || entriesSeen != null) && (
          <div style={{ color: FG.mutedColor, fontSize: 11 }}>
            {entriesSeen != null && totalInTable != null && entriesSeen !== totalInTable
              ? `${entriesSeen} of ${totalInTable}`
              : entriesSeen != null
                ? `${entriesSeen} entries`
                : ""}
            {byTypeStr && <span style={{ marginLeft: 8 }}>{byTypeStr}</span>}
            {truncated && <span style={{ color: FG.warningYellow, marginLeft: 8 }}>· truncated</span>}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Top-level widget ────────────────────────────────────────────────
export function IpMacSearchWidget(props: IpMacSearchWidgetProps) {
  const {
    open, initialQuery, initialScopeIps,
    fleetSwitchIps, switchNameByIp, switchIpByName, onClose,
  } = props;

  const [query, setQuery] = useState(initialQuery);
  const [scopeText, setScopeText] = useState(
    initialScopeIps.map((ip) => switchNameByIp[ip] || ip).join(", "),
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  // Soft notice (not an error) — e.g. MAC table degraded. Shown in a
  // neutral banner so IP/ARP results still render normally below.
  const [notice, setNotice] = useState("");

  const [arp, setArp] = useState<MultiSwitchResp<ArpItem> | null>(null);
  const [mac, setMac] = useState<MultiSwitchResp<MacItem> | null>(null);
  const [sviChase, setSviChase] = useState<MultiSwitchResp<MacItem> | null>(null);
  const [arpSupplement, setArpSupplement] = useState<MultiSwitchResp<ArpItem> | null>(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [autoFiredSig, setAutoFiredSig] = useState("");

  const kind = detectKind(query);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setScopeText(initialScopeIps.map((ip) => switchNameByIp[ip] || ip).join(", "));
    setArp(null); setMac(null); setSviChase(null); setArpSupplement(null);
    setErr(""); setNotice(""); setElapsedMs(0); setAutoFiredSig("");
    // switchNameByIp INTENTIONALLY omitted from deps. The map is used
    // for the initial scope-text render only; we don't want the
    // operator's typed query + results wiped each time App.tsx
    // re-renders (which happens on ~60s switch-inventory refresh ticks).
    // App.tsx memoizes the prop so identity is stable across renders,
    // but keeping it out of the deps here is the secondary safety net.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery, initialScopeIps]);

  /** Resolve scope text into a list of switch IPs. Accepts both names
   *  ("Leaf-3", "spine-1") and IPs, comma- or whitespace-separated. */
  function resolveScope(): string[] {
    const tokens = scopeText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) return [];
    const out: string[] = [];
    for (const tk of tokens) {
      // IP-shaped token: pass through directly
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tk)) {
        out.push(tk);
        continue;
      }
      // Otherwise treat as switch name — case-insensitive lookup
      const ip = switchIpByName[tk] || switchIpByName[tk.toLowerCase()] ||
        Object.entries(switchIpByName).find(
          ([n]) => n.toLowerCase() === tk.toLowerCase(),
        )?.[1];
      if (ip) out.push(ip);
    }
    return out;
  }

  function effectiveSwitchIps(): string[] {
    const scope = resolveScope();
    return scope.length > 0 ? scope : fleetSwitchIps;
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setErr("Type a search value first.");
      return;
    }
    if (kind === "unknown") {
      setErr("Couldn't classify that as IP, MAC, port, or VLAN. Examples: 10.10.10.125 · 0004.96d6.8649 · 0/50 · 100");
      return;
    }
    setErr("");
    setNotice("");
    setLoading(true);
    setArp(null); setMac(null); setSviChase(null); setArpSupplement(null);
    const t0 = performance.now();

    try {
      const ips = effectiveSwitchIps();
      if (ips.length === 0) {
        setErr("No switches in the current site to probe.");
        return;
      }
      // Server v2: pass a single string for 1-switch and array for >1.
      const swIpInput: string | string[] = ips.length === 1 ? ips[0] : ips;

      if (kind === "ip") {
        const resp = await invokeToolTyped(
          "restconf_get_arp_table",
          { switch_ip: swIpInput as any, ip_filter: q } as any,
        );
        const inner = (resp as any)?.result?.payload ?? resp;
        setArp(inner as MultiSwitchResp<ArpItem>);

        // SVI chase — if any ARP entry's interface is "Ve N", look up the
        // resolved MAC in the MAC table to find the real access port (when
        // the MAC tool is available; otherwise note the limitation — the
        // ARP entry with the SVI interface + resolved MAC still renders).
        const sviItems = ((inner as any)?.items || []).filter(
          (it: ArpItem) => /^Ve\s+\d+$/i.test((it.interface || "").trim()),
        );
        if (sviItems.length > 0) {
          if (MAC_TABLE_AVAILABLE) {
            const macToChase = sviItems[0].mac_address;
            if (macToChase) {
              const chaseResp = await invokeToolTyped(
                "restconf_slx_get_mac_address_table",
                { switch_ip: swIpInput as any, mac_filter: macToChase } as any,
              );
              const chaseInner = (chaseResp as any)?.result?.payload ?? chaseResp;
              setSviChase(chaseInner as MultiSwitchResp<MacItem>);
            }
          } else {
            setNotice(
              `Found via ARP on an SVI (${sviItems[0].interface}). The access-port chase needs the MAC table, which is unavailable on this server — the resolved MAC is shown in the ARP row below.`,
            );
          }
        }
      } else if (kind === "mac") {
        if (MAC_TABLE_AVAILABLE) {
          const resp = await invokeToolTyped(
            "restconf_slx_get_mac_address_table",
            { switch_ip: swIpInput as any, mac_filter: q } as any,
          );
          const inner = (resp as any)?.result?.payload ?? resp;
          setMac(inner as MultiSwitchResp<MacItem>);
        } else {
          setNotice(MAC_UNAVAILABLE_MSG);
          setMac({ items: [] } as MultiSwitchResp<MacItem>);
        }
      } else if (kind === "vlan") {
        if (MAC_TABLE_AVAILABLE) {
          const resp = await invokeToolTyped(
            "restconf_slx_get_mac_address_table",
            { switch_ip: swIpInput as any, vlan_filter: parseInt(q, 10) } as any,
          );
          const inner = (resp as any)?.result?.payload ?? resp;
          setMac(inner as MultiSwitchResp<MacItem>);
        } else {
          setNotice(MAC_UNAVAILABLE_MSG);
          setMac({ items: [] } as MultiSwitchResp<MacItem>);
        }
      } else if (kind === "port") {
        // PORT mode: fire MAC table AND ARP in parallel when the MAC tool
        // is available; otherwise fall back to ARP only and filter
        // client-side. SLX labs routinely have empty MAC tables but
        // populated ARP, so the "what's on this port" intent is usually
        // satisfied either way.
        const portN = normalizePort(q);
        let arpInner: any;
        if (MAC_TABLE_AVAILABLE) {
          const [macResp, arpResp] = await Promise.all([
            invokeToolTyped(
              "restconf_slx_get_mac_address_table",
              { switch_ip: swIpInput as any, interface_filter: portN } as any,
            ),
            invokeToolTyped(
              "restconf_get_arp_table",
              { switch_ip: swIpInput as any } as any,
            ),
          ]);
          const macInner = (macResp as any)?.result?.payload ?? macResp;
          arpInner = (arpResp as any)?.result?.payload ?? arpResp;
          setMac(macInner as MultiSwitchResp<MacItem>);
        } else {
          setNotice(
            "MAC table unavailable on this server — showing ARP entries for this port only.",
          );
          const arpResp = await invokeToolTyped(
            "restconf_get_arp_table",
            { switch_ip: swIpInput as any } as any,
          );
          arpInner = (arpResp as any)?.result?.payload ?? arpResp;
          setMac({ items: [] } as MultiSwitchResp<MacItem>);
        }

        // Filter ARP client-side: match interface_short directly or
        // confirm the full interface string ends with our port token.
        const want = portN.toLowerCase();
        const arpItems: ArpItem[] = (arpInner as any)?.items || [];
        const filtered = arpItems.filter((it) => {
          const sh = (it.interface_short || "").toLowerCase();
          const lg = (it.interface || "").toLowerCase();
          return sh === want || lg.endsWith(want);
        });
        if (filtered.length > 0) {
          setArpSupplement({
            ...(arpInner as any),
            items: filtered,
          });
        }
      }
    } catch (e: any) {  // eslint-disable-line — catch-error idiom
      setErr(String(e?.message ?? e ?? "search failed"));
    } finally {
      setLoading(false);
      setElapsedMs(Math.round(performance.now() - t0));
    }
  }

  // Auto-fire on open when NL provides a non-empty initialQuery that
  // classifies cleanly. Use a signature to ensure we only fire once
  // per "fresh open" — re-typing in the box doesn't re-fire.
  useEffect(() => {
    if (!open) return;
    const sig = `${initialQuery}|${initialScopeIps.join(",")}`;
    if (sig === autoFiredSig) return;
    if (!initialQuery.trim()) return;
    if (detectKind(initialQuery) === "unknown") return;
    setAutoFiredSig(sig);
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery, initialScopeIps]);

  if (!open) return null;

  // Grouped renders
  function groupBy<T extends { switch_ip?: string }>(items: T[]): Record<string, T[]> {
    const g: Record<string, T[]> = {};
    for (const it of items) {
      const k = it.switch_ip || "?";
      if (!g[k]) g[k] = [];
      g[k].push(it);
    }
    return g;
  }

  const totalArp = arp?.items?.length ?? 0;
  const totalMac = mac?.items?.length ?? 0;
  const totalSupp = arpSupplement?.items?.length ?? 0;
  const haveResults = arp != null || mac != null;
  const switchesProbed = (arp?.summary?.switches_probed ?? mac?.summary?.switches_probed) || 0;

  // Headline answer
  function headline(): string | null {
    if (kind === "ip" && arp) {
      const items = arp.items || [];
      if (items.length !== 1) return null;
      const it = items[0];
      const sw = it.switch_ip || "?";
      const name = switchNameByIp[sw];
      const isSvi = /^Ve\s+\d+$/i.test((it.interface || "").trim());
      if (isSvi && sviChase) {
        const chase = sviChase.items?.[0];
        if (chase?.interface) {
          const chaseName = switchNameByIp[chase.switch_ip || ""];
          return `${query} → ${chase.switch_ip || sw}${chaseName ? ` / ${chaseName}` : ""}, ${chase.interface} (via SVI ${it.interface} on ${sw}${name ? ` / ${name}` : ""})`;
        }
      }
      if (!isSvi) {
        return `${query} → ${sw}${name ? ` / ${name}` : ""}, ${it.interface || "?"}`;
      }
    }
    if (kind === "port" && arpSupplement && totalSupp === 1 && totalMac === 0) {
      const it = arpSupplement.items![0];
      const sw = it.switch_ip || "?";
      const name = switchNameByIp[sw];
      return `Port ${query} on ${sw}${name ? ` / ${name}` : ""} → host ${it.ip_address} (${it.mac_address})`;
    }
    return null;
  }

  const head = headline();

  // Detected-type badge style
  const kindBadge = (k: CompassKind) => {
    const label =
      k === "ip"   ? "IPv4 address" :
      k === "mac"  ? "MAC address" :
      k === "port" ? "Switch port"  :
      k === "vlan" ? "VLAN id" :
      "Unrecognized";
    const tone: "good" | "warn" | "neut" =
      k === "unknown" ? "warn" : k === "ip" || k === "mac" || k === "port" || k === "vlan" ? "good" : "neut";
    return <Chip label={label} tone={tone} dot={k !== "unknown"} />;
  };

  const scopeIpsResolved = resolveScope();
  const effectiveCount = scopeIpsResolved.length || fleetSwitchIps.length;

  return (
    <Panel
      title="Compass"
      subtitle={`Find an IP, MAC, port, or VLAN across the fabric. ${elapsedMs ? `Last query ${(elapsedMs / 1000).toFixed(2)}s · ` : ""}${switchesProbed ? `probed ${switchesProbed} switch${switchesProbed === 1 ? "" : "es"}` : ""}`}
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Search row — single input, no mode picker */}
        <div style={{
          padding: "14px 16px", borderRadius: 8,
          border: `1px solid ${FG.containerBorder}`,
          background: "var(--inner-card-bg)",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
              placeholder="IP · MAC · port (0/50) · VLAN — paste it and hit Enter"
              autoFocus
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 6,
                border: `1px solid ${FG.inputBorder}`, background: FG.inputBg,
                color: FG.inputColor, fontSize: 14, fontFamily: "monospace",
              }}
            />
            <button
              onClick={() => void runSearch()}
              disabled={loading || !query.trim() || kind === "unknown"}
              style={{
                padding: "10px 22px", borderRadius: 6,
                fontSize: 13, fontWeight: 500,
                background: loading || !query.trim() || kind === "unknown"
                  ? FG.btnDisabledBg : FG.btnPrimaryBg,
                color: loading || !query.trim() || kind === "unknown"
                  ? FG.btnDisabledColor : "#fff",
                border: `1px solid ${loading || !query.trim() || kind === "unknown"
                  ? FG.containerBorder : FG.btnPrimaryBorder}`,
                cursor: loading || !query.trim() || kind === "unknown"
                  ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "searching…" : "Search"}
            </button>
          </div>

          {/* Detected type + scope row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            {query.trim() && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: FG.mutedColor, fontSize: 12 }}>Detected as:</span>
                {kindBadge(kind)}
              </div>
            )}
            <div style={{
              flex: 1, minWidth: 240, display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ color: FG.mutedColor, fontSize: 12, whiteSpace: "nowrap" }}>
                Scope:
              </span>
              <input
                type="text"
                value={scopeText}
                onChange={(e) => setScopeText(e.target.value)}
                placeholder="(empty = fleet sweep) — or Leaf-3, Spine-1, 10.9.140.43, …"
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: 6,
                  border: `1px solid ${FG.inputBorder}`, background: FG.inputBg,
                  color: FG.inputColor, fontSize: 12,
                }}
              />
              <span style={{ color: FG.dimColor, fontSize: 11, whiteSpace: "nowrap" }}>
                {scopeIpsResolved.length > 0
                  ? `${scopeIpsResolved.length} switch${scopeIpsResolved.length === 1 ? "" : "es"}`
                  : `fleet (${fleetSwitchIps.length} sw)`}
              </span>
            </div>
          </div>

          {/* Help line — always visible, tiny */}
          <div style={{ color: FG.dimColor, fontSize: 11, lineHeight: 1.5 }}>
            Accepted: IPv4 (<code>10.10.10.125</code>) · MAC any format (<code>0004.96d6.8649</code>,
            {" "}<code>aa:bb:cc:dd:ee:ff</code>, <code>aabbccddeeff</code>, …) ·
            port (<code>0/50</code>, <code>Eth 0/50</code>) · VLAN id (<code>100</code>, 1–4094).
            {" "}Hit Enter to search across <b>{effectiveCount}</b> switch{effectiveCount === 1 ? "" : "es"}.
          </div>
        </div>

        {/* Error */}
        {err && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 12px", borderRadius: 6,
            background: FG.subtleBg, border: `1px solid ${FG.containerBorder}`,
            color: FG.bodyColor, fontSize: 13,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: FG.errorRed }} />
            {err}
          </div>
        )}

        {/* Notice — soft limitation banner (e.g. MAC table unavailable) */}
        {notice && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 12px", borderRadius: 6,
            background: FG.subtleBg, border: `1px solid ${FG.containerBorder}`,
            color: FG.bodyColor, fontSize: 13,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: FG.warningYellow }} />
            {notice}
          </div>
        )}

        {/* Headline */}
        {head && (
          <ReadinessBanner
            ok={true}
            okText={head}
            badText=""
            hint={kind === "ip" && sviChase ? "Resolved via 2-hop ARP → MAC chase (SVI in routed VLAN)." :
              kind === "port" && totalMac === 0 && totalSupp > 0 ? "Found via ARP — MAC table was empty (common on lab fabrics with low L2 traffic)." :
              undefined}
          />
        )}

        {/* No-match hint when both lookups came back empty */}
        {haveResults && !head && totalArp === 0 && totalMac === 0 && totalSupp === 0 && (
          <div style={{
            padding: "16px 18px", borderRadius: 8,
            border: `1px solid ${FG.containerBorder}`,
            background: FG.subtleBg, color: FG.bodyColor, fontSize: 13,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: FG.warningYellow }} />
            <div>
              <div>No matches for <code>{query}</code> across the probed switches.</div>
              {kind === "port" && (
                <div style={{ color: FG.mutedColor, fontSize: 12, marginTop: 4 }}>
                  ARP table came back empty for this port. If the host
                  is plugged in but quiet, traffic from it would populate the table.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ARP supplement (port mode, when MAC table was empty) */}
        {kind === "port" && arpSupplement && totalSupp > 0 && (
          <div>
            <div style={sectionLabel}>
              ARP entries on port {normalizePort(query)}
              {totalMac === 0 && (
                <span style={{
                  color: FG.mutedColor, marginLeft: 8,
                  textTransform: "none", letterSpacing: 0,
                }}>· MAC table unavailable — these came from ARP</span>
              )}
            </div>
            {Object.entries(groupBy(arpSupplement.items || [])).map(([sw, items]) => (
              <SwitchResultGroup
                key={`arp-supp-${sw}`}
                switchIp={sw}
                switchName={switchNameByIp[sw]}
              >
                <table style={tableStyles.table}>
                  <thead>
                    <tr>
                      <th style={tableStyles.th}>IP</th>
                      <th style={tableStyles.th}>MAC</th>
                      <th style={tableStyles.th}>VLAN</th>
                      <th style={tableStyles.th}>Type</th>
                      <th style={tableStyles.th}>Interface</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={`${sw}-arpsupp-${i}`}>
                        <td style={tableStyles.td}><code>{it.ip_address || "—"}</code></td>
                        <td style={tableStyles.td}><code>{it.mac_address || "—"}</code></td>
                        <td style={tableStyles.td}>{it.vlan ?? "—"}</td>
                        <td style={tableStyles.td}>{it.type || "—"}</td>
                        <td style={tableStyles.td}>
                          <code style={{ color: FG.bodyColor }}>{it.interface || "—"}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SwitchResultGroup>
            ))}
          </div>
        )}

        {/* SVI chase (ip mode, when ARP entry was Ve N) */}
        {kind === "ip" && sviChase && (sviChase.items?.length ?? 0) > 0 && (
          <div>
            <div style={sectionLabel}>MAC-table chase (SVI → access port)</div>
            {Object.entries(groupBy(sviChase.items || [])).map(([sw, items]) => {
              const sl = sviChase.switch_level_data_by_ip?.[sw];
              return (
                <SwitchResultGroup
                  key={`chase-${sw}`}
                  switchIp={sw}
                  switchName={switchNameByIp[sw]}
                  byType={sl?.by_type}
                  entriesSeen={sl?.entries_seen}
                  totalInTable={sl?.total_in_table}
                  truncated={sl?.truncated}
                >
                  <table style={tableStyles.table}>
                    <thead>
                      <tr>
                        <th style={tableStyles.th}>VLAN</th>
                        <th style={tableStyles.th}>MAC</th>
                        <th style={tableStyles.th}>Type</th>
                        <th style={tableStyles.th}>Interface</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={`${sw}-chase-${i}`}>
                          <td style={tableStyles.td}>{it.vlan ?? "—"}</td>
                          <td style={tableStyles.td}><code>{it.mac_dotted || it.mac || "—"}</code></td>
                          <td style={tableStyles.td}>{it.type || "—"}</td>
                          <td style={tableStyles.td}>
                            <code style={{ color: FG.bodyColor }}>{it.interface || "—"}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SwitchResultGroup>
              );
            })}
          </div>
        )}

        {/* ARP results (ip mode) */}
        {kind === "ip" && arp && totalArp > 0 && (
          <div>
            <div style={sectionLabel}>ARP entries</div>
            {Object.entries(groupBy(arp.items || [])).map(([sw, items]) => {
              const sl = (arp.switch_level_data_by_ip || {})[sw] as any;
              return (
                <SwitchResultGroup
                  key={sw}
                  switchIp={sw}
                  switchName={switchNameByIp[sw]}
                  entriesSeen={sl?.entries_seen ?? sl?.returned}
                >
                  <table style={tableStyles.table}>
                    <thead>
                      <tr>
                        <th style={tableStyles.th}>IP</th>
                        <th style={tableStyles.th}>MAC</th>
                        <th style={tableStyles.th}>VLAN</th>
                        <th style={tableStyles.th}>Type</th>
                        <th style={tableStyles.th}>Interface</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => {
                        const isSvi = /^Ve\s+\d+$/i.test((it.interface || "").trim());
                        return (
                          <tr key={`${sw}-arp-${i}`}>
                            <td style={tableStyles.td}><code>{it.ip_address || "—"}</code></td>
                            <td style={tableStyles.td}><code>{it.mac_address || "—"}</code></td>
                            <td style={tableStyles.td}>{it.vlan ?? "—"}</td>
                            <td style={tableStyles.td}>{it.type || "—"}</td>
                            <td style={tableStyles.td}>
                              <code style={{ color: FG.bodyColor }}>{it.interface || "—"}</code>
                              {isSvi && (
                                <span style={{ color: FG.warningYellow, fontSize: 11, marginLeft: 6 }}>
                                  (SVI — MAC chase unavailable)
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </SwitchResultGroup>
              );
            })}
          </div>
        )}

        {/* MAC table results (mac / vlan / port) */}
        {(kind === "mac" || kind === "vlan" || kind === "port") && mac && totalMac > 0 && (
          <div>
            <div style={sectionLabel}>
              MAC-table entries
              <span style={{
                color: FG.mutedColor, marginLeft: 8,
                textTransform: "none", letterSpacing: 0,
              }}>· {totalMac} hit{totalMac === 1 ? "" : "s"}</span>
            </div>
            {Object.entries(groupBy(mac.items || [])).map(([sw, items]) => {
              const sl = mac.switch_level_data_by_ip?.[sw];
              return (
                <SwitchResultGroup
                  key={sw}
                  switchIp={sw}
                  switchName={switchNameByIp[sw]}
                  byType={sl?.by_type}
                  entriesSeen={sl?.entries_seen}
                  totalInTable={sl?.total_in_table}
                  truncated={sl?.truncated}
                >
                  <table style={tableStyles.table}>
                    <thead>
                      <tr>
                        <th style={tableStyles.th}>VLAN</th>
                        <th style={tableStyles.th}>MAC</th>
                        <th style={tableStyles.th}>Type</th>
                        <th style={tableStyles.th}>State</th>
                        <th style={tableStyles.th}>Interface</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={`${sw}-mac-${i}`}>
                          <td style={tableStyles.td}>{it.vlan ?? "—"}</td>
                          <td style={tableStyles.td}><code>{it.mac_dotted || it.mac || "—"}</code></td>
                          <td style={tableStyles.td}>{it.type || "—"}</td>
                          <td style={tableStyles.td}>{it.state || "—"}</td>
                          <td style={tableStyles.td}>
                            <code style={{ color: FG.bodyColor }}>{it.interface || "—"}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SwitchResultGroup>
              );
            })}
          </div>
        )}

        {/* Per-switch errors */}
        {((arp?.errors_by_ip && Object.keys(arp.errors_by_ip).length > 0) ||
          (mac?.errors_by_ip && Object.keys(mac.errors_by_ip).length > 0) ||
          (arpSupplement?.errors_by_ip && Object.keys(arpSupplement.errors_by_ip).length > 0)) && (
          <div>
            <div style={sectionLabel}>Per-switch errors</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: FG.bodyColor }}>
              {Object.entries({
                ...(arp?.errors_by_ip || {}),
                ...(mac?.errors_by_ip || {}),
                ...(arpSupplement?.errors_by_ip || {}),
              }).map(([sw, msg]) => (
                <li key={sw} style={{ fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: FG.errorRed, marginRight: 6 }}>✗</span>
                  <code>{sw}</code>: {msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Top-level warnings */}
        {((arp?.warnings?.length ?? 0) > 0 || (mac?.warnings?.length ?? 0) > 0) && (
          <div>
            <div style={sectionLabel}>Warnings</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: FG.bodyColor }}>
              {[...(arp?.warnings || []), ...(mac?.warnings || [])].map((w, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: FG.warningYellow, marginRight: 6 }}>⚠</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Empty hint — nothing searched yet */}
        {!haveResults && !err && !loading && (
          <div style={{
            padding: "16px 18px", borderRadius: 8,
            border: `1px solid ${FG.containerBorder}`,
            background: FG.subtleBg, color: FG.mutedColor, fontSize: 13, lineHeight: 1.55,
          }}>
            <div style={{ marginBottom: 6, color: FG.bodyColor }}>
              Paste anything searchable into the box. The compass tells you what it is and which tool to use.
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li><b>IP</b> — ARP lookup. Returns switch + interface + resolved MAC.</li>
              <li><b>MAC</b> — MAC-table lookup (unavailable on this server).</li>
              <li><b>Port</b> — ARP lookup for this port. Catches L3-attached hosts on the port.</li>
              <li><b>VLAN</b> — MAC-table lookup (unavailable on this server).</li>
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
