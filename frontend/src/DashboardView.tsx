import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/**
 * DashboardView
 * - Pure front-end view: calls back into App.tsx via `invoke` to run tools.
 * - This file is intentionally self-contained and strongly typed so App.tsx lambdas
 *   get contextual typing (no implicit-any).
 */

export type ToolInputs = Record<string, any>;

export type DashboardViewProps = {
  invoke: (tool: string, inputs?: ToolInputs, opts?: { include_raw?: boolean }) => Promise<any>;
  onOpenInConsole: (tool: string, inputs: ToolInputs) => Promise<void> | void;
};

type HealthTone = "good" | "warn" | "bad" | "neutral";


type DashboardData = {
  // Keep these names stable so we can evolve parsing later.
  system?: any;
  fabrics?: any;
  tenants?: any;
  tenantHealth?: any;
  devices?: any;
  alarms?: any;
  deviceHealth?: any;
  switchesTable?: any;
  switchesWidget?: any;
  restconfPortStats?: any;
  restconfLldp?: any;
};

const PIE_COLORS = ["var(--accent)", "var(--accent-egress)", "rgba(139,143,216,0.35)", "rgba(255,255,255,0.10)"];

function isObj(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNum(v: any): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function num(v: any): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return isNum(n) ? n : null;
}

function fmtCompact(v: any): string {
  const n = num(v);
  if (n === null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(Math.round(n));
}

function panelStyle() {
  return { background: "var(--bg1)", border: "1px solid var(--border)" as const };
}

function toneDot(tone: HealthTone) {
  const c =
    tone === "good"
      ? "rgba(60, 220, 120, 0.95)"
      : tone === "warn"
      ? "rgba(255, 200, 0, 0.95)"
      : tone === "bad"
      ? "rgba(255, 80, 80, 0.95)"
      : "rgba(180, 180, 190, 0.95)";
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        display: "inline-block",
        background: c,
        marginRight: 8,
        boxShadow: "0 0 0 2px rgba(0,0,0,0.25)",
      }}
    />
  );
}



function classifyToneFromText(s: string): HealthTone {
  const t = s.toLowerCase();
  if (t.includes("critical") || t.includes("red") || t.includes("down") || t.includes("unhealthy") || t.includes("failed")) return "bad";
  if (t.includes("major") || t.includes("degraded") || t.includes("warn") || t.includes("yellow")) return "warn";
  if (t.includes("healthy") || t.includes("ok") || t.includes("green") || t.includes("up")) return "good";
  return "neutral";
}

function deepPick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const segs = p.split(".");
    let cur: any = obj;
    let ok = true;
    for (const s of segs) {
      if (!isObj(cur) && !Array.isArray(cur)) {
        ok = false;
        break;
      }
      cur = (cur as any)?.[s];
      if (cur === undefined) {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

// Best-effort unwrap your MCP response shape: { result: { tool, status, payload: ... } }
function unwrapPayload(resp: any): any {
  if (!resp) return resp;
  const r = resp?.result ?? resp;
  const p = r?.payload ?? r;
  return p?.payload ?? p; // many tier-2 wrap as {status,payload:{...}}
}

const ALARM_KEYS = ["critical", "major", "minor", "warning", "info"] as const;
type AlarmKey = (typeof ALARM_KEYS)[number];

function emptyAlarmBuckets(): Record<AlarmKey, number> {
  return { critical: 0, major: 0, minor: 0, warning: 0, info: 0 };
}

function normalizeBucketKey(k: string): AlarmKey | null {
  const s = k.toLowerCase();
  if (s.includes("crit")) return "critical";
  if (s.includes("maj")) return "major";
  if (s.includes("min")) return "minor";
  if (s.includes("warn")) return "warning";
  if (s.includes("info")) return "info";
  return null;
}


function safeText(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}


function parseMaybeJson<T = any>(v: any): T {
  if (typeof v !== "string") return v as T;
  const s = v.trim();
  if (!s) return v as T;
  const looksJson =
    (s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"));
  if (!looksJson) return v as T;
  try {
    return JSON.parse(s) as T;
  } catch {
    return v as T;
  }
}

function pickStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function hqiTone(color: any): HealthTone {
  const s = String(color ?? "").toLowerCase();
  if (s.includes("red")) return "bad";
  if (s.includes("yellow") || s.includes("orange")) return "warn";
  if (s.includes("green")) return "good";
  // XCO sometimes uses "Black" for info/neutral
  if (s.includes("black")) return "neutral";
  return "neutral";
}

function Panel(props: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-4" style={panelStyle()}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base" style={{ fontWeight: 700 }}>
            {props.title}
          </div>
          {props.subtitle ? <div className="text-sm opacity-80 mt-0.5">{props.subtitle}</div> : null}
        </div>
        {props.right ? <div>{props.right}</div> : null}
      </div>
      <div className="mt-3">{props.children}</div>
    </div>
  );
}

function MiniStat(props: { label: string; value: string; tone?: HealthTone }) {
  return (
    <div className="rounded-md px-3 py-2" style={{ background: "var(--bg0)", border: "1px solid var(--border)" }}>
      <div className="text-xs opacity-80">{props.label}</div>
      <div className="text-sm mt-0.5" style={{ fontWeight: 700 }}>
        {props.tone ? toneDot(props.tone) : null}
        {props.value}
      </div>
    </div>
  );
}

function ChartTooltip(props: any) {
  const active = props?.active;
  const payload = props?.payload;
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div
      className="rounded-md px-3 py-2 text-sm"
      style={{ background: "var(--bg0)", border: "1px solid var(--border)", color: "var(--text)" }}
    >
      <div style={{ fontWeight: 700 }}>{p?.name ?? "—"}</div>
      <div className="opacity-80">value: {safeText(p?.value)}</div>
    </div>
  );
}

export default function DashboardView(props: DashboardViewProps) {
  const { invoke, onOpenInConsole } = props;

  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [data, setData] = useState<DashboardData>({});
  const [restconfSelectedIp, setRestconfSelectedIp] = useState<string>("");
  const [restconfLldpLoading, setRestconfLldpLoading] = useState<boolean>(false);
  const [restconfLldpErr, setRestconfLldpErr] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      // These are all "runnable without inputs" in your scan output.
      const [system, fabrics, tenants, tenantHealth, devices, alarms, deviceHealth, switchesTable, switchesWidget] = await Promise.all([
        invoke("system_get_ha_and_node_health_summary", {}),
        invoke("fabric_get_fabrics_health", {}),
        invoke("tenant_get_tenants", {}),
        invoke("tenant_get_health", {}),
        invoke("inventory_get_unreachable_devices", {}),
        invoke("faultmanager_get_alarm_summary", {}),
        invoke("inventory_get_device_health_rollup", {}),
        invoke("inventory_getswitches", {}),
        invoke("inventory_get_switches_widget_table", { max_items: 50 })
      ]);

      // RESTCONF widget data: best-effort (never break the dashboard if RESTCONF is not configured yet)
      let restconfPortStats: any = null;
      try {
        const rawSku = unwrapPayload(switchesTable);
        const skuItems =
          (Array.isArray(rawSku?.items) ? rawSku.items : null) ??
          (Array.isArray(rawSku?.payload?.items) ? rawSku.payload.items : null) ??
          [];
        const candidates: { ip: string; score: number }[] = [];
        for (const it of skuItems as any[]) {
          const ip = pickStr(it?.ip_address ?? it?.ip ?? it?.management_ip ?? it?.mgmt_ip ?? it?.address);
          if (!ip) continue;
          const hay = String(
            (it?.chassis_name ?? "") +
              " " +
              (it?.model ?? "") +
              " " +
              (it?.device_type ?? "") +
              " " +
              (it?.type ?? "")
          ).toLowerCase();
          const score = hay.includes("slx") ? 10 : 0;
          candidates.push({ ip, score });
        }

        // Prefer SLX-like devices first (RESTCONF toolpack targets SLX), then fill remaining.
        candidates.sort((a, b) => b.score - a.score);

        const ips: string[] = [];
        for (const c of candidates) {
          if (!ips.includes(c.ip)) ips.push(c.ip);
          if (ips.length >= 5) break;
        }

        if (ips.length) {
          const results = await Promise.all(
            ips.map((ip) =>
              invoke("restconf_get_port_statistics_summary", { switch_ip: ip, max_ports: 64, top_n: 5 }).catch((e: any) => ({
                __error: String(e?.message ?? e),
                switch_ip: ip,
              }))
            )
          );
          restconfPortStats = { targets: ips, results };
        } else {
          restconfPortStats = { targets: [], results: [], __note: "No switch IPs found in inventory to query via RESTCONF." };
        }
      } catch (e: any) {
        restconfPortStats = { targets: [], results: [], __error: String(e?.message ?? e) };
      }

      setData({ system, fabrics, tenants, tenantHealth, devices, alarms, deviceHealth, switchesTable, switchesWidget, restconfPortStats });
      setLastUpdated(new Date().toLocaleString());
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
// SYSTEM widget model
// -------------------------
const systemModel = useMemo(() => {
  const raw = unwrapPayload(data.system);

  // In XCO, `system_health_status` is often a JSON string.
  const parsed = parseMaybeJson<any>(deepPick(raw, ["system_health_status"]) ?? raw?.system_health_status);

  const healthObj = isObj(parsed) ? parsed : isObj(raw) ? raw : {};

  const nodes = Array.isArray((healthObj as any).nodes) ? (healthObj as any).nodes : [];

  // Collect HQI checks from nodes[].HQI (array)
  const hqiChecks: any[] = [];
  for (const n of nodes) {
    const arr = Array.isArray(n?.HQI) ? n.HQI : Array.isArray(n?.hqi) ? n.hqi : [];
    for (const c of arr) hqiChecks.push(c);
  }

  // Normalize a check into { resource, color, statusText }
  const norm = (c: any) => {
    const resource = pickStr(c?.Resource ?? c?.resource) ?? "";
    const color = c?.HQI?.Color ?? c?.HQI?.color ?? c?.Color ?? c?.color ?? null;
    const statusText = pickStr(c?.StatusText ?? c?.statusText ?? c?.status) ?? "—";
    return { resource, color, statusText };
  };

  const findCheck = (needle: string) => {
    const nn = needle.toLowerCase();
    for (const c of hqiChecks) {
      const { resource } = norm(c);
      if (resource.toLowerCase().includes(nn)) return norm(c);
    }
    return null;
  };

  // Determine overall tone from HQI colors (worst wins)
  let overallTone: HealthTone = "neutral";
  for (const c of hqiChecks) {
    const { color, statusText } = norm(c);
    const t = hqiTone(color);

    // If statusText clearly indicates a failure, treat as warn/bad even if color is missing.
    const ts = statusText.toLowerCase();
    const t2 =
      ts.includes("fail") || ts.includes("error") || ts.includes("down")
        ? "bad"
        : ts.includes("warn") || ts.includes("degrad")
        ? "warn"
        : t;

    if (t2 === "bad") {
      overallTone = "bad";
      break;
    }
    if (t2 === "warn") overallTone = "warn";
    if (t2 === "good" && overallTone === "neutral") overallTone = "good";
  }

  // Fallback: if we couldn't infer from HQI, try text fields (but avoid dumping huge JSON strings)
  if (overallTone === "neutral" && hqiChecks.length === 0) {
    const labelCandidates = [
      deepPick(raw, ["summary", "status"]),
      deepPick(raw, ["summary", "overall_status"]),
      deepPick(raw, ["health", "status"]),
      deepPick(raw, ["status"]),
    ]
      .map((v) => safeText(v))
      .filter(Boolean);

    const labelText = labelCandidates[0] || "";
    overallTone = classifyToneFromText(labelText);
  }

  const label =
    overallTone === "good"
      ? "Healthy"
      : overallTone === "warn"
      ? "Degraded"
      : overallTone === "bad"
      ? "Unhealthy"
      : "Unknown";

  const details: { label: string; value: string; tone: HealthTone }[] = [];

  const mkMini = (title: string, needle: string) => {
    const c = findCheck(needle);
    if (!c) return { label: title, value: "—", tone: "neutral" as HealthTone };
    const tone = hqiTone(c.color);
    return { label: title, value: c.statusText, tone };
  };

// Keep only the signals we care about on the dashboard.
// (Storage/Security are often missing for our current API access.)
details.push(mkMini("High availability", "/app/system/ha"));

// Add microservices stats if present on node objects
if (nodes.length) {
  const podRunning = nodes.reduce((acc: number, n: any) => acc + (num(n?.pod_count_running) ?? 0), 0);
  const podFailed = nodes.reduce((acc: number, n: any) => acc + (num(n?.pod_count_failed) ?? 0), 0);
  if (podRunning || podFailed) {
    const tone: HealthTone = podFailed > 0 ? "warn" : "good";
    const val = podFailed > 0 ? `${podRunning} running, ${podFailed} failed` : `${podRunning} running`;
    details.push({ label: "Microservices", value: val, tone });
  }
}

  return { overall: { label, tone: overallTone }, details, raw };
}, [data.system]);


  // -------------------------
  // FABRICS widget model
  // -------------------------
  const fabricsModel = useMemo(() => {
    const raw = unwrapPayload(data.fabrics);

    // Console adapter (App.tsx) uses: f.headline.fabric_health / fabric_status / topology_health.
    // Dashboard should use the same fields first, then fall back to older shapes.
    const list = Array.isArray(raw) ? raw : raw?.payload ?? raw?.items ?? raw?.fabrics;
    const fabrics = Array.isArray(list) ? list : [];

    const bucketKey = (v: any): "Green" | "Yellow" | "Red" | "Unknown" => {
      if (v === null || v === undefined) return "Unknown";

      // If it’s an object (rare), try common nested fields.
      if (isObj(v)) {
        const nested =
          (v as any).color ??
          (v as any).Color ??
          (v as any).health_color ??
          (v as any).healthColor ??
          (v as any).health ??
          (v as any).value ??
          (v as any).Value;
        return bucketKey(nested);
      }

      // Numeric forms: 0=green/ok, 1=yellow/warn, 2+=red/bad
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null;
      if (n !== null) {
        if (n <= 0) return "Green";
        if (n === 1) return "Yellow";
        return "Red";
      }

      const s = String(v).toLowerCase();
      if (s.includes("green") || s.includes("healthy") || s === "ok" || s.includes("success")) return "Green";
      if (s.includes("yellow") || s.includes("warn") || s.includes("warning") || s.includes("degraded")) return "Yellow";
      if (s.includes("red") || s.includes("critical") || s.includes("down") || s.includes("unhealthy") || s.includes("fail")) return "Red";
      return "Unknown";
    };

    const byHealth: Record<string, number> = {};

    for (const f of fabrics) {
      
const health =
  // Console adapter / modern shapes
  f?.headline?.fabric_health ??
  f?.headline?.health ??
  // XCO API kebab-case fields (your payload)
  (f as any)?.["fabric-health"] ??
  (f as any)?.["health-color"] ??
  (f as any)?.["fabric-level-physical-topology-health"]?.health ??
  // older shapes
  (f as any)?.health_color ??
  (f as any)?.health ??
  (f as any)?.health_raw?.health ??
  (f as any)?.health_raw?.health_color ??
  // last resort: status fields
  (f as any)?.["fabric-status"] ??
  (f as any)?.status ??
  "Unknown";

      const key = bucketKey(health);
      byHealth[key] = (byHealth[key] ?? 0) + 1;
    }

    const total = fabrics.length;
    const pie = ["Red", "Yellow", "Green", "Unknown"]
      .filter((k) => (byHealth[k] ?? 0) > 0)
      .map((k) => ({ name: k, value: byHealth[k] ?? 0 }));

    return { total, pie, fabrics, raw };
  }, [data.fabrics]);

  // -------------------------
// TENANTS widget model
// -------------------------
// -------------------------
// TENANTS widget model (plottable)
// -------------------------
const tenantsModel = useMemo(() => {
  const rawList = unwrapPayload(data.tenants);
  const rawHealth = unwrapPayload((data as any).tenantHealth);

  const tenantList =
    (rawList && Array.isArray((rawList as any).tenant) ? (rawList as any).tenant :
    rawList && Array.isArray((rawList as any).tenants) ? (rawList as any).tenants :
    Array.isArray(rawList) ? rawList : []) as any[];

  type Row = { id?: number; name: string; type?: string; ports: number; epgs: number; l2: number; l3: number };

  const rows: Row[] = tenantList
    .map((t: any) => {
      const name = safeText(t?.name);
      const id = num(t?.id) ?? undefined;
      const type = safeText(t?.type) || undefined;

      // ports: sum port-list[].port[].length
      let ports = 0;
      const pl = t?.["port-list"];
      if (Array.isArray(pl)) {
        for (const sw of pl) {
          const portsArr = sw?.port;
          if (Array.isArray(portsArr)) ports += portsArr.length;
        }
      }

      const epgs = Array.isArray(t?.["epg-list"]) ? t["epg-list"].length : 0;
      const l2 = num(t?.["l2-vni-capacity"]) ?? 0;
      const l3 = num(t?.["l3-vni-capacity"]) ?? 0;

      return { id, name, type, ports, epgs, l2, l3 };
    })
    .filter((r: Row) => r.name !== "—");

  const total = rows.length;

  const metricCandidates = [
    { key: "ports" as const, label: "Ports", get: (r: Row) => r.ports },
    { key: "l2" as const, label: "L2 VNIs", get: (r: Row) => r.l2 },
    { key: "l3" as const, label: "L3 VNIs", get: (r: Row) => r.l3 },
    { key: "epgs" as const, label: "EPGs", get: (r: Row) => r.epgs },
  ];

  let metric = metricCandidates[0];
  for (const c of metricCandidates) {
    if (rows.some((r) => c.get(r) > 0)) {
      metric = c;
      break;
    }
  }

  const top = [...rows].sort((a, b) => metric.get(b) - metric.get(a)).slice(0, 5);
  const chartData = top.map((r) => ({ name: r.name, value: metric.get(r) }));

  const okTone = (v: any): HealthTone => (String(v ?? "").toLowerCase() === "ok" ? "good" : v ? "bad" : "neutral");
  const service = { value: safeText((rawHealth as any)?.Service), tone: okTone((rawHealth as any)?.Service) };
  const bus = { value: safeText((rawHealth as any)?.MessageBus), tone: okTone((rawHealth as any)?.MessageBus) };

  return { total, metricLabel: metric.label, chartData, top, service, bus };
}, [data.tenants, (data as any).tenantHealth]);


  // DEVICES widget model (reachable/unreachable)
  // -------------------------
  const devicesModel = useMemo(() => {
    const raw = unwrapPayload(data.devices);
    const counts =
      raw?.counts ??
      deepPick(raw, ["payload.counts", "payload.payload.counts", "payload.payload"]) ??
      {};
    const reachable = num(counts?.reachable) ?? num(counts?.up) ?? 0;
    const unreachable = num(counts?.unreachable) ?? num(counts?.down) ?? 0;
    const unknown = num(counts?.unknown) ?? 0;
    const bar = [
      { name: "reachable", value: reachable },
      { name: "unreachable", value: unreachable },
      { name: "unknown", value: unknown },
    ];
    return { bar, raw };
  }, [data.devices]);

  // -------------------------
  // SWITCH INVENTORY widget model (table)
  // -------------------------
  const switchesModel = useMemo(() => {
    // Base list: inventory_getswitches (has chassis_name + role)
    const rawSku = unwrapPayload((data as any).switchesTable);
    const skuItems =
      (Array.isArray(rawSku?.items) ? rawSku.items : null) ??
      (Array.isArray(rawSku?.payload?.items) ? rawSku.payload.items : null) ??
      [];

    // Enrichment list: inventory_get_switches_widget_table (has fabric + firmware, etc.)
    const rawWidget = unwrapPayload((data as any).switchesWidget);
    const widgetItems =
      (Array.isArray(rawWidget?.items) ? rawWidget.items : null) ??
      (Array.isArray(rawWidget?.payload?.items) ? rawWidget.payload.items : null) ??
      [];

    const widgetById = new Map<number, any>();
    const widgetByIp = new Map<string, any>();
    for (const w of widgetItems as any[]) {
      const id = typeof w?.id === "number" ? w.id : undefined;
      const ip = pickStr(w?.ip_address ?? w?.ip ?? w?.management_ip ?? w?.mgmt_ip ?? w?.address);
      if (typeof id === "number") widgetById.set(id, w);
      if (ip) widgetByIp.set(ip, w);
    }

    const count = num(rawSku?.summary?.count) ?? skuItems.length;

    const rows = (skuItems as any[]).slice(0, 10).map((it: any) => {
      const idNum = typeof it?.id === "number" ? it.id : undefined;
      const ip = pickStr(it?.ip ?? it?.ip_address ?? it?.management_ip ?? it?.mgmt_ip ?? it?.address) ?? "—";
      const w = (typeof idNum === "number" ? widgetById.get(idNum) : undefined) ?? (ip !== "—" ? widgetByIp.get(ip) : undefined);

      const name = pickStr(it?.name ?? it?.hostname ?? it?.device_name ?? w?.name) ?? "—";

      // For XCO Inventory "Model" (SKU), use chassis_name (not the numeric model code).
      const model = pickStr(it?.chassis_name ?? it?.chassisName ?? it?.["chassis-name"]) ?? "—";

      const type = pickStr(it?.device_type ?? it?.type ?? it?.platform_type ?? it?.deviceType ?? w?.device_type ?? w?.type) ?? "—";
      const role = pickStr(it?.role ?? it?.switch_role ?? it?.fabric_role ?? w?.role) ?? "—";

      const mac = pickStr(it?.mac ?? it?.mac_address ?? it?.device_mac ?? w?.mac_address ?? w?.mac ?? w?.device_mac) ?? "—";
      const firmware = pickStr(it?.firmware_version ?? it?.firmware ?? it?.os_version ?? w?.firmware ?? w?.firmware_version ?? w?.os_version) ?? "—";

      // Fabric is present in widget tool output; prefer that.
      const fabric = pickStr(w?.fabric ?? w?.fabric_name ?? w?.fabricName ?? it?.fabric ?? it?.fabric_name ?? it?.fabricName) ?? "—";

      return { ip, name, model, type, role, mac, firmware, fabric };
    });

    return { count, rows, raw: rawSku };
  }, [(data as any).switchesTable, (data as any).switchesWidget]);
// -------------------------
// SWITCH MODELS widget model (donut)
// -------------------------
const switchModelsModel = useMemo(() => {
  const raw = unwrapPayload((data as any).switchesTable);
  const items =
    (Array.isArray(raw?.items) ? raw.items : null) ??
    (Array.isArray(raw?.payload?.items) ? raw.payload.items : null) ??
    [];
  const sample = (items as any[]).slice(0, 200);

  const counts = new Map<string, number>();
  for (const it of sample) {
    const model = pickStr(it?.chassis_name ?? it?.chassisName ?? it?.["chassis-name"]) ?? "Unknown";
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }

  const sorted = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const TOP = 6;
  const top = sorted.slice(0, TOP);
  const other = sorted.slice(TOP).reduce((acc, r) => acc + r.value, 0);
  const pie = other > 0 ? [...top, { name: "Other", value: other }] : top;
  const total = pie.reduce((s, r) => s + r.value, 0);

  return { pie, total, raw };
}, [(data as any).switchesTable]);





  
  // -------------------------
  // RESTCONF widget model (top talkers)
  // -------------------------
  const restconfPortsModel = useMemo(() => {
    const raw = (data as any).restconfPortStats;
    const targets: string[] = Array.isArray(raw?.targets) ? raw.targets : [];
    const results: any[] = Array.isArray(raw?.results) ? raw.results : [];

    const entries: any[] = [];
    const perSwitch: any[] = [];

    const trafficFrom = (p: any): number => {
      const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : undefined);
      const a = n(p?.in_bytes) ?? n(p?.inBytes) ?? n(p?.rx_bytes) ?? n(p?.rxBytes) ?? n(p?.in_octets) ?? n(p?.inOctets) ?? n(p?.rx_octets) ?? n(p?.rxOctets);
      const b = n(p?.out_bytes) ?? n(p?.outBytes) ?? n(p?.tx_bytes) ?? n(p?.txBytes) ?? n(p?.out_octets) ?? n(p?.outOctets) ?? n(p?.tx_octets) ?? n(p?.txOctets);
      if (typeof a === "number" && typeof b === "number") return a + b;

      const direct =
        n(p?.total_bytes) ??
        n(p?.totalBytes) ??
        n(p?.bytes) ??
        n(p?.octets) ??
        n(p?.total_octets) ??
        n(p?.totalOctets) ??
        n(p?.if_octets) ??
        n(p?.ifOctets);
      if (typeof direct === "number") return direct;

      const pa = n(p?.in_packets) ?? n(p?.rx_packets) ?? n(p?.rxPackets);
      const pb = n(p?.out_packets) ?? n(p?.tx_packets) ?? n(p?.txPackets);
      if (typeof pa === "number" && typeof pb === "number") return pa + pb;
      const pd = n(p?.packets) ?? n(p?.total_packets) ?? n(p?.totalPackets);
      return typeof pd === "number" ? pd : 0;
    };

    const errorsFrom = (p: any): number => {
      const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : 0);
      // Keep "Errors" focused on error counters (exclude discards + CRC which we show separately)
      return (
        n(p?.errors) +
        n(p?.total_errors) +
        n(p?.totalErrors) +
        n(p?.in_errors) +
        n(p?.out_errors) +
        n(p?.rx_errors) +
        n(p?.tx_errors) +
        n(p?.inErrors) +
        n(p?.outErrors) +
        n(p?.rxErrors) +
        n(p?.txErrors)
      );
    };

    const discardsFrom = (p: any): number => {
      const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : 0);
      return (
        n(p?.discards) +
        n(p?.discard) +
        n(p?.drops) +
        n(p?.drop) +
        n(p?.in_discards) +
        n(p?.out_discards) +
        n(p?.in_drops) +
        n(p?.out_drops) +
        n(p?.rx_discards) +
        n(p?.tx_discards) +
        n(p?.rxDiscards) +
        n(p?.txDiscards)
      );
    };

    const crcFrom = (p: any): number => {
      const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : 0);
      return (
        n(p?.crc_errors) +
        n(p?.crcErrors) +
        n(p?.crc) +
        n(p?.crc_error) +
        n(p?.crcError)
      );
    };

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const ip = pickStr(r?.switch_ip) ?? targets[i] ?? "—";

      if (r?.__error) {
        perSwitch.push({ ip, ok: false, error: String(r.__error) });
        continue;
      }

      const payload = unwrapPayload(r);
      const top =
        (Array.isArray(payload?.summary?.top) ? payload.summary.top : null) ??
        (Array.isArray(payload?.top) ? payload.top : null) ??
        (Array.isArray(payload?.items) ? payload.items : null) ??
        [];

      let totalTraffic = 0;
      let totalErrors = 0;

      for (const p of top as any[]) {
        const iface = pickStr(p?.port ?? p?.interface ?? p?.if_name ?? p?.ifName ?? p?.name ?? p?.id) ?? "—";
        const traffic = trafficFrom(p);
        const errs = errorsFrom(p);
        const discards = discardsFrom(p);
        const crc = crcFrom(p);
        totalTraffic += traffic;
        totalErrors += errs;
        entries.push({ ip, iface, traffic, errors: errs, discards, crc, raw: p });
      }

      perSwitch.push({ ip, ok: true, ports: (top as any[]).length, traffic: totalTraffic, errors: totalErrors, raw: payload });
    }

    const topPorts = entries
      .slice()
      .sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))
      .slice(0, 5);

    const okCount = perSwitch.filter((s) => s.ok).length;
    const errCount = perSwitch.filter((s) => !s.ok).length;

    return {
      targets,
      okCount,
      errCount,
      perSwitch,
      topPorts,
      note: pickStr(raw?.__note),
      error: pickStr(raw?.__error),
      raw,
    };
  }, [(data as any).restconfPortStats]);
const restconfLldpModel = useMemo(() => {
  const raw = (data as any).restconfLldp;
  if (!raw) return { rows: [], count: 0, error: "", note: "" };

  const toolErr = pickStr(raw?.__error) ?? "";
  const payload = unwrapPayload(raw);

  const ok = (payload as any)?.meta?.ok;
  const warnings = Array.isArray((payload as any)?.warnings) ? (payload as any).warnings : [];
  const note = warnings.length ? warnings.join(" • ") : "";

  const items = Array.isArray((payload as any)?.items) ? (payload as any).items : [];
  const count =
    num((payload as any)?.summary?.neighbors) ??
    num((payload as any)?.summary?.neighbor_count) ??
    items.length;

  const rows = items.map((it: any) => {
    return {
      localPort: pickStr(it?.local_interface ?? it?.localPort ?? it?.local_port ?? it?.local) ?? "—",
      remotePortId: pickStr(it?.remote_port_id ?? it?.remotePortId ?? it?.remote_port ?? it?.remotePort ?? it?.remote_portid) ?? "—",
      remotePortDescr: pickStr(it?.remote_port_description ?? it?.remotePortDescription ?? it?.remote_port_descr ?? it?.remotePortDescr ?? it?.remote_port_desc) ?? "—",
      chassisId: pickStr(it?.remote_chassis_id ?? it?.remoteChassisId ?? it?.chassis_id ?? it?.chassisId) ?? "—",
      systemName: pickStr(it?.remote_system_name ?? it?.remoteSystemName ?? it?.system_name ?? it?.systemName ?? it?.remote) ?? "—",
      remoteSystemDescr: pickStr(it?.remote_system_description ?? it?.remoteSystemDescription ?? it?.system_description ?? it?.systemDescription) ?? "—",
      capabilities: Array.isArray(it?.remote_capabilities ?? it?.capabilities) ? (it?.remote_capabilities ?? it?.capabilities) : [],
      remoteMgmt: it?.remote_management ?? it?.remoteManagement ?? it?.management ?? null,
    };
  });

  // Sort like CLI (by local port numeric where possible)
  const portKey = (s: string) => {
    const m = String(s).match(/(\d+)\/(\d+)/);
    if (!m) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    return [Number(m[1]), Number(m[2])];
  };
  rows.sort((a: any, b: any) => {
    const [a1, a2] = portKey(a.localPort);
    const [b1, b2] = portKey(b.localPort);
    if (a1 !== b1) return a1 - b1;
    if (a2 !== b2) return a2 - b2;
    return String(a.localPort).localeCompare(String(b.localPort));
  });

  const error =
    toolErr ||
    (ok === false ? "RESTCONF returned ok=false" : "") ||
    "";

  return { rows, count, error, note };
}, [(data as any).restconfLldp]);


  // Default selection: first switch we queried
  useEffect(() => {
    if (!restconfSelectedIp && restconfPortsModel.targets.length) {
      setRestconfSelectedIp(restconfPortsModel.targets[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restconfPortsModel.targets.join("|")]);

// Fetch LLDP neighbors for the selected RESTCONF switch (best-effort; never breaks dashboard)
useEffect(() => {
  if (!restconfSelectedIp) return;
  let cancelled = false;
  setRestconfLldpLoading(true);
  setRestconfLldpErr("");

  invoke("restconf_get_lldp_neighbor_detail", { switch_ip: restconfSelectedIp })
    .then((r) => {
      if (cancelled) return;
      setData((prev) => ({ ...prev, restconfLldp: r }));
    })
    .catch((e: any) => {
      if (cancelled) return;
      const msg = String(e?.message ?? e);
      setRestconfLldpErr(msg);
      setData((prev) => ({ ...prev, restconfLldp: { __error: msg, switch_ip: restconfSelectedIp } }));
    })
    .finally(() => {
      if (cancelled) return;
      setRestconfLldpLoading(false);
    });

  return () => {
    cancelled = true;
  };
  // We intentionally re-fetch on switch selection change.
}, [restconfSelectedIp]);

// -------------------------
  // ALARMS widget model (severity buckets)
  // -------------------------
  const alarmsModel = useMemo(() => {
    const raw = unwrapPayload(data.alarms);
    const buckets = emptyAlarmBuckets();

    // Common shapes:
    // - {Alarms: {Critical: 1, Major:2 ...}} (faultmanager_get_alarm_summary probe)
    // - list of alarm objects with severity fields
    const summary = raw?.Alarms ?? raw?.alarms ?? raw?.summary ?? raw;

    if (isObj(summary)) {
      for (const [k, v] of Object.entries(summary)) {
        const bk = normalizeBucketKey(k);
        const n = num(v);
        if (bk && n !== null) buckets[bk] += n;
      }
    } else if (Array.isArray(summary)) {
      for (const a of summary) {
        const sev = normalizeBucketKey(String(a?.severity ?? a?.severity_text ?? a?.Severity ?? "info"));
        if (sev) buckets[sev] += 1;
      }
    }

    const bar = (Object.keys(buckets) as AlarmKey[]).map((k) => ({ name: k, value: buckets[k] }));
    const total = bar.reduce((s, r) => s + r.value, 0);
    return { bar, total, raw };
  }, [data.alarms]);

  // -------------------------
// DEVICE HEALTH model (best-effort summary chart)
// -------------------------
const deviceHealthModel = useMemo(() => {
  const raw = unwrapPayload(data.deviceHealth) ?? {};

  const summary = raw?.summary ?? {};
  const counts = summary?.unhealthy_counts_global ?? { red: 0, yellow: 0, green: 0, unknown: 0 };

  const toNum = (v: any) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

  const red = toNum(counts.red);
  const yellow = toNum(counts.yellow);
  const green = toNum(counts.green);
  const unknown = toNum(counts.unknown);

  const total = toNum(summary?.devices_scanned ?? (red + yellow + green + unknown));

  const pie = [
    { name: "Red", value: red, tone: "bad" as HealthTone },
    { name: "Yellow", value: yellow, tone: "warn" as HealthTone },
    { name: "Green", value: green, tone: "good" as HealthTone },
    { name: "Unknown", value: unknown, tone: "neutral" as HealthTone },
  ].filter((p) => p.value > 0);

  const groups = Array.isArray(raw?.groups) ? raw.groups : [];

  const flatDrivers: any[] = [];
  for (const g of groups) {
    const fabricName = g?.fabric?.name ?? g?.fabric ?? "—";
    const drivers = Array.isArray(g?.drivers) ? g.drivers : [];
    for (const d of drivers) flatDrivers.push({ ...d, fabric: fabricName });
  }

  const sevRank = (s: any) => {
    const v = String(s ?? "").toLowerCase();
    if (v === "red" || v === "critical") return 0;
    if (v === "yellow" || v === "warn" || v === "warning" || v === "major") return 1;
    if (v === "green" || v === "ok" || v === "healthy") return 2;
    return 3;
  };

  const driversTop = flatDrivers
    .slice()
    .sort((a, b) => sevRank(a?.severity) - sevRank(b?.severity))
    .slice(0, 8);

  const headline = raw?.headline ?? null;

  const byFabric = groups.map((g: any) => ({
    fabric: g?.fabric?.name ?? "—",
    fabricHealth: String(g?.fabric?.health ?? "").toUpperCase(),
    devices_total: toNum(g?.devices_total),
    red: toNum(g?.health_counts?.red),
    yellow: toNum(g?.health_counts?.yellow),
    green: toNum(g?.health_counts?.green),
    unknown: toNum(g?.health_counts?.unknown),
  }));

  // pick a dashboard tone for the overall widget
  const overallTone: HealthTone = red > 0 ? "bad" : yellow > 0 ? "warn" : green > 0 ? "good" : "neutral";

  return { raw, headline, total, pie, counts: { red, yellow, green, unknown }, byFabric, driversTop, overallTone };
}, [data.deviceHealth]);


  // -------------------------
  // Layout
  // -------------------------
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xl" style={{ fontWeight: 800 }}>
            Dashboard
          </div>
          <div className="text-sm opacity-80">
            Live widgets powered by MCP tools. Last updated: {lastUpdated || "—"}
          </div>
        </div>
        <button
          className="rounded-md px-3 py-2 text-sm"
          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err ? (
        <div className="rounded-lg p-4 mb-4" style={{ ...panelStyle(), borderColor: "rgba(255,80,80,0.45)" }}>
          <div className="text-sm" style={{ fontWeight: 700 }}>
            Error
          </div>
          <div className="text-sm opacity-80 mt-1">{err}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-12 gap-6">
        {/* Top row */}
        <div className="col-span-12 lg:col-span-3">
          <Panel
  title="System"
  subtitle={
    systemModel.overall.tone === "good"
      ? "System is healthy"
      : systemModel.overall.tone === "warn"
      ? "System needs attention"
      : systemModel.overall.tone === "bad"
      ? "System is unhealthy"
      : "System status"
  }
  right={
    <button
      className="btn btn-secondary"
      onClick={() => onOpenInConsole("system_get_ha_and_node_health_summary", {})}
    >
      Open in Console
    </button>
  }
>
  <div className="flex items-center gap-2 text-sm">
    {toneDot(systemModel.overall.tone)}{" "}
    <span className="font-medium">System is {systemModel.overall.label}</span>
  </div>

  <div className="mt-4">
    {systemModel.details.length ? (
      <div className="grid grid-cols-2 gap-2">
        {systemModel.details.slice(0, 2).map((d) => (
          <MiniStat key={d.label} label={d.label} value={d.value} tone={d.tone} />
        ))}
      </div>
    ) : (
      <div className="text-sm text-muted">No additional system details detected.</div>
    )}
  </div>
</Panel>
        </div>
<div className="col-span-12 lg:col-span-3">
  <Panel
    title="Switch models"
    subtitle={switchModelsModel.total ? `${switchModelsModel.total} switches (by model)` : "—"}
    right={
      <button
        className="rounded-md px-3 py-2 text-sm"
        style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
        onClick={() => onOpenInConsole("inventory_getswitches", {})}
      >
        Open in Console
      </button>
    }
  >
    {switchModelsModel.total ? (
      <div className="grid grid-cols-12 gap-4 items-center">
        <div className="col-span-6">
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={switchModelsModel.pie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {switchModelsModel.pie.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip cursor={{ fill: "transparent" }} content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="col-span-6">
          <div className="text-sm opacity-80 mb-2">Breakdown</div>
          <div className="space-y-2">
            {switchModelsModel.pie.map((r) => (
              <div key={r.name} className="flex items-center justify-between text-sm">
                <div style={{ fontWeight: 700 }}>{r.name}</div>
                <div className="opacity-80">{r.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ) : (
      <div className="text-sm opacity-80">No switch inventory data detected.</div>
    )}
  </Panel>
</div>



        <div className="col-span-12 lg:col-span-3">
          <Panel
            title="Fabrics"
            subtitle={fabricsModel.total ? `${fabricsModel.total} total` : "—"}
            right={
              <button
                className="rounded-md px-3 py-2 text-sm"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
                onClick={() => onOpenInConsole("fabric_get_fabrics_health", {})}
              >
                Open in Console
              </button>
            }
          >
            {fabricsModel.total ? (
              <div className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-6">
                  <div style={{ width: "100%", height: 180 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={fabricsModel.pie}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {fabricsModel.pie.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip cursor={{ fill: "transparent" }} content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="col-span-6">
                  <div className="text-sm opacity-80 mb-2">Breakdown</div>
                  <div className="space-y-2">
                    {fabricsModel.pie.map((r) => (
                      <div key={r.name} className="flex items-center justify-between text-sm">
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        <div className="opacity-80">{r.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm opacity-80">No fabric health data detected.</div>
            )}
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-3">
          <Panel
            title="Tenants"
            subtitle={tenantsModel.total ? `${tenantsModel.total} total` : "—"}
            right={
              <button
                className="rounded-md px-3 py-2 text-sm"
                style={{ background: "var(--bg0)", border: "1px solid var(--border)" }}
                onClick={() => onOpenInConsole("tenant_get_tenants", {})}
              >
                Open in Console
              </button>
            }
          >
            {tenantsModel.total ? (
              <div className="mt-2 grid grid-cols-12 gap-4 items-start">
                <div className="col-span-12 lg:col-span-7">
                  <div className="text-xs opacity-70 mb-2">
                    Top tenants by <span style={{ fontWeight: 700 }}>{tenantsModel.metricLabel}</span>
                  </div>
                  <div style={{ height: 170 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tenantsModel.chartData}>
                        <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.75)", fontSize: 11 }} />
                        <YAxis tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} />
                        <Tooltip cursor={{ fill: "transparent" }}
                          contentStyle={{
                            background: "rgba(15,16,20,0.95)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 10,
                          }}
                        />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="var(--accent)" fillOpacity={0.85} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-5 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat label="Service" value={tenantsModel.service.value || "—"} tone={tenantsModel.service.tone} />
                    <MiniStat label="MsgBus" value={tenantsModel.bus.value || "—"} tone={tenantsModel.bus.tone} />
                  </div>

                  <div className="rounded-md px-3 py-2" style={{ background: "var(--bg0)", border: "1px solid var(--border)" }}>
                    <div className="text-xs opacity-80 mb-1">Top tenants</div>
                    <div className="space-y-1">
                      {tenantsModel.top.map((r: any) => {
                        const metricVal =
                          tenantsModel.metricLabel === "Ports"
                            ? r.ports
                            : tenantsModel.metricLabel === "L2 VNIs"
                            ? r.l2
                            : tenantsModel.metricLabel === "L3 VNIs"
                            ? r.l3
                            : r.epgs;
                        return (
                          <div key={r.name} className="flex items-center justify-between text-sm">
                            <span className="truncate" style={{ maxWidth: 160 }}>
                              {r.name}
                            </span>
                            <span className="opacity-80">{metricVal}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm opacity-80">No tenants detected.</div>
            )}
          </Panel>
        </div>

        {/* Middle row */}
        <div className="col-span-12 lg:col-span-7">
          <Panel
            title="Devices"
            subtitle="Reachable vs unreachable"
            right={
              <button
                className="rounded-md px-3 py-2 text-sm"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
                onClick={() => onOpenInConsole("inventory_get_unreachable_devices", {})}
              >
                Open in Console
              </button>
            }
          >
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={devicesModel.bar}>
                  <XAxis dataKey="name" tick={{ fill: "var(--text)" }} />
                  <YAxis tick={{ fill: "var(--text)" }} />
                  <Tooltip cursor={{ fill: "transparent" }} content={<ChartTooltip />} />
                  <Bar dataKey="value" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-5">
          <Panel
            title="Alarms"
            subtitle={alarmsModel.total ? `Total: ${alarmsModel.total}` : "By severity"}
            right={
              <button
                className="rounded-md px-3 py-2 text-sm"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
                onClick={() => onOpenInConsole("faultmanager_get_alarm_summary", {})}
              >
                Open in Console
              </button>
            }
          >
            {alarmsModel.total ? (
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={alarmsModel.bar}>
                    <XAxis dataKey="name" tick={{ fill: "var(--text)" }} />
                    <YAxis tick={{ fill: "var(--text)" }} />
                    <Tooltip cursor={{ fill: "transparent" }} content={<ChartTooltip />} />
                    <Bar dataKey="value" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm opacity-80">
                No alarm buckets detected from this endpoint. Try opening in Console for raw details.
              </div>
            )}
          </Panel>
        </div>

        
        {/* Bottom row */}


        <div className="col-span-12">
          <Panel
            title="Switch inventory"
            subtitle={switchesModel.count ? `${switchesModel.count} switches (showing first 10)` : "—"}
            right={
              <button
                className="rounded-md px-3 py-2 text-sm"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
                onClick={() => onOpenInConsole("inventory_getswitches", {})}
              >
                Open in Console
              </button>
            }
          >
            {switchesModel.rows.length ? (
              <div className="overflow-auto rounded-md" style={{ border: "1px solid var(--border)" }}>
                <table className="min-w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: "var(--bg0)" }}>
                      {[
                        "IP Address",
                        "Name",
                        "Model",
                        "Type",
                        "Role",
                        "MAC Address",
                        "Firmware Version",
                        "Fabric",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 whitespace-nowrap"
                          style={{ fontWeight: 700, borderBottom: "1px solid var(--border)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {switchesModel.rows.map((r, idx) => (
                      <tr
                        key={`${r.ip}-${idx}`}
                        style={{
                          background: idx % 2 ? "rgba(255,255,255,0.015)" : "transparent",
                        }}
                      >
                        <td className="px-3 py-2 whitespace-nowrap" style={{ fontWeight: 700 }}>
                          {r.ip}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.name}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.model}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.type}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.role}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.mac}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.firmware}</td>
<td className="px-3 py-2 whitespace-nowrap">{r.fabric}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm opacity-80">
                No switches returned from <span style={{ fontWeight: 700 }}>inventory_getswitches</span>.
              </div>
            )}
          </Panel>
        </div>

        <div className="col-span-12">
          <Panel
  title="Device health"
  subtitle="Health rollup (auto)"
  right={
    <button
      className="btn btn-secondary"
      onClick={() => onOpenInConsole("inventory_get_device_health_rollup", {})}
    >
      Open in Console
    </button>
  }
>
  {deviceHealthModel.total ? (
    <div className="grid grid-cols-12 gap-4 items-start">
      <div className="col-span-12 lg:col-span-5">
        {deviceHealthModel.headline ? (
          <div className="text-sm opacity-80 mb-2">{deviceHealthModel.headline}</div>
        ) : null}

        <div style={{ width: "100%", height: 190 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={
                  deviceHealthModel.pie.length
                    ? deviceHealthModel.pie
                    : [{ name: "No data", value: 1, tone: "neutral" as any }]
                }
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={2}
              >
                {(deviceHealthModel.pie.length ? deviceHealthModel.pie : [{ tone: "neutral" }]).map(
                  (p: any, idx: number) => {
                    const t = p?.tone as HealthTone;
                    const fill =
                      t === "bad"
                        ? "rgba(255, 80, 80, 0.95)"
                        : t === "warn"
                        ? "rgba(255, 200, 0, 0.95)"
                        : t === "good"
                        ? "rgba(60, 220, 120, 0.95)"
                        : "rgba(137,129,229,0.35)";
                    return <Cell key={idx} fill={fill} />;
                  }
                )}
              </Pie>
              <Tooltip cursor={{ fill: "transparent" }} content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <MiniStat label="Devices" value={String(deviceHealthModel.total)} tone={deviceHealthModel.overallTone} />
          <MiniStat label="Red" value={String(deviceHealthModel.counts.red)} tone="bad" />
          <MiniStat label="Yellow" value={String(deviceHealthModel.counts.yellow)} tone="warn" />
          <MiniStat label="Green" value={String(deviceHealthModel.counts.green)} tone="good" />
        </div>
      </div>

      <div className="col-span-12 lg:col-span-7">
        {deviceHealthModel.byFabric.length ? (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "rgba(255,255,255,0.03)" }}>
                <tr className="text-left">
                  <th className="p-3" style={{ fontWeight: 700 }}>
                    fabric
                  </th>
                  <th className="p-3" style={{ fontWeight: 700 }}>
                    health
                  </th>
                  <th className="p-3" style={{ fontWeight: 700 }}>
                    devices
                  </th>
                  <th className="p-3" style={{ fontWeight: 700 }}>
                    red
                  </th>
                  <th className="p-3" style={{ fontWeight: 700 }}>
                    yellow
                  </th>
                  <th className="p-3" style={{ fontWeight: 700 }}>
                    green
                  </th>
                </tr>
              </thead>
              <tbody>
                {deviceHealthModel.byFabric.map((r: any, idx: number) => (
                  <tr key={idx} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="p-3">{r.fabric}</td>
                    <td className="p-3">{r.fabricHealth || "—"}</td>
                    <td className="p-3">{r.devices_total}</td>
                    <td className="p-3">{r.red}</td>
                    <td className="p-3">{r.yellow}</td>
                    <td className="p-3">{r.green}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted">No per-fabric breakdown found.</div>
        )}

        {deviceHealthModel.driversTop.length ? (
          <div className="mt-4">
            <div className="text-sm opacity-80 mb-2">Top drivers (worst first)</div>
            <div className="space-y-2">
              {deviceHealthModel.driversTop.map((d: any, idx: number) => {
                const s = String(d?.severity ?? "").toLowerCase();
                const tone: HealthTone = s === "red" ? "bad" : s === "yellow" ? "warn" : s === "green" ? "good" : "neutral";
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg px-3 py-2"
                    style={{ border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}
                  >
                    <div className="flex items-center gap-2">
                      {toneDot(tone)}
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {d?.hostname || d?.id || "device"}{" "}
                          <span className="opacity-70" style={{ fontWeight: 600 }}>
                            {d?.ip ? `(${d.ip})` : ""}
                          </span>
                        </div>
                        <div className="text-xs opacity-70">
                          {d?.fabric ? `Fabric: ${d.fabric}` : ""} {d?.role ? `• ${d.role}` : ""}{" "}
                          {d?.model ? `• ${d.model}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div style={{ fontWeight: 800 }}>{String(d?.severity ?? "—").toUpperCase()}</div>
                      <div className="text-xs opacity-70">{d?.reason ? d.reason : "—"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-muted">No drivers returned (everything might be healthy, or filtering is excluding them).</div>
        )}
      </div>
    </div>
  ) : (
    <div className="text-sm text-muted">No device health data yet. Try Refresh.</div>
  )}
</Panel>
        </div>

        {/* RESTCONF (direct from devices via RESTCONF) */}
<div className="col-span-12">
          <Panel
            title="RESTCONF: Top port talkers"
            subtitle={
              restconfPortsModel.targets.length
                ? `Live interface counters via RESTCONF (querying ${restconfPortsModel.targets.length} switches)`
                : "Live interface counters via RESTCONF"
            }
            right={
              <div className="flex items-center gap-2">
                {restconfPortsModel.targets.length ? (
                  <select
                    className="rounded-md px-2 py-2 text-sm"
                    style={{ background: "var(--bg0)", border: "1px solid var(--border)", color: "var(--text)" }}
                    value={restconfSelectedIp}
                    onChange={(e) => setRestconfSelectedIp(e.target.value)}
                  >
                    {restconfPortsModel.targets.map((ip) => (
                      <option key={ip} value={ip}>
                        {ip}
                      </option>
                    ))}
                  </select>
                ) : null}

                <button
                  className="rounded-md px-3 py-2 text-sm"
                  style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
                  onClick={() =>
                    onOpenInConsole(
                      "restconf_get_port_statistics_summary",
                      restconfSelectedIp ? { switch_ip: restconfSelectedIp, max_ports: 64, top_n: 5 } : {}
                    )
                  }
                >
                  Open in Console
                </button>
              </div>
            }
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-1 rounded-md text-xs"
                  style={{ border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)" }}
                >
                  Source: RESTCONF (direct from device)
                </span>
                <span className="opacity-70">
                  {restconfPortsModel.okCount
                    ? `${restconfPortsModel.okCount} ok`
                    : ""}{restconfPortsModel.errCount ? ` • ${restconfPortsModel.errCount} failed` : ""}
                </span>
              </div>
              {restconfPortsModel.note ? <div className="opacity-70">{restconfPortsModel.note}</div> : null}
            </div>

            {restconfPortsModel.error ? (
              <div className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
                {restconfPortsModel.error}
              </div>
            ) : null}

            {restconfPortsModel.errCount ? (
              <div className="mt-3 text-sm opacity-80">
                {restconfPortsModel.perSwitch
                  .filter((s: any) => !s.ok)
                  .slice(0, 2)
                  .map((s: any, idx: number) => (
                    <div key={idx}>
                      {s.ip}: {s.error}
                    </div>
                  ))}
              </div>
            ) : null}

            {restconfPortsModel.topPorts.length ? (
              <div className="mt-3 overflow-auto rounded-md" style={{ border: "1px solid var(--border)" }}>
                <table className="min-w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: "var(--bg0)" }}>
                      {["#", "Switch", "Interface", "Traffic", "Errors", "Discards", "CRC"].map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 whitespace-nowrap"
                          style={{ fontWeight: 700, borderBottom: "1px solid var(--border)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {restconfPortsModel.topPorts.map((r: any, idx: number) => (
                      <tr
                        key={`${r.ip}-${r.iface}-${idx}`}
                        style={{
                          background: idx % 2 ? "rgba(255,255,255,0.015)" : "transparent",
                        }}
                      >
                        <td className="px-3 py-2 whitespace-nowrap" style={{ fontWeight: 800 }}>
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ fontWeight: 700 }}>
                          {r.ip}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.iface}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtCompact(r.traffic)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtCompact(r.errors)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtCompact(r.discards)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtCompact(r.crc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 text-sm text-muted">
                No RESTCONF port statistics yet (or counters are missing). Try Open in Console for raw output.
              </div>
            )}
          </Panel>
        </div>



<div className="col-span-12">
  <Panel
    title="RESTCONF: LLDP neighbor explorer"
    subtitle={
      restconfSelectedIp
        ? `Live LLDP neighbors via RESTCONF (switch ${restconfSelectedIp})`
        : "Live LLDP neighbors via RESTCONF"
    }
    right={
      <div className="flex items-center gap-2">
        <button
          className="rounded-md px-3 py-2 text-sm"
          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
          onClick={() =>
            onOpenInConsole(
              "restconf_get_lldp_neighbor_detail",
              restconfSelectedIp ? { switch_ip: restconfSelectedIp } : {}
            )
          }
        >
          Open in Console
        </button>
      </div>
    }
  >
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="px-2 py-1 rounded-md text-xs"
          style={{ border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)" }}
        >
          Source: RESTCONF (direct from device)
        </span>
        <span className="opacity-70">{restconfLldpLoading ? "Loading…" : `${restconfLldpModel.count} neighbors`}</span>
      </div>
      {restconfLldpErr ? <div style={{ color: "var(--warn)" }}>{restconfLldpErr}</div> : null}
      {!restconfLldpErr && restconfLldpModel.error ? (
        <div style={{ color: "var(--warn)" }}>{restconfLldpModel.error}</div>
      ) : null}
      {!restconfLldpErr && !restconfLldpModel.error && restconfLldpModel.note ? (
        <div className="opacity-70">{restconfLldpModel.note}</div>
      ) : null}
    </div>

    {(
  <>
    <div className="mt-3 overflow-auto rounded-md" style={{ border: "1px solid var(--border)" }}>
      <table className="min-w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr style={{ background: "var(--bg0)" }}>
            {["Local Port","Remote Port ID","Remote Port Descr","Chassis ID","System Name","Remote System Descr"].map((h) => (
              <th
                key={h}
                className="text-left px-3 py-2 whitespace-nowrap"
                style={{ fontWeight: 700, borderBottom: "1px solid var(--border)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {restconfLldpModel.rows.length ? (
            restconfLldpModel.rows.slice(0, 50).map((r: any, idx: number) => (
              <tr
                key={`${r.localPort}-${idx}`}
                style={{ background: idx % 2 ? "rgba(255,255,255,0.015)" : "transparent" }}
              >
                <td className="px-3 py-2 whitespace-nowrap" style={{ fontWeight: 700 }}>
                  {r.localPort}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{r.remotePortId ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.remotePortDescr ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.chassisId ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ fontWeight: 700 }}>
                  {r.systemName ?? "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{r.remoteSystemDescr ?? "—"}</td>
</tr>
            ))
          ) : (
            <tr>
              <td className="px-3 py-3 text-sm opacity-70" colSpan={6}>
                {restconfLldpLoading ? "Loading LLDP neighbors…" : "No LLDP neighbors found (or not supported)."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>

    <div className="mt-2 text-xs opacity-70">
      Total no. of Records: {restconfLldpModel.count}
    </div>
  </>
)}
  </Panel>
</div>


      </div>
    </div>
  );
}

