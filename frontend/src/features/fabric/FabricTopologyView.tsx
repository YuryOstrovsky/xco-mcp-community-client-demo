// FabricTopologyView — read-only Clos topology diagram for an XCO fabric.
//
// New feature (2026-06-26). Restores a lean version of the topology
// viewer that an earlier strip removed. Pure presentational w.r.t. app
// state: the parent (App.tsx) owns `open` and the selected `fabricName`
// and passes setters down. Everything else — fetching the fabric list,
// the device list, and the three topology layers (physical / underlay /
// overlay), parsing them defensively, laying them out in a Clos graph,
// and rendering the ReactFlow canvas — lives here and is self-contained.
//
// Read-only by construction: it issues only `*_get_*` reads, never a
// mutation, and the graph offers pan / zoom (free from ReactFlow) but no
// persisted drag-to-reposition.
//
// Field mapping mirrors the enterprise reference (mcp-client-demo's
// FabricTopoModal + the App.tsx topology fetch), with ONE deliberate
// difference: in this community codebase the topology tools take
// `fabric_name` (underscore), not the enterprise `fabric-name`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import { postJSON } from "../../lib/api";

// ── Parsed data contracts ──
export interface TopoDevice {
  ip: string;
  name?: string;
  role: string;
  leafType?: string;
  model?: string;
}

export type TopoLayer = "physical" | "underlay" | "overlay";

export interface TopoLink {
  srcIp: string;
  tgtIp: string;
  layer: TopoLayer;
  label: string;
  isLag?: boolean;
}

export interface FabricSummary {
  name: string;
  type?: string;
  stage?: string | number;
  status?: string;
}

export interface FabricTopologyViewProps {
  open: boolean;
  fabricName: string;
  onPickFabric: (name: string) => void;
  onClose: () => void;
}

// ── Role / Clos-tier helpers (inlined — no normRole in this codebase) ──
function normRole(role: string): string {
  return (role || "").toLowerCase().replace(/[\s_-]+/g, "");
}
/** role → Clos tier: 0 border/super-spine (top), 1 spine (middle), 2 leaf (bottom). */
function closTier(role: string): number {
  const r = normRole(role);
  if (r.includes("border") || r.includes("super")) return 0;
  if (r.includes("spine")) return 1;
  return 2;
}
/** role → short display label. */
function roleLabel(role: string): string {
  const r = normRole(role);
  if (r.includes("border")) return "Border";
  if (r.includes("super")) return "SuperSpine";
  if (r.includes("spine")) return "Spine";
  return "Leaf";
}

function compactPort(port: string): string {
  if (!port) return "?";
  return port.replace(/ethernet/i, "Eth").replace(/^Eth(ernet)?/i, "Eth");
}

// ── Loose JSON record + a string-coercing field reader ──
// MCP tool payloads are dynamically shaped; we read fields defensively
// across several naming conventions. `Rec` keeps us off `any`; `pick`
// returns the first non-empty string among the given keys.
type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
function pick(o: Rec, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

// ── Defensive payload unwrap (mirrors enterprise unwrapTopoLinks) ──
function unwrapPayload(r: unknown): Rec {
  const rr = asRec(r);
  const result = asRec(rr.result);
  const payload = asRec(result.payload);
  const inner = asRec(payload.payload);
  if (Object.keys(inner).length) return inner;
  if (Object.keys(payload).length) return payload;
  if (Object.keys(result).length) return result;
  return asRec(rr.payload);
}

function unwrapTopoLinks(r: unknown): Rec[] {
  const p = unwrapPayload(r);
  const data = asRec(p.data);
  const raw =
    p.links ??
    p.edges ??
    p.connections ??
    p.items ??
    data.links ??
    data.edges ??
    (Array.isArray(p.data) ? p.data : []);
  return Array.isArray(raw) ? (raw as Rec[]) : [];
}

// ── Parse a single device entry (mirrors the enterprise field access) ──
function parseDevice(d: Rec): TopoDevice | null {
  const ip = pick(d, "ip-address", "ip_address", "mgmt-ip", "ip");
  if (!ip) return null;
  const name = pick(d, "name", "hostname", "device_name");
  const role = pick(d, "role", "device-role");
  const leafType = pick(d, "leaf-type", "leaf_type");
  const model = pick(
    d,
    "chassis_name",
    "chassis-name",
    "device-model",
    "platform",
    "hardware",
    "hardware-model",
    "model",
  );
  return { ip, name, role, leafType, model };
}

// ── Parse a single link entry → { srcIp, tgtIp, srcPort, tgtPort, meta } ──
interface RawLink {
  srcIp: string;
  tgtIp: string;
  srcPort: string;
  tgtPort: string;
  meta: string;
}
function parseRawLink(lnk: Rec): RawLink | null {
  const srcIp =
    pick(lnk, "source-device-ip", "source_ip", "source-ip", "src_ip") ||
    pick(asRec(lnk.source), "ip") ||
    pick(lnk, "from");
  const tgtIp =
    pick(lnk, "destination-device-ip", "target_ip", "target-ip", "dst_ip") ||
    pick(asRec(lnk.target), "ip") ||
    pick(lnk, "to");
  if (!srcIp || !tgtIp) return null;
  const iLinks = asRec(lnk["inter-device-links"]);
  const srcPort =
    pick(iLinks, "source-node-interface") ||
    pick(lnk, "source_port", "source-port", "local_interface");
  const tgtPort =
    pick(iLinks, "destination-node-interface") ||
    pick(lnk, "target_port", "target-port", "remote_port");
  // Collect extra metadata (BGP / VXLAN fields surfaced in the hover label).
  const metaParts: string[] = [];
  const localAs = pick(lnk, "local-as", "local_as", "source-as");
  const remoteAs = pick(lnk, "remote-as", "remote_as", "destination-as", "peer-as");
  const vrf = pick(lnk, "vrf", "vrf-name");
  const state = pick(lnk, "state", "session-state", "bgp-state");
  const vni = pick(lnk, "vni", "vni-id");
  const vtep = pick(lnk, "vtep", "vtep-ip");
  if (localAs && remoteAs) metaParts.push(`AS ${localAs}↔${remoteAs}`);
  else if (remoteAs) metaParts.push(`AS ${remoteAs}`);
  if (vrf) metaParts.push(`VRF ${vrf}`);
  if (state) metaParts.push(state);
  if (vni) metaParts.push(`VNI ${vni}`);
  if (vtep) metaParts.push(`VTEP ${vtep}`);
  return { srcIp, tgtIp, srcPort, tgtPort, meta: metaParts.join(" | ") };
}

// Build deduped, LAG-collapsed TopoLinks for one layer.
function buildLayerLinks(
  raw: Rec[],
  layer: TopoLayer,
  fabricIps: Set<string>,
  nameOf: (ip: string) => string,
): TopoLink[] {
  const parsed: RawLink[] = [];
  for (const r of raw) {
    const p = parseRawLink(r);
    if (p && fabricIps.has(p.srcIp) && fabricIps.has(p.tgtIp)) parsed.push(p);
  }
  // Dedup A→B / B→A by normalized (ip-pair, port-pair).
  const seen = new Set<string>();
  const deduped: RawLink[] = [];
  for (const lnk of parsed) {
    const flip = lnk.srcIp > lnk.tgtIp;
    const [loIp, hiIp] = flip ? [lnk.tgtIp, lnk.srcIp] : [lnk.srcIp, lnk.tgtIp];
    const [loPort, hiPort] = flip ? [lnk.tgtPort, lnk.srcPort] : [lnk.srcPort, lnk.tgtPort];
    const key = `${loIp}::${hiIp}::${loPort}::${hiPort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ srcIp: loIp, tgtIp: hiIp, srcPort: loPort, tgtPort: hiPort, meta: lnk.meta });
  }
  // Group by device-pair → collapse parallel links into a LAG (physical only).
  const pairMap = new Map<string, RawLink[]>();
  for (const lnk of deduped) {
    const key = `${lnk.srcIp}::${lnk.tgtIp}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key)!.push(lnk);
  }
  const out: TopoLink[] = [];
  for (const group of pairMap.values()) {
    const g0 = group[0];
    const isLag = group.length > 1 && layer === "physical";
    const hasPorts = group.some((l) => l.srcPort || l.tgtPort);
    const groupMeta = group.map((l) => l.meta).filter(Boolean).join("; ");
    let label: string;
    if (hasPorts) {
      const ports = group
        .map((l) => `${compactPort(l.srcPort)}→${compactPort(l.tgtPort)}`)
        .join(", ");
      label = isLag
        ? `LAG (${group.length}×)\n${nameOf(g0.srcIp)} ↔ ${nameOf(g0.tgtIp)}\n${ports}`
        : `${nameOf(g0.srcIp)} ${compactPort(g0.srcPort)}\n→ ${nameOf(g0.tgtIp)} ${compactPort(g0.tgtPort)}`;
    } else if (layer === "underlay") {
      label = groupMeta ? `BGP Peering\n${groupMeta.split(" | ").join("\n")}` : "BGP Peering";
    } else if (layer === "overlay") {
      label = groupMeta ? `VXLAN Tunnel\n${groupMeta.split(" | ").join("\n")}` : "VXLAN Tunnel";
    } else {
      label = group.length > 1 ? `${group.length} links` : "link";
    }
    out.push({ srcIp: g0.srcIp, tgtIp: g0.tgtIp, layer, isLag, label });
  }
  return out;
}

// ── Clos layout: tier rows top→bottom, evenly spaced columns ──
const NODE_W = 190;
const COL_GAP = 70;
const ROW_GAP = 150;
const TOP_PAD = 30;

const TIER_ACCENT: Record<number, string> = {
  0: "#7c3aed", // border / super-spine
  1: "#818cf8", // spine
  2: "#22d3ee", // leaf
};

function layoutNodes(devices: TopoDevice[], labelMode: "name-ip" | "ip"): Node[] {
  // Bucket by tier.
  const tiers = new Map<number, TopoDevice[]>();
  for (const d of devices) {
    const t = closTier(d.role);
    if (!tiers.has(t)) tiers.set(t, []);
    tiers.get(t)!.push(d);
  }
  const sortedTiers = [...tiers.keys()].sort((a, b) => a - b);
  const widestRow = Math.max(1, ...[...tiers.values()].map((r) => r.length));
  const canvasW = widestRow * (NODE_W + COL_GAP);

  const nodes: Node[] = [];
  sortedTiers.forEach((tier, rowIdx) => {
    const row = tiers.get(tier)!;
    const rowW = row.length * (NODE_W + COL_GAP);
    const xStart = (canvasW - rowW) / 2;
    row.forEach((d, colIdx) => {
      const x = xStart + colIdx * (NODE_W + COL_GAP);
      const y = TOP_PAD + rowIdx * ROW_GAP;
      const accent = TIER_ACCENT[tier] ?? "#818cf8";
      const rl = roleLabel(d.role);
      const title = d.name || d.ip;
      const sub =
        labelMode === "ip"
          ? rl
          : [d.ip !== title ? d.ip : "", rl + (d.leafType ? ` · ${d.leafType}` : "")]
              .filter(Boolean)
              .join("\n");
      nodes.push({
        id: d.ip,
        position: { x, y },
        data: {
          label: (
            <div style={{ textAlign: "center", lineHeight: 1.35 }}>
              <div style={{ fontWeight: 700, color: "var(--heading-color)" }}>{title}</div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--dim-color)",
                  whiteSpace: "pre-line",
                }}
                title={d.model ? `Model: ${d.model}` : undefined}
              >
                {sub}
              </div>
            </div>
          ),
        },
        style: {
          border: `2px solid ${accent}`,
          background: "var(--container-bg)",
          borderRadius: 12,
          width: NODE_W,
          padding: 8,
          fontSize: 12,
          fontFamily: "ui-monospace,monospace",
        },
      });
    });
  });
  return nodes;
}

const LAYER_STROKE: Record<TopoLayer, string> = {
  physical: "#94a3b8",
  underlay: "#818cf8",
  overlay: "#d97706",
};

function buildEdges(links: TopoLink[]): Edge[] {
  return links.map((lnk, i) => {
    const stroke = LAYER_STROKE[lnk.layer];
    return {
      id: `${lnk.layer}-${lnk.srcIp}-${lnk.tgtIp}-${i}`,
      source: lnk.srcIp,
      target: lnk.tgtIp,
      data: { fullLabel: lnk.label },
      style: {
        stroke,
        strokeWidth: lnk.isLag ? 3 : 1.5,
        strokeDasharray: lnk.layer === "underlay" ? "8 4" : lnk.layer === "overlay" ? "3 3" : undefined,
      },
    };
  });
}

export function FabricTopologyView(props: FabricTopologyViewProps) {
  const { open, fabricName, onPickFabric, onClose } = props;

  const [fabricList, setFabricList] = useState<FabricSummary[]>([]);
  const [devices, setDevices] = useState<TopoDevice[]>([]);
  const [links, setLinks] = useState<TopoLink[]>([]);
  const [layer, setLayer] = useState<TopoLayer>("physical");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [labelMode, setLabelMode] = useState<"name-ip" | "ip">("name-ip");
  const [edgeTip, setEdgeTip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Track the fabric we last loaded so the effect doesn't refetch on every render.
  const loadedFabricRef = useRef<string>("");

  const loadFabricList = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await postJSON<unknown>("/api/invoke", {
        tool: "fabric_get_fabrics",
        inputs: {},
      });
      const p = unwrapPayload(r);
      const raw: Rec[] =
        (Array.isArray(p.fabrics) ? (p.fabrics as Rec[]) : null) ??
        (Array.isArray(p.items) ? (p.items as Rec[]) : null) ??
        (Array.isArray(p) ? (p as Rec[]) : []);
      const fabrics: FabricSummary[] = raw
        .map((f) => ({
          name: pick(f, "name", "fabric_name", "fabric-name"),
          stage: pick(f, "stage", "fabric-stage"),
          type: pick(f, "type", "fabric_type", "fabric-type"),
          status: pick(f, "status", "operational-status"),
        }))
        .filter((f) => f.name && f.name.toLowerCase() !== "default");
      fabrics.sort((a, b) => a.name.localeCompare(b.name));
      setFabricList(fabrics);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to fetch fabric list");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTopology = useCallback(async (name: string) => {
    setLoading(true);
    setErr("");
    setDevices([]);
    setLinks([]);
    try {
      // Devices first.
      const devR = await postJSON<unknown>("/api/invoke", {
        tool: "fabric_get_devices",
        inputs: { fabric_name: name },
      });
      const devP = unwrapPayload(devR);
      const devRaw: Rec[] =
        (Array.isArray(devP.items) ? (devP.items as Rec[]) : null) ??
        (Array.isArray(devP.devices) ? (devP.devices as Rec[]) : null) ??
        (Array.isArray(devP) ? (devP as Rec[]) : []);
      const devs = devRaw
        .map(parseDevice)
        .filter((d): d is TopoDevice => d !== null);

      // Three topology layers in parallel — each may be absent / empty.
      const [physR, underR, overR] = await Promise.all([
        postJSON<unknown>("/api/invoke", {
          tool: "fabric_get_physical_topology",
          inputs: { fabric_name: name },
        }).catch(() => null),
        postJSON<unknown>("/api/invoke", {
          tool: "fabric_get_underlay_topology",
          inputs: { fabric_name: name },
        }).catch(() => null),
        postJSON<unknown>("/api/invoke", {
          tool: "fabric_get_overlay_topology",
          inputs: { fabric_name: name },
        }).catch(() => null),
      ]);

      // Enrich device names from the topology payloads (source/destination hostnames).
      const ipToName = new Map<string, string>();
      for (const r of [physR, underR, overR]) {
        for (const lnk of unwrapTopoLinks(r)) {
          const sip = pick(lnk, "source-device-ip");
          const sname = pick(lnk, "source-device-hostname");
          const dip = pick(lnk, "destination-device-ip");
          const dname = pick(lnk, "destination-device-hostname");
          if (sip && sname) ipToName.set(sip, sname);
          if (dip && dname) ipToName.set(dip, dname);
        }
      }
      for (const d of devs) {
        if (!d.name && ipToName.has(d.ip)) d.name = ipToName.get(d.ip);
      }

      const fabricIps = new Set(devs.map((d) => d.ip));
      const nameOf = (ip: string) => devs.find((d) => d.ip === ip)?.name || ip;
      const allLinks: TopoLink[] = [
        ...buildLayerLinks(unwrapTopoLinks(physR), "physical", fabricIps, nameOf),
        ...buildLayerLinks(unwrapTopoLinks(underR), "underlay", fabricIps, nameOf),
        ...buildLayerLinks(unwrapTopoLinks(overR), "overlay", fabricIps, nameOf),
      ];

      setDevices(devs);
      setLinks(allLinks);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load fabric topology");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on open / fabric change.
  useEffect(() => {
    if (!open) {
      loadedFabricRef.current = "";
      return;
    }
    if (!fabricName) {
      // Picker mode — fetch the fabric list once.
      loadedFabricRef.current = "";
      if (!fabricList.length) void loadFabricList();
      return;
    }
    if (loadedFabricRef.current === fabricName) return;
    loadedFabricRef.current = fabricName;
    setLayer("physical");
    void loadTopology(fabricName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fabricName]);

  const visibleLinks = useMemo(
    () => links.filter((l) => l.layer === layer),
    [links, layer],
  );
  const nodes = useMemo(() => layoutNodes(devices, labelMode), [devices, labelMode]);
  const edges = useMemo(() => buildEdges(visibleLinks), [visibleLinks]);

  if (!open) return null;

  const networkIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" />
    </svg>
  );

  const layerBtn = (l: TopoLayer): React.CSSProperties => {
    const active = layer === l;
    const color = LAYER_STROKE[l];
    return {
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
      cursor: "pointer",
      border: `1px solid ${active ? color : "var(--container-border)"}`,
      background: active ? `${color}22` : "transparent",
      color: active ? color : "var(--muted-color)",
      transition: "all 0.15s",
    };
  };

  // Picker mode — no fabric selected yet.
  const pickerMode = !fabricName;

  return (
    <div
      style={{
        background: "var(--container-bg)",
        border: "1px solid var(--container-border)",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 18px 34px rgba(0,0,0,0.38)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          background: "var(--header-tint-bg)",
          borderBottom: "1px solid var(--container-border)",
          display: "flex", alignItems: "start", justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {networkIcon}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--heading-color)" }}>
                Fabric Topology
              </h2>
              {fabricName ? (
                <span style={{ fontSize: 14, color: "var(--muted-color)", fontWeight: 400 }}>
                  &mdash; {fabricName}
                </span>
              ) : null}
            </div>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--dim-color)" }}>
              Read-only Clos diagram &middot; Physical &middot; Underlay &middot; Overlay
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            color: "var(--muted-color)", background: "transparent", border: "none",
            padding: 8, borderRadius: 8, cursor: "pointer", lineHeight: 0, transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--heading-color)"; e.currentTarget.style.background = "var(--btn-neutral-bg)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-color)"; e.currentTarget.style.background = "transparent"; }}
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Controls bar */}
      <div
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--container-border)",
          background: "var(--inner-card-bg)",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}
      >
        {/* Fabric picker — always shown so the operator can switch fabrics. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted-color)", fontWeight: 500 }}>Fabric:</span>
          <select
            style={{
              padding: "6px 12px", fontSize: 12,
              background: "var(--inner-card-bg)", color: "var(--subtitle-color)",
              border: "1px solid var(--container-border)", borderRadius: 8, outline: "none",
            }}
            value={fabricName}
            onChange={(e) => onPickFabric(e.target.value)}
            disabled={loading}
          >
            <option value="">{fabricList.length ? "Select a fabric…" : "(no fabrics)"}</option>
            {fabricList.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
                {f.type ? ` — ${f.type}` : ""}
              </option>
            ))}
          </select>
          <button
            title="Refresh fabric list"
            style={{
              padding: "5px 8px", fontSize: 12, borderRadius: 6,
              background: "transparent", border: "1px solid var(--container-border)",
              color: "var(--muted-color)", cursor: loading ? "wait" : "pointer", opacity: 0.7,
            }}
            disabled={loading}
            onClick={() => void loadFabricList()}
          >
            {"⟳"}
          </button>
        </div>

        {/* Layer toggle */}
        {fabricName ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button style={layerBtn("physical")} onClick={() => setLayer("physical")}>Physical</button>
            <button style={layerBtn("underlay")} onClick={() => setLayer("underlay")}>Underlay</button>
            <button style={layerBtn("overlay")} onClick={() => setLayer("overlay")}>Overlay</button>
          </div>
        ) : null}

        {/* Node-label mode */}
        {fabricName ? (
          <select
            style={{
              padding: "6px 12px", fontSize: 12,
              background: "var(--inner-card-bg)", color: "var(--subtitle-color)",
              border: "1px solid var(--container-border)", borderRadius: 8, outline: "none",
            }}
            value={labelMode}
            onChange={(e) => setLabelMode(e.target.value === "ip" ? "ip" : "name-ip")}
          >
            <option value="name-ip">Nodes: Name + IP</option>
            <option value="ip">Nodes: IP only</option>
          </select>
        ) : null}

        {err ? <span style={{ fontSize: 12, color: "#ef4444" }}>{err}</span> : null}
      </div>

      {/* Body */}
      <div style={{ position: "relative" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--muted-color)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              Loading topology{fabricName ? ` for ${fabricName}` : ""}…
            </div>
            <div style={{ fontSize: 12, color: "var(--dim-color)" }}>
              Fetching devices + physical / underlay / overlay layers
            </div>
          </div>
        ) : pickerMode ? (
          <div style={{ padding: 24 }}>
            <p style={{ fontSize: 14, color: "var(--muted-color)", marginBottom: 16 }}>
              Select a fabric to view its read-only topology diagram:
            </p>
            {fabricList.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--dim-color)" }}>
                No fabrics found.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {fabricList.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => onPickFabric(f.name)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 18px", borderRadius: 8,
                      background: "var(--inner-card-bg)", border: "1px solid var(--container-border)",
                      color: "var(--heading-color)", cursor: "pointer", textAlign: "left",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--row-hover-border)"; e.currentTarget.style.background = "var(--row-hover-bg)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--container-border)"; e.currentTarget.style.background = "var(--inner-card-bg)"; }}
                  >
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--heading-color)", marginBottom: 4 }}>{f.name}</div>
                      <div style={{ fontSize: 13, color: "var(--dim-color)" }}>
                        {[f.type, f.stage ? `stage ${f.stage}` : "", f.status].filter(Boolean).join(" · ") || "fabric"}
                      </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : devices.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--muted-color)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              No topology data for {fabricName}
            </div>
            <div style={{ fontSize: 12, color: "var(--dim-color)", maxWidth: 420, margin: "0 auto" }}>
              The fabric returned no devices. It may be empty, not yet deployed, or the
              topology endpoints have no data for it.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex" }}>
            {/* Legend sidebar */}
            <div
              style={{
                width: 150, flexShrink: 0, padding: 16,
                background: "var(--inner-card-bg-2)", borderRight: "1px solid var(--container-border)",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted-color)", fontWeight: 600, marginBottom: 10 }}>Devices</div>
              {(() => {
                const byRole: Record<string, number> = {};
                for (const d of devices) {
                  const rl = roleLabel(d.role);
                  byRole[rl] = (byRole[rl] ?? 0) + 1;
                }
                return Object.entries(byRole).map(([rl, n]) => (
                  <div key={rl} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginBottom: 6 }}>
                    <span style={{ color: "var(--heading-color)" }}>{n}</span>
                    <span style={{ color: "var(--dim-color)" }}>{rl}</span>
                  </div>
                ));
              })()}
              <div style={{ borderTop: "1px solid var(--container-border)", margin: "12px 0", paddingTop: 12 }}>
                <div style={{ fontSize: 11, color: "var(--dim-color)", marginBottom: 8 }}>Active layer</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 18, height: 0, borderTop: `2px ${layer === "physical" ? "solid" : layer === "underlay" ? "dashed" : "dotted"} ${LAYER_STROKE[layer]}` }} />
                  <span style={{ fontSize: 11, color: "var(--dim-color)", textTransform: "capitalize" }}>{layer}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-color)" }}>
                  {visibleLinks.length} link{visibleLinks.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            {/* ReactFlow canvas */}
            <div style={{ flex: 1, height: 500, position: "relative" }}>
              {visibleLinks.length === 0 ? (
                <div
                  style={{
                    position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
                    zIndex: 5, fontSize: 11, color: "var(--dim-color)",
                    background: "var(--inner-card-bg)", border: "1px solid var(--container-border)",
                    borderRadius: 8, padding: "4px 10px", pointerEvents: "none",
                  }}
                >
                  No {layer} links for this fabric
                </div>
              ) : null}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                proOptions={{ hideAttribution: true }}
                onPaneClick={() => setEdgeTip(null)}
                onEdgeMouseEnter={(evt, edge) => {
                  const full = asRec(edge?.data).fullLabel ?? "";
                  setEdgeTip({ text: String(full), x: evt.clientX, y: evt.clientY });
                }}
                onEdgeMouseMove={(evt) =>
                  setEdgeTip((prev) => (prev ? { ...prev, x: evt.clientX, y: evt.clientY } : null))
                }
                onEdgeMouseLeave={() => setEdgeTip(null)}
              >
                <MiniMap />
                <Controls showInteractive={false} />
                <Background />
              </ReactFlow>
              <div
                style={{
                  position: "absolute", bottom: 8, left: 16,
                  fontSize: 11, color: "var(--dim-color)", pointerEvents: "none",
                }}
              >
                {devices.length} devices &middot; {visibleLinks.length} {layer} links
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edge hover tooltip */}
      {edgeTip ? (
        <div
          style={{
            position: "fixed",
            left: Math.min(edgeTip.x + 14, window.innerWidth - 380),
            top: Math.min(edgeTip.y + 14, window.innerHeight - 120),
            maxWidth: 360,
            background: "var(--container-bg)", color: "var(--heading-color)",
            border: "1px solid #818cf8", borderRadius: 8,
            boxShadow: "0 10px 26px rgba(0,0,0,0.55)", padding: "10px 14px",
            zIndex: 10001, pointerEvents: "none",
            fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace,monospace",
            whiteSpace: "pre-line",
          }}
        >
          {edgeTip.text}
        </div>
      ) : null}
    </div>
  );
}
