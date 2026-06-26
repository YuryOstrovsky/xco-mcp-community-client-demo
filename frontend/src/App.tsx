import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  getJSON, postJSON, patchJSON, streamSSE,
} from "./lib/api";
// Typed /api/invoke wrapper — opt-in alternative to postJSON where the tool
// name is a compile-time literal. See lib/typedInvoke.ts.
import { invokeToolTyped } from "./lib/typedInvoke";
// NL intent detectors — pure regex classifiers. Each runs BEFORE we
// ship the prompt to /api/nl so common operator phrasings open the right
// widget deterministically. Mirrored on the backend in
// nl/deterministic.py: NL routing has TWO layers.
import {
  detectLldpIntent,
  detectSwVersionIntent,
  detectDirectToolCall,
  detectFabricTopologyIntent,
  detectFleetInventoryIntent,
  detectFleetMediaInventoryIntent,
  detectSerialSearchIntent,
  _extractScope,
} from "./lib/nl/detectors";
// Compass NL parser — "where is X" / "compass" / "what's on port X" /
// "show MACs in VLAN N". Returns instructions for App.tsx; App.tsx
// applies them via state setters.
import { parseCompassPrompt } from "./lib/nl/compass";
// NL textarea + LLM-tier selector + OpenAI key config (localStorage-
// backed). See lib/useNlSettings.ts.
import { useNlSettings } from "./lib/useNlSettings";
// All Switch Clocks + NTP Sync modal state. The handlers
// (handleOpenAllClocks + handleSubmitNtpSync) stay in App.tsx because
// they close over App-scope helpers.
import { useAllClocks } from "./lib/useAllClocks";
// Interface Dashboard + Detail widget state (open flags + filter + sort
// + detail tab).
import { useIfaceWidgets } from "./lib/useIfaceWidgets";
// Agent-skill metadata: useAgentSkillsRegistry does a one-shot
// /api/agent/skills fetch (drives the keyword-tier suggestion chip).
import { useAgentSkillsRegistry } from "./lib/useAgentSkillsRegistry";
import DashboardView from "./DashboardView";
import {
  widgetContainer,
} from "./lib/figmaStyles";
import { AiInvestigationSkillsDropdown } from "./features/agent/AiInvestigationSkillsDropdown";
import { InvestigateModal } from "./features/agent/InvestigateModal";
import { SkillPromptModal } from "./features/agent/SkillPromptModal";
import { CopyButton } from "./components/CopyButton";
import { ClockWidget } from "./components/ClockWidget";
import { FirmwareVersionWidget } from "./components/FirmwareVersionWidget";
import { VrfSummaryWidget } from "./components/VrfSummaryWidget";
import { MaintRateWidget } from "./components/MaintRateWidget";
import { LldpNeighWidget } from "./components/LldpNeighWidget";
import { ArpTableWidget } from "./components/ArpTableWidget";
import { IpIfaceWidget } from "./components/IpIfaceWidget";
import { PortStatsWidget } from "./components/PortStatsWidget";
import { MediaWidget } from "./components/MediaWidget";
import { FleetInventoryWidget } from "./components/FleetInventoryWidget";
import { FleetMediaInventoryWidget } from "./components/FleetMediaInventoryWidget";
import { IpMacSearchWidget } from "./components/IpMacSearchWidget";
import { useFleetInventory } from "./lib/useFleetInventory";
import { useFleetMediaInventory } from "./lib/useFleetMediaInventory";
import { VlanBriefWidget } from "./components/VlanBriefWidget";
import { TenantHistoryReportWidget } from "./components/TenantHistoryReportWidget";
import { Panel } from "./components/Panel";
import { Card } from "./components/Card";
import { SwitchPickerModal } from "./components/SwitchPickerModal";
import { AdminSidebar } from "./components/AdminSidebar";
import { SkillSuggestionChip } from "./components/SkillSuggestionChip";
import { DeviceHealthViz } from "./features/viz/DeviceHealthViz";
import { HaHealthViz } from "./features/viz/HaHealthViz";
import { NotifEventsViz } from "./features/viz/NotifEventsViz";
import { NotifDeliveryViz } from "./features/viz/NotifDeliveryViz";
import { ExecDiagnosticViz } from "./features/viz/ExecDiagnosticViz";
import { DonutChartViz, BarChartViz, StackedBarViz } from "./features/viz/BasicCharts";
import { unwrapWidgetPayload, unwrapWidgetPayloadDouble } from "./lib/widgetResp";
import { SimpleToolResultWidgetMount } from "./lib/SimpleToolResultWidgetMount";
import { ToolResultMounts } from "./lib/ToolResultMounts";
import { substituteSwitchNames, unresolvedSwitchRef } from "./lib/nl/switchNameToIp";
import { useElapsedMsWhile } from "./lib/useElapsedMsWhile";
import { renderMarkdown } from "./lib/renderMarkdown";
import { RunningConfigWidget } from "./features/widgets/RunningConfigWidget";
import { AllClocksModal } from "./features/widgets/AllClocksModal";
import { IfaceWidget } from "./features/widgets/IfaceWidget";
import { IfaceDetailWidget } from "./features/widgets/IfaceDetailWidget";
import { FabricTopologyView } from "./features/fabric/FabricTopologyView";
import { HelpWidget } from "./features/help/HelpWidget";
import { ActivityLogPanel } from "./features/admin/ActivityLogPanel";
import { ServerSettingsPanel } from "./features/admin/ServerSettingsPanel";
import { McpServerSection } from "./features/admin/McpServerSection";
import { OllamaSection } from "./features/admin/OllamaSection";
import { OpenAiKeySection } from "./features/admin/OpenAiKeySection";
// recharts is used only by the features/viz/* components.
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from "reactflow";
import "reactflow/dist/style.css";

type NLResp = {
  picked: { tool: string; inputs: Record<string, any> };
  summary: any;
  raw: any;
  assistant_text?: string | null;
  explain?: any;
  error?: any;
};

// ToolDef — shared type, see lib/coreTypes.ts.
import type { ToolDef } from "./lib/coreTypes";
// ToolsView is lazy-loaded — it's only mounted when the operator clicks
// into its tab. Lazy loading shrinks the initial app chunk significantly.
// The Suspense fallback renders a brief skeleton.
const ToolsView = lazy(() =>
  import("./features/tools/ToolsView").then((m) => ({ default: m.ToolsView }))
);

/** Normalise an inventory_getswitches-style item's fabric field into a
 *  displayable string. Returns "—" for any "no fabric" representation
 *  (empty object, missing field, the literal serialised strings "{}"
 *  or "[object Object]" that some upstream tools emit for empty fabric).
 *  Handles three real shapes returned across MCP server versions:
 *   1) {fabric_name: "lab-b-alex", fabric_id: 75}   — current XCO
 *   2) {} or null / undefined                       — un-fabriced switch
 *   3) "lab-b-alex"                                  — older / flattened shape
 *  Lives next to pickStr because they're paired helpers; both consumed
 *  by the viz adapters that build inline tables out of NL tool results. */
function extractFabricName(it: any): string {
  // Top-level fabric_name wins (some adapters flatten it that way).
  const top = pickStr(it?.fabric_name);
  if (top) return top;
  const v: any = it?.fabric;
  if (v === null || v === undefined) return "—";
  if (typeof v === "object" && !Array.isArray(v)) {
    return pickStr((v as any)?.fabric_name)
        ?? pickStr((v as any)?.["fabric-name"])
        ?? pickStr((v as any)?.name)
        ?? "—";
  }
  // String case — but reject the serialised-empty-object literals that
  // some MCP tool serializers emit (looks like a fabric name to pickStr
  // but isn't one).
  const s = pickStr(v);
  if (!s) return "—";
  if (s === "{}" || s === "[object Object]") return "—";
  return s;
}

function pickStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}




// Tiny inline Markdown renderer — see lib/renderMarkdown.tsx.

// ── NL intent detectors ──────────────────────────────────────────────────────
// Pure regex-driven classifiers in lib/nl/detectors.ts.
// Each runs BEFORE we ship the prompt to the server's NL endpoint, so common
// operator phrasings open the right widget deterministically. Mirrored on the
// backend in nl/deterministic.py: NL routing has TWO layers.


export default function App() {
  // ── Auth removed — lean community client renders the dashboard
  // unconditionally. ──

  // ── NL prompt + LLM-tier + OpenAI key (see lib/useNlSettings) ──
  const {
    text, setText,
    includeRaw, setIncludeRaw,
    nlMode, setNlMode,
    openaiKey, setOpenaiKey,
    openaiModel, setOpenaiModel,
    openaiKeySet, setOpenaiKeySet,
    openaiKeySaving, setOpenaiKeySaving,
  } = useNlSettings();

  // "✓ saved" flash key shared by the Server Settings config sections
  // (OpenAI key / MCP server / Ollama). Empty string = no flash.
  const [savedFlash, setSavedFlash] = useState<string>("");

  // BGP Summary widget
  const [bgpWidgetOpen, setBgpWidgetOpen] = useState(false);
  const [bgpWidgetData, setBgpWidgetData] = useState<any>(null);

  // Help / capabilities widget
  const [helpWidgetOpen, setHelpWidgetOpen] = useState(false);
  const [helpExpandedCats, setHelpExpandedCats] = useState<Set<string>>(new Set(["monitoring", "switch", "tenant", "lifecycle", "l2ext", "firmware", "admin"]));

  // Switch picker widget — used for "show interfaces" etc. when no switch specified
  const [switchPickerOpen, setSwitchPickerOpen] = useState(false);
  const [switchPickerTitle, setSwitchPickerTitle] = useState("Select a switch");
  const switchPickerCallback = useRef<((ip: string, name: string) => void) | null>(null);

  const [quickActive, setQuickActive] = useState<string>("");
  // Fabric Topology (read-only Clos diagram) — parent owns open + selected
  // fabric; the FabricTopologyView feature component does the fetching +
  // parsing + ReactFlow rendering. See features/fabric/FabricTopologyView.tsx.
  const [fabricTopoOpen, setFabricTopoOpen] = useState<boolean>(false);
  const [fabricTopoName, setFabricTopoName] = useState<string>("");
  // RESTCONF quick action state
  const [restconfIps, setRestconfIps] = useState<string[]>([]);
  const [restconfIp, setRestconfIp] = useState<string>("");
  const [restconfTool, setRestconfTool] = useState<string>("");
  const [restconfLoading, setRestconfLoading] = useState<boolean>(false);
  const [restconfLoadErr, setRestconfLoadErr] = useState<string>("");
  const [restconfExtraInputs, setRestconfExtraInputs] = useState<string>("");
  const [restconfExtraErr, setRestconfExtraErr] = useState<string>("");
  // Running-config CLI inline widget
  const [runningConfigOpen, setRunningConfigOpen] = useState<boolean>(false);
  const [runningConfigFullscreen, setRunningConfigFullscreen] = useState<boolean>(false);

  // Interface Dashboard + Detail widgets — state lives in
  // lib/useIfaceWidgets.ts.
  const {
    ifaceWidgetOpen, setIfaceWidgetOpen,
    ifaceFilter, setIfaceFilter,
    ifaceSort, setIfaceSort,
    ifaceDetailWidgetOpen, setIfaceDetailWidgetOpen,
    ifaceDetailFilter, setIfaceDetailFilter,
    ifaceDetailSort, setIfaceDetailSort,
    ifaceDetailTab, setIfaceDetailTab,
  } = useIfaceWidgets();

  // Clock widget
  const [clockWidgetOpen, setClockWidgetOpen] = useState<boolean>(false);

  // Multi-switch clocks + NTP sync widget — state lives in
  // lib/useAllClocks.ts. Handlers stay in App.tsx
  // (handleOpenAllClocks below + handleSubmitNtpSync).
  const {
    allClocksOpen, setAllClocksOpen,
    allClocksData, setAllClocksData,
    allClocksLoading, setAllClocksLoading,
    allClocksNtpServer, setAllClocksNtpServer,
    allClocksQueryCount, setAllClocksQueryCount,
    allClocksNtpSubmitting,
  } = useAllClocks();

  // Media / transceivers widget
  const [mediaWidgetOpen, setMediaWidgetOpen] = useState<boolean>(false);

  // Port statistics widget
  const [portStatsWidgetOpen, setPortStatsWidgetOpen] = useState<boolean>(false);

  // IP interface widget
  const [ipIfaceWidgetOpen, setIpIfaceWidgetOpen] = useState<boolean>(false);

  // ARP table widget
  const [arpTableWidgetOpen, setArpTableWidgetOpen] = useState<boolean>(false);

  // LLDP neighbor detail widget
  const [lldpNeighWidgetOpen, setLldpNeighWidgetOpen] = useState<boolean>(false);

  // Maintenance rate monitoring widget
  const [maintRateWidgetOpen, setMaintRateWidgetOpen] = useState<boolean>(false);

  // VLAN brief widget
  const [vlanBriefWidgetOpen, setVlanBriefWidgetOpen] = useState<boolean>(false);

  // VRF summary widget
  const [vrfSummaryWidgetOpen, setVrfSummaryWidgetOpen] = useState<boolean>(false);

  // Firmware version widget
  const [firmwareWidgetOpen, setFirmwareWidgetOpen] = useState<boolean>(false);

  // Fabric health summary widget
  const [fabricHealthWidgetOpen, setFabricHealthWidgetOpen] = useState<boolean>(false);

  // Monitor health widget
  const [monitorHealthWidgetOpen, setMonitorHealthWidgetOpen] = useState<boolean>(false);

  // Tenant widget
  const [tenantWidgetOpen, setTenantWidgetOpen] = useState<boolean>(false);

  // EPG (all tenants) widget
  const [epgWidgetOpen, setEpgWidgetOpen] = useState<boolean>(false);

  // Fabrics health widget
  const [fabricsHealthWidgetOpen, setFabricsHealthWidgetOpen] = useState<boolean>(false);

  // ── Fleet inventory widget (tier-2 console) ────────────────────────
  // Aggregates inventory_getswitches (+ inventory_get_chassis_info_bulk
  // for serials when available). The hook does the parallel fetch + join.
  const [fleetInvOpen, setFleetInvOpen] = useState<boolean>(false);
  const [fleetInvFilter, setFleetInvFilter] = useState<string>("");
  const [fleetInvFabric, setFleetInvFabric] = useState<string>("");
  const fleetInv = useFleetInventory();

  // ── Fleet media inventory widget (tier-2 console) ──────────────────
  // Fans out restconf_get_media_detail across every switch; the widget
  // renders the flattened transceiver rows with switch context.
  const [fleetMediaOpen, setFleetMediaOpen] = useState<boolean>(false);
  const [fleetMediaFilter, setFleetMediaFilter] = useState<string>("");
  const [fleetMediaFabric, setFleetMediaFabric] = useState<string>("");
  const fleetMedia = useFleetMediaInventory();

  // ── Compass (IP / MAC / port / VLAN search) widget ─────────────────
  // Single search box that auto-classifies the query and fires the
  // right RESTCONF tool. NL handler sets initialQuery (raw needle) +
  // optional per-switch scope; widget renders inline.
  const [ipMacSearchOpen, setIpMacSearchOpen] = useState<boolean>(false);
  const [ipMacSearchQuery, setIpMacSearchQuery] = useState<string>("");
  const [ipMacSearchScope, setIpMacSearchScope] = useState<string[]>([]);

  // Alarm details with context widget
  const [alarmDetailsWidgetOpen, setAlarmDetailsWidgetOpen] = useState<boolean>(false);

  // Tenant historical report widget
  const [tenantHistoryWidgetOpen, setTenantHistoryWidgetOpen] = useState<boolean>(false);

  // Software version mismatch widget
  const [swVerWidgetOpen, setSwVerWidgetOpen] = useState<boolean>(false);
  // Tenant name picker (for historical report panel)
  const [tenantNames, setTenantNames] = useState<string[]>([]);
  const [tenantNamesLoading, setTenantNamesLoading] = useState(false);
  const [tenantNamesErr, setTenantNamesErr] = useState<string>("");
  const [selectedTenantName, setSelectedTenantName] = useState<string>("");
  const [historyWindowDays, setHistoryWindowDays] = useState<7 | 30>(7);
  const [historyAllowUnscoped, setHistoryAllowUnscoped] = useState<boolean>(true);

  const [sidebarAdminCollapsed, setSidebarAdminCollapsed] = useState(true);

  // ── Tier 4: Admin state (lean community client — Server Settings only) ───────
  // Admin: Server Settings
  const [adminSettingsOpen, setAdminSettingsOpen] = useState(false);
  const [adminSettings, setAdminSettings] = useState<Record<string, any>>({});
  const [adminSettingsLoading, setAdminSettingsLoading] = useState(false);
  const [adminSettingsErr, setAdminSettingsErr] = useState("");

  // RESTCONF / LLDP Topology (Console Quick Tools)
  // `fabric` lets detectPlanIntent distinguish "for <fabric-name>"
  // trailing tokens from switch lookups. Without it, queries like
  // "show fabric health for lab-b-alex" get mis-routed by the
  // per-switch fallback regex and return
  // intent: ambiguous with "Switch 'lab-b-alex' not found". Source:
  // inventory_getswitches → item.fabric.fabric_name.
  const [switchOptions, setSwitchOptions] = useState<{ ip: string; name?: string | null; fabric?: string | null }[]>([]);
  const [switchOptionsLoading, setSwitchOptionsLoading] = useState(false);

  // Compass prop memos — derived from switchOptions. Memoized so the
  // identity is stable across the ~60s inventory-refresh re-renders
  // (otherwise IpMacSearchWidget would wipe the operator's typed query
  // + results on every tick). Declared here, AFTER switchOptions, since
  // TS forbids referencing a const before its declaration.
  const compassFleetIps = useMemo(
    () => switchOptions.map((s) => s.ip),
    [switchOptions],
  );
  const compassSwitchNameByIp = useMemo(
    () => Object.fromEntries(
      switchOptions.filter((s) => s.name).map((s) => [s.ip, s.name as string]),
    ),
    [switchOptions],
  );
  const compassSwitchIpByName = useMemo(
    () => Object.fromEntries(
      switchOptions.filter((s) => s.name).map((s) => [s.name as string, s.ip]),
    ),
    [switchOptions],
  );

  // Auto-fetch fleet inventory / media when their widgets open. Single-
  // site community client → refresh() takes no site arg. The hook
  // ref is stable, so we only depend on the open flag.
  useEffect(() => {
    if (fleetInvOpen) {
      void fleetInv.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetInvOpen]);

  useEffect(() => {
    if (fleetMediaOpen) {
      void fleetMedia.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetMediaOpen]);

  const [lldpSeedIp, setLldpSeedIp] = useState<string>("");
  const [lldpDepth, setLldpDepth] = useState<1 | 2>(1);
  const [lldpNodes, setLldpNodes] = useState<Node[]>([]);
  const [lldpEdges, setLldpEdges] = useState<Edge[]>([]);
  const [lldpLoading, setLldpLoading] = useState(false);
  const [lldpErr, setLldpErr] = useState<string>("");
  const [lldpLabelMode, setLldpLabelMode] = useState<"compact" | "full" | "off">("compact");
  const [lldpEdgeTip, setLldpEdgeTip] = useState<{ text: string; x: number; y: number; pinned: boolean } | null>(null);
  const [lldpFullscreen, setLldpFullscreen] = useState(false);
  useEffect(() => {
    // Update topology edge labels when user toggles label mode
    setLldpEdges((prev: any[]) =>
      (prev || []).map((e: any) => {
        const full = e?.data?.fullLabel || e.label || "";
        const compact = e?.data?.compactLabel || full;
        const label = lldpLabelMode === "off" ? undefined : (lldpLabelMode === "full" ? full : compact);
        return { ...e, label, labelShowBg: lldpLabelMode !== "off" };
      })
    );
  }, [lldpLabelMode]);

  // Fabric Topology and the inline quick-tool panels (LLDP map, RESTCONF,
  // tenant history, …) both render in the console column. Opening any
  // quick tool sets quickActive, so close the Fabric Topology diagram when
  // that happens — keeps the console showing one widget at a time without
  // having to edit every quick-tool opener.
  useEffect(() => {
    if (quickActive) setFabricTopoOpen(false);
  }, [quickActive]);

  const [resp, setResp] = useState<NLResp | null>(null);

  const [cachedUptime, setCachedUptime] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [nlRunning, setNlRunning] = useState<boolean>(false);
  // nlElapsedMs / investigateElapsedMs now come from useElapsedMsWhile below.
  const nlReqSeq = useRef<number>(0);

  // Agent investigation (read-only, multi-step LLM loop)
  const [investigateOpen, setInvestigateOpen] = useState<boolean>(false);
  const [investigateRunning, setInvestigateRunning] = useState<boolean>(false);
  // investigateElapsedMs comes from useElapsedMsWhile below.
  const [investigateResult, setInvestigateResult] = useState<{
    skill?: string;
    synthesis?: string;
    trace?: any[];
    stop_reason?: string;
    tool_calls?: number;
    turns?: number;
    elapsed_ms?: number;
    error?: string;
  } | null>(null);
  // Agent skill registry, fetched once from /api/agent/skills. Used by
  // the (keyword-tier) SkillSuggestionChip. Hook owns the fetch.
  const agentSkillsRegistry = useAgentSkillsRegistry();
  // Operator can dismiss the chip for a specific text — keep the
  // dismissed text so we don't re-show until they edit the prompt.
  const [skillChipDismissedFor, setSkillChipDismissedFor] = useState<string>("");
  const [investigateTraceOpen, setInvestigateTraceOpen] = useState<boolean>(false);
  // Live events accumulated during streaming (cleared each run). Once the
  // `done` event arrives we move them onto investigateResult.trace.
  const [investigateLiveTrace, setInvestigateLiveTrace] = useState<any[]>([]);
  // Which skill is the currently-running (or last-run) one — drives the
  // panel title and the running spinner's verb.
  const [investigateActiveSkillKey, setInvestigateActiveSkillKey] = useState<string | null>(null);
  // Dropdown open/close for the AI Agent Skills picker.
  // (aiSkillsMenu open/closed state + ref + click-outside effect now live
  //  inside features/agent/AiInvestigationSkillsDropdown.)
  // Per-skill input-prompt modal. Opened when the user clicks a skill that
  // requires inputs (e.g. failed-switch IP for Pre-RMA Check) but didn't
  // type them. Resolves with the composed query when the user submits.
  const [skillPromptOpen, setSkillPromptOpen] = useState<boolean>(false);
  const [skillPromptSkillKey, setSkillPromptSkillKey] = useState<string>("");
  const [skillPromptValues, setSkillPromptValues] = useState<Record<string, string>>({});
  const [skillPromptError, setSkillPromptError] = useState<string>("");
  // Auto-scroll target for the live streaming trace — keeps the most
  // recent step in view as events arrive. Sticky-only when the user is
  // already near the bottom (don't yank the view if they scrolled up).
  const liveTraceScrollRef = useRef<HTMLDivElement>(null);

  // Lightweight progress indicators — via shared useElapsedMsWhile hook.
  const nlElapsedMs = useElapsedMsWhile(nlRunning, 200);
  const investigateElapsedMs = useElapsedMsWhile(investigateRunning, 250);

  // Auto-scroll the live trace so the latest step stays in view.
  // Sticky-only: if the user has scrolled up to read an earlier step,
  // leave them alone — don't yank the view back to the bottom.
  useEffect(() => {
    const el = liveTraceScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [investigateLiveTrace.length]);


  // Simple tab switch (no router)
  const [activeTab, setActiveTab] = useState<"dashboard" | "console" | "tools">("dashboard");

  // Light/dark theme — initial value from localStorage if present, else "dark".
  // The toggle button (top-right) flips this and adds/removes the
  // `theme-light` class on <html>. CSS variables in index.css handle the
  // actual color swap. The hex values in :root match what was hardcoded
  // before this commit, so dark-mode rendering is byte-identical.
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("xco_theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "dark";
  });
  useEffect(() => {
    if (theme === "light") document.documentElement.classList.add("theme-light");
    else document.documentElement.classList.remove("theme-light");
  }, [theme]);
  // Admin: Activity Log (formerly the top-nav "Audit" tab; moved under Admin
  // umbrella since it's already admin-gated and pairs naturally with Audit
  // Ledger — Activity Log = everything that happened, Ledger = mutations only).
  const [adminActivityOpen, setAdminActivityOpen] = useState(false);


  // ── Audit log state ──────────────────────────────────────────────────────────
  type AuditRecord = { ts: string; event: string; [k: string]: any };
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditErr, setAuditErr] = useState("");

  async function loadAudit() {
    setAuditLoading(true);
    setAuditErr("");
    try {
      const r = await getJSON<AuditRecord[]>("/api/audit?n=200");
      setAuditRecords(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setAuditErr(e.message ?? "Failed to load audit log");
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (adminActivityOpen) loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminActivityOpen]);

  const [tools, setTools] = useState<ToolDef[]>([]);
  const restconfTools = useMemo(() => {
    const list = (tools ?? []).filter((t) => {
      const name = (t?.name ?? "").toLowerCase();
      const cat = (t?.category ?? "").toLowerCase();
      return name.startsWith("restconf_") || cat === "restconf";
    });
    return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [tools]);

  const [toolQuery, setToolQuery] = useState("");
  const [toolCategory, setToolCategory] = useState("All");
  const [selectedTool, setSelectedTool] = useState<ToolDef | null>(null);

  // If user comes from Tools tab, we "lock" the tool so Console Run doesn't re-pick a different one.
  const [forcedTool, setForcedTool] = useState<string | null>(null);
  const [forcedInputs, setForcedInputs] = useState<any>({});

  // Explain/Summary/Raw view
  const [viewMode, setViewMode] = useState<"summary" | "explain" | "raw">(
    "summary"
  );

  // Example categories
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("All");

  // Load categories once
  useEffect(() => {
    (async () => {
      try {
        const r = await getJSON<{ categories: string[] }>("/api/examples");
        setCategories(r.categories ?? []);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Load tool catalog once
  useEffect(() => {
    (async () => {
      try {
        const r = await getJSON<ToolDef[]>("/api/tools");
        setTools(Array.isArray(r) ? r : []);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Re-open the right widget whenever the response changes.
  // This is the universal fallback that ensures widgets open regardless of which
  // code path triggered the API call (NL input, Tools tab, example button, etc.).
  // RESTCONF tools already get an extra explicit openWidgetForTool() call from their
  // dedicated console panel — this useEffect covers all other tools (monitor, fabric …).
  useEffect(() => {
    const tool = resp?.picked?.tool;
    if (tool) openWidgetForTool(tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp]);


// Helper: invoke an MCP tool via the MCP Client backend
async function invokeTool(tool: string, inputs: Record<string, any>) {
  return await postJSON<any>("/api/invoke", { tool, inputs });
}
function unwrapInvokePayload(r: any) {
  return r?.result?.payload ?? r?.payload ?? null;
}


// Reusable helper: fetch switch list from inventory and update switchOptions state
async function refreshSwitchOptions() {
  setSwitchOptionsLoading(true);
  try {
    const inputs: Record<string, any> = {};
    const r = await postJSON<any>("/api/invoke", { tool: "inventory_getswitches", inputs });
    const items: any[] =
      r?.result?.payload?.items ??
      r?.result?.payload?.payload?.items ??
      (Array.isArray(r?.result?.payload?.payload) ? r.result.payload.payload : null) ??
      (Array.isArray(r?.result?.payload) ? r.result.payload : []);

    const opts: { ip: string; name?: string | null; fabric?: string | null }[] = [];
    const seen = new Set<string>();

    for (const it of items) {
      const ip = pickStr(it?.ip_address ?? it?.ip ?? it?.management_ip ?? it?.mgmt_ip ?? it?.address);
      if (!ip) continue;
      if (seen.has(ip)) continue;
      seen.add(ip);
      const name = pickStr(it?.name ?? it?.device_name ?? it?.hostname ?? it?.chassis_name ?? it?.model);
      // fabric field shape from inventory_getswitches:
      //   { fabric: { fabric_name: "lab-b-alex", fabric_id: 75 } }
      // We capture just the name here; that's what detectPlanIntent
      // needs to disambiguate "for <fabric-name>" trailing tokens
      // from switch lookups.
      const fabric = pickStr(it?.fabric?.fabric_name ?? it?.fabric_name ?? (typeof it?.fabric === "string" ? it.fabric : null));
      opts.push({ ip, name, fabric });
    }

    opts.sort((a, b) => a.ip.localeCompare(b.ip));
    setSwitchOptions(opts);

    if (!lldpSeedIp && opts.length) setLldpSeedIp(opts[0].ip);
    // Return the fresh options so callers can use them immediately without
    // waiting for the setSwitchOptions state update (used by the per-switch
    // NL auto-heal — re-resolve a switch name right after a site switch).
    return opts;
  } catch {
    // MCP server may not be ready yet — retry after 3s
    setTimeout(() => { refreshSwitchOptions(); }, 3000);
    return [] as { ip: string; name?: string | null; fabric?: string | null }[];
  } finally {
    setSwitchOptionsLoading(false);
  }
}

// Load switch IP options on mount
useEffect(() => {
  refreshSwitchOptions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Reload tenant names on mount, so the tenant-history dropdown AND the Help
// examples reflect this XCO's tenants — not the hardcoded "T1" fallback.
useEffect(() => {
  void loadTenantNames();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  
  async function loadRestconfIps() {
    // Best-effort: derive candidate switch IPs from inventory
    if (restconfLoading) return;
    setRestconfLoadErr("");
    setRestconfLoading(true);
    try {
      const r = await invokeToolTyped("inventory_getswitches", {});
      // Client backend returns {session_id, result:{tool,status,payload,...}}
      const payload = r?.result?.payload ?? r?.payload ?? null;
      const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload)
        ? payload
        : Array.isArray(r?.result?.payload?.payload?.items)
        ? r.result.payload.payload.items
        : [];

      const ips: string[] = [];
      for (const it of items as any[]) {
        const ip = pickStr(it?.ip_address ?? it?.ip ?? it?.management_ip ?? it?.mgmt_ip ?? it?.address);
        if (!ip) continue;
        if (!ips.includes(ip)) ips.push(ip);
      }
      setRestconfIps(ips);
      if (!restconfIp && ips.length) setRestconfIp(ips[0]);
    } catch (e: any) {
      setRestconfLoadErr(String(e?.message ?? e));
    } finally {
      setRestconfLoading(false);
    }
  }

  async function loadTenantNames() {
    if (tenantNamesLoading) return;
    setTenantNamesErr("");
    setTenantNamesLoading(true);
    try {
      const r = await invokeToolTyped("tenant_get_tenants", {});
      const outer: any = r?.result?.payload ?? r?.payload ?? {};
      const inner: any = outer?.payload ?? outer;
      const items: any[] = Array.isArray(inner?.tenant) ? inner.tenant : [];
      const names: string[] = items
        .map((t: any) => String(t?.name ?? t?.tenant_name ?? ""))
        .filter(Boolean);
      setTenantNames(names);
      if (!selectedTenantName && names.length) setSelectedTenantName(names[0]);
    } catch (e: any) {
      setTenantNamesErr(String(e?.message ?? e));
    } finally {
      setTenantNamesLoading(false);
    }
  }

async function randomExample() {
    setErr("");
    // Pick a real switch IP from inventory at runtime so the per-switch
    // examples don't rely on hardcoded lab IPs. If nothing's loaded yet,
    // fall back to a known lab-b address; the worst case is the example
    // errors out and the user clicks again.
    const aSwitchIp = switchOptions.length > 0
      ? switchOptions[Math.floor(Math.random() * switchOptions.length)].ip
      : "10.9.140.31";
    // Pick a real tenant name if known; else a plausible default.
    const aTenant = tenantNames.length > 0
      ? tenantNames[Math.floor(Math.random() * tenantNames.length)]
      : "T1";

    // Curated demo examples — natural language queries across every Tier-2
    // viewer widget. Each entry shows a human-readable question and forces
    // the matching tool directly. No-arg tools first; per-switch / per-tenant
    // tools below, parameterized at runtime.
    const DEMO_EXAMPLES: { text: string; tool: string; inputs: Record<string, any> }[] = [
      // ── Fabric (no args) ──────────────────────────────────────────────────
      { text: "What's the health of all my fabrics?",                              tool: "fabric_get_fabric_health_summary",       inputs: {} },
      { text: "Show me a fabric overview — status, type, and health.",             tool: "fabric_get_fabric_overview",             inputs: {} },
      { text: "Give me the per-fabric health rollup across the estate.",           tool: "fabric_get_fabrics_health",              inputs: {} },

      // ── Inventory (no args) ───────────────────────────────────────────────
      { text: "Show me all switches.",                                             tool: "inventory_get_switch_inventory_overview",inputs: {} },
      { text: "Give me a switch topology summary — how many leaves, spines, border leaves?", tool: "inventory_get_switches_widget_table", inputs: {} },
      { text: "Are there any devices I can't reach right now?",                   tool: "inventory_get_unreachable_devices",      inputs: {} },
      { text: "Do all switches run the same firmware version?",                   tool: "inventory_get_software_version_mismatch",inputs: {} },
      { text: "Which devices are dragging fabric health into the red?",           tool: "inventory_get_device_health_rollup",     inputs: {} },

      // ── Tenant / EPG (no args) ────────────────────────────────────────────
      { text: "List all tenants.",                                                tool: "tenant_get_tenants",                     inputs: {} },
      { text: "List all endpoint groups across every tenant.",                    tool: "tenant_get_all_endpoint_groups",         inputs: {} },

      // ── Alarms / Faults (no args) ─────────────────────────────────────────
      { text: "What are the top critical active alarms right now?",               tool: "fault_get_active_alarms_top",            inputs: {} },
      { text: "Show me alarm details with context — what's impacted and why?",    tool: "fault_get_alarm_details_with_context",   inputs: {} },

      // ── Platform / System (no args) ───────────────────────────────────────
      { text: "Show me a full platform status — EFA, services, and health.",      tool: "monitor_get_platform_quick_status",      inputs: {} },
      { text: "Show platform-wide monitor health.",                               tool: "monitor_get_health",                     inputs: {} },
      { text: "Is the HA cluster healthy? Show me node and storage status.",      tool: "system_get_ha_and_node_health_summary",  inputs: {} },
      { text: "Which certificates are expiring in the next 90 days?",            tool: "system_get_certificates_expiring_soon",  inputs: {} },
      { text: "Are there any certificate expiry alarms I should know about?",    tool: "system_get_certificate_alarm_context",   inputs: {} },

      // ── RESTCONF per-switch (uses a real IP from inventory if loaded) ────
      { text: `Show me the clock on ${aSwitchIp}.`,                                tool: "restconf_get_clock",                     inputs: { switch_ip: aSwitchIp } },
      { text: `Show all interfaces on ${aSwitchIp}.`,                              tool: "restconf_get_interface_all",             inputs: { switch_ip: aSwitchIp } },
      { text: `Give me detailed interface state for ${aSwitchIp}.`,                tool: "restconf_get_interface_detail",          inputs: { switch_ip: aSwitchIp } },
      { text: `What's the IP interface configuration on ${aSwitchIp}?`,            tool: "restconf_get_ip_interface",              inputs: { switch_ip: aSwitchIp } },
      { text: `Show the ARP table on ${aSwitchIp}.`,                               tool: "restconf_get_arp_table",                 inputs: { switch_ip: aSwitchIp } },
      { text: `Show LLDP neighbor detail for ${aSwitchIp}.`,                       tool: "restconf_get_lldp_neighbor_detail",      inputs: { switch_ip: aSwitchIp } },
      { text: `Show VLAN brief on ${aSwitchIp}.`,                                  tool: "restconf_get_vlan_brief",                inputs: { switch_ip: aSwitchIp } },
      { text: `Show VRF summary on ${aSwitchIp}.`,                                 tool: "restconf_get_vrf_summary",               inputs: { switch_ip: aSwitchIp } },
      // BGP tool takes `switch_ips` (plural array) — unlike every other
      // RESTCONF tool which uses `switch_ip` (singular string). Mismatch
      // here = no IP under the right key = MCP 400 "no IP provided".
      { text: `Show BGP summary on ${aSwitchIp}.`,                                 tool: "restconf_get_bgp_summary",               inputs: { switch_ips: [aSwitchIp] } },
      { text: `What firmware version is ${aSwitchIp} running?`,                    tool: "restconf_show_firmware_version",         inputs: { switch_ip: aSwitchIp } },
      { text: `Show port statistics summary for ${aSwitchIp}.`,                    tool: "restconf_get_port_statistics_summary",   inputs: { switch_ip: aSwitchIp } },
      { text: `Show optical media detail on ${aSwitchIp}.`,                        tool: "restconf_get_media_detail",              inputs: { switch_ip: aSwitchIp } },
      { text: `Show maintenance rate monitoring on ${aSwitchIp}.`,                 tool: "restconf_get_system_maintenance_rate_monitoring", inputs: { switch_ip: aSwitchIp } },

      // ── Tenant historical (per-tenant) ────────────────────────────────────
      { text: `Show the EPG history report for tenant ${aTenant}.`,                tool: "tenant_get_service_epg_historical_report_stub", inputs: { tenant_name: aTenant } },
    ];
    const pick = DEMO_EXAMPLES[Math.floor(Math.random() * DEMO_EXAMPLES.length)];
    setForcedTool(null);
    setForcedInputs({});
    await runNLWithText(pick.text, {
      force_tool: pick.tool,
      force_inputs: pick.inputs,
    });
  }

  // Auto-open the appropriate widget whenever a RESTCONF tool is picked,
  // whether triggered by NL input or the RESTCONF quick-action panel.
  // ── Plan intent detection ────────────────────────────────────────────────
  type PlanIntent =
    | { kind: "show_all_clocks"; switchFilter?: string }
    | { kind: "show_switches" }
    | { kind: "fabrics_health" }
    | { kind: "direct_tool"; tool: string; inputs?: Record<string, any>; label: string };

  // ── Typo/misspelling correction map ──────────────────────────────────────
  const TYPO_MAP: Record<string, string> = {
    // verbs
    shw: "show", shwo: "show", hsow: "show", sho: "show", sahow: "show", sohw: "show", whow: "show",
    dsplay: "display", dispaly: "display", displya: "display", dsiplay: "display", disply: "display",
    lst: "list", lsit: "list", lits: "list", ilst: "list",
    chek: "check", chekc: "check", cehck: "check", chesk: "check", hceck: "check",
    cretae: "create", craete: "create", creat: "create", creaet: "create",
    delpoy: "deploy", deply: "deploy", depoly: "deploy", deplyo: "deploy", dploy: "deploy",
    destory: "destroy", destry: "destroy", desrtoy: "destroy", detroy: "destroy",
    remvoe: "remove", reomve: "remove", remov: "remove", rmove: "remove",
    delte: "delete", deleet: "delete", delet: "delete", dleet: "delete",
    biuld: "build", buld: "build", buidl: "build",
    registr: "register", regsiter: "register", regster: "register",
    provison: "provision", provisoin: "provision",
    ad: "add", aad: "add",
    giv: "give", gve: "give",
    veiw: "view", viwe: "view",
    clen: "clean", claen: "clean", clena: "clean",
    prpare: "prepare", prepre: "prepare",
    // nouns
    fbaric: "fabric", fabrc: "fabric", farbic: "fabric", fabir: "fabric", frabic: "fabric", facbric: "fabric", fabirc: "fabric",
    swtich: "switch", swich: "switch", swithc: "switch", siwtch: "switch", swtch: "switch", swicth: "switch",
    swtiches: "switches", switcesh: "switches", swiches: "switches", switchs: "switches", swtches: "switches",
    invnetory: "inventory", invenotry: "inventory", invetory: "inventory", inventroy: "inventory", inevntory: "inventory",
    topolgy: "topology", topolgoy: "topology", toplogy: "topology", topoloogy: "topology", topolog: "topology",
    topologies: "topologies", topolgoies: "topologies",
    helath: "health", heatlh: "health", haelth: "health", helth: "health",
    stauts: "status", staus: "status", sttaus: "status", statis: "status", statsu: "status",
    alram: "alarm", alrm: "alarm", alams: "alarms", alrams: "alarms",
    alrt: "alert", alret: "alert", laert: "alert", alrets: "alerts", alrts: "alerts",
    vesion: "version", verion: "version", vresion: "version", verison: "version", versoin: "version",
    tennat: "tenant", tenat: "tenant", tenatn: "tenant", tennant: "tenant",
    deivce: "device", devcie: "device", dvice: "device", devce: "device",
    executoin: "execution", exeuction: "execution", exection: "execution",
    certiifcate: "certificate", certifcate: "certificate", cetificate: "certificate",
    neigbor: "neighbor", neighbr: "neighbor", nieghbor: "neighbor", neihgbor: "neighbor",
    softwre: "software", sofware: "software", sotfware: "software",
    firmwre: "firmware", frimware: "firmware",
    bgp: "bgp", bpg: "bgp", gbp: "bgp",
    lldp: "lldp", lldpp: "lldp",
    uptme: "uptime", upitme: "uptime",
    clokc: "clock", clocl: "clock", clcok: "clock",
    palne: "plan", paln: "plan", plna: "plan",
    sit: "site", stie: "site", siet: "site",
    xoc: "xco",
  };

  function fixTypos(input: string): string {
    return input.replace(/\b[a-z]+\b/gi, (word) => TYPO_MAP[word.toLowerCase()] ?? word);
  }

  function detectPlanIntent(text: string): PlanIntent | null {
    // ── Help / capabilities ─────────────────────────────────────────────────
    if (/\b(what\s+can\s+you\s+do|what\s+can\s+i\s+do|help|capabilities|commands|actions|examples|tutorial|getting\s+started|how\s+to\s+use|what\s+is\s+possible|what\s+are\s+.*options)\b/i.test(text) &&
        !/\b(show|deploy|destroy|create|remove|add|upgrade|clean|extend|build)\b/i.test(text)) {
      return { kind: "show_help" } as any;
    }

    // ── Early bail: per-switch queries should NOT be caught here ────────────
    // "show X on switch <IP>", "X for switch <name>" etc. must fall through
    // to detectLldpIntent / RESTCONF handlers below.
    if (!/\b(deploy|destroy|create|remove|delete|add|register|clean|wipe|upgrade|update)\b/i.test(text) &&
        !/\b(topology|topo|fabric)\s+(for|of)\s+/i.test(text) &&
        !/\bbgp\b/i.test(text)) {
      const hasIpTarget = /\b(on|for|at|from)\s+(the\s+)?(switch\s+)?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i.test(text);
      // Match "on switch Leaf-1" OR "on Spine-1" (without "switch" keyword)
      const perSwitchMatch = !hasIpTarget && (
        text.match(/\b(?:on|for|at|from)\s+(?:the\s+)?switch\s+(\S+)/i) ||
        text.match(/\b(?:on|for|at|from)\s+(?:the\s+)?(\S+)\s*$/i)
      );
      if (perSwitchMatch) {
        const attempted = perSwitchMatch[1];
        // Skip if the "target" is a generic word, not a switch reference
        const SKIP_WORDS = /^(all|every|each|any|some|this|that|my|switches|devices?|fabric|inventory|xco|it)$/i;
        if (!SKIP_WORDS.test(attempted)) {
          // Bug surfaced 2026-06-06: "show fabric health for lab-b-alex"
          // routed here and reported "Switch 'lab-b-alex' not found"
          // because the per-switch matcher couldn't tell the trailing
          // "for X" was a fabric name. Filter by switchOptions[].fabric
          // first — if the attempted name is a known fabric, bail out
          // (let downstream patterns handle the fabric-scoped intent).
          const knownFabric = switchOptions.some(
            (sw) => sw.fabric && sw.fabric.toLowerCase() === attempted.toLowerCase()
          );
          if (knownFabric) return null;

          // Check if it's an exact name match
          const exactMatch = switchOptions.some((sw) => sw.name && sw.name.toLowerCase() === attempted.toLowerCase());
          // Check if any switch name contains this text (partial match)
          const partialMatch = switchOptions.some((sw) => sw.name && sw.name.toLowerCase().includes(attempted.toLowerCase()));
          if (exactMatch) return null; // exact match → bail, let per-switch handlers process
          if (partialMatch) return null; // partial match like "Spine-1" from "spine-1" → bail

          // Not found — show helpful error with suggestions
          const names = switchOptions.filter((s) => s.name).map((s) => s.name!);
          const close = names.filter((n) => {
            const nl = n.toLowerCase(), al = attempted.toLowerCase();
            return nl.includes(al) || al.includes(nl) || (al.length >= 3 && nl.startsWith(al.slice(0, 3)));
          });
          const hint = close.length > 0
            ? `\n\nDid you mean?\n${close.map((n) => `  → ${n} (${switchOptions.find((s) => s.name === n)?.ip})`).join("\n")}`
            : "";
          const available = switchOptions.map((s) => `  ${s.ip}${s.name ? ` — ${s.name}` : ""}`).join("\n");
          return { kind: "direct_tool", tool: "", label: "",
            inputs: { __prompt: `Switch "${attempted}" not found in inventory.${hint}\n\nAvailable switches:\n${available}` } } as any;
        }
      }
      if (hasIpTarget) return null;
    }

    // ── Normalize input ──────────────────────────────────────────────────────
    // Strip trailing punctuation, filler words, articles, politeness phrases, fix typos
    const t = fixTypos(text.toLowerCase())
      .replace(/[.,;:!?]+$/g, "").trim()
      .replace(/\b(show|give|display|list|get|view)\s+me\b/gi, "$1")
      .replace(/\b(i\s+want\s+to|i\s+need\s+to|i\s+would\s+like\s+to|i'd\s+like\s+to|let'?s|go\s+ahead\s+and|just)\b/gi, "")
      .replace(/\b(the|a|an|all\s+the|please|pls|can\s+you|could\s+you|would\s+you)\b/gi, "")
      .replace(/\s{2,}/g, " ").trim();

    // Common verbs used across intents
    const SEE = "show|display|view|open|list|get|check|what(?:'s|\\s+is|\\s+are)?|which|describe";

    // ── Fabrics health (no specific name) ────────────────────────────────────
    // "show fabrics", "list all fabrics", "fabric health", "what fabrics do I have",
    // "how many fabrics", "check fabric status", bare "fabrics"
    if (new RegExp(`\\b(?:${SEE})\\s+(?:all\\s+)?fabrics?\\s*$`, "i").test(t) ||
        new RegExp(`\\b(?:${SEE})\\s+(?:all\\s+)?fabrics?\\s+(?:health|status|overview)\\b`, "i").test(t) ||
        /\b(?:all|my)\s+fabrics?\s*$/i.test(t) ||
        /\bfabric\s+(?:health|status|overview)\s*$/i.test(t) ||
        /\bhow\s+many\s+fabrics?\b/i.test(t) ||
        /\bwhat\s+fabrics?\s+(do|are|have)\b/i.test(t) ||
        /^fabrics?\s*$/i.test(t)) {
      return { kind: "fabrics_health" };
    }

    // ── Clocks / uptime ──────────────────────────────────────────────────────
    // Single switch: "show clock on switch Leaf-1", "show clock on 10.9.140.41", "uptime for Spine-2"
    {
      const singleClockMatch = t.match(
        /\b(?:show|display|view|check|get)\s+(?:clock|time|uptime)\s+(?:on|for|of)\s+(?:switch\s+)?(\S+)/i
      ) || t.match(
        /\b(?:uptime|clock|time)\s+(?:on|for|of)\s+(?:switch\s+)?(\S+)/i
      );
      if (singleClockMatch) {
        const filter = singleClockMatch[1];
        // If it's "all"/"every"/"switches" → fall through to all-clocks below
        if (!/^(all|every|switches|devices?)$/i.test(filter)) {
          return { kind: "show_all_clocks", switchFilter: filter };
        }
      }
    }
    // All switches: "show clock on all switches", "what time is it on switches", "switch uptime", "check clocks"
    if (/\b(show|display|view|check|what)\b.*\b(clock|time|ntp)\b.*\b(all|every|switch|device)\b/i.test(t) ||
        /\b(show|display|view|check)\s+(all|every)\s+(switch|device)?\s*(clocks?|times?)\b/i.test(t) ||
        /\bclocks?\s+(on\s+)?(all|every)\s+(switches|devices?)\b/i.test(t) ||
        /\b(show|display|view|check)\s+uptime\b/i.test(t) ||
        /\b(switch|device)\s+uptime\b/i.test(t) ||
        /\bwhat\s+time\b.*\bswitch/i.test(t) ||
        /\buptime\s+(on|for|of)\s+(all\s+)?(switches|devices?)\b/i.test(t) ||
        /\b(show|check)\s+(clocks?|time)\s*$/i.test(t)) {
      return { kind: "show_all_clocks" };
    }

    // ── Switches / inventory ─────────────────────────────────────────────────
    // "show switches", "what's in my inventory", "which switches", "how many switches",
    // "list devices", bare "inventory", bare "switches"
    if (new RegExp(`\\b(?:${SEE})\\s+(?:all\\s+)?switches\\b`, "i").test(t) ||
        new RegExp(`\\b(?:${SEE})\\s+(?:all\\s+)?inventory\\b`, "i").test(t) ||
        new RegExp(`\\b(?:${SEE})\\s+(?:all\\s+)?devices?\\b`, "i").test(t) ||
        /\bhow\s+many\s+(switches|devices?)\b/i.test(t) ||
        /\bwhat(?:'s|\s+is)\s+in\s+(?:my\s+)?inventory\b/i.test(t) ||
        /\bwhich\s+switches\b/i.test(t) ||
        /^(?:switches|inventory)\s*$/i.test(t)) {
      return { kind: "show_switches" };
    }

    // ── Ambiguous / incomplete commands → helpful prompt ────────────────────
    // "show ip" (bare, no "addresses"/"interface"/"route" etc.) — too vague
    if (/\b(?:show|check|get)\s+ip\s*$/i.test(t)) {
      return { kind: "direct_tool", tool: "", label: "show ip",
        inputs: { __prompt: "Please be more specific:\n\n  → show ip addresses on switch <IP>\n  → show ip interface on switch <IP>\n  → show ip route on switch <IP>\n  → show switches  (to see all switch IPs)" } } as any;
    }
    // "show config" / "show running" (bare — which switch?)
    if (/\b(?:show|get)\s+(running|startup|config)\s*$/i.test(t)) {
      return { kind: "direct_tool", tool: "", label: "show config",
        inputs: { __prompt: "Which switch? Try:\n\n  → show running config on switch <IP>\n  → show config on switch <name>" } } as any;
    }

    // ── Direct tool routing for common queries ──────────────────────────────
    // Software versions / version mismatch
    if (/\b(software|firmware)\s+(version|mismatch)/i.test(t) ||
        /\bversion\s+(mismatch|consistency|check|diff)/i.test(t) ||
        /\b(check|show|compare)\b.*\b(versions?|firmware)/i.test(t) ||
        /\bmismatch/i.test(t)) {
      return { kind: "direct_tool", tool: "inventory_get_software_version_mismatch", label: "software version check" };
    }
    // What happened / recent events / activity / history
    if (/\bwhat\s+(happened|occurred|changed)/i.test(t) ||
        /\b(recent|latest|last)\s+(events?|activity|changes?|alerts?|alarms?)/i.test(t) ||
        /\b(last|past)\s+(\d+\s+)?(hour|minute|day|hours|minutes|days)/i.test(t) ||
        /\bevent\s+(log|history)/i.test(t) ||
        /\bactivity\s+(log|feed|stream)/i.test(t)) {
      // If a fabric is named (dash-containing token after a preposition,
      // or explicit "fabric <name>"), route to the chronological view tool
      // — matching the server-side regex. The timeline tool gives the
      // operator a per-fabric event/execution stream which is what the
      // present-perfect "what happened to X?" question is asking for.
      // Without a fabric name we keep the existing alarm-details route
      // since "what happened?" by itself reads as a fleet-wide question.
      const fabMatch =
        text.match(/\bfabric\s+([a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\b/i)?.[1] ||
        text.match(/\b(?:to|on|with|for|of|in)\s+([a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\b/i)?.[1];
      const fabricName =
        fabMatch && fabMatch.includes("-") && fabMatch.toLowerCase() !== "in-the"
          ? fabMatch
          : null;
      if (fabricName) {
        const inputs: Record<string, any> = { name: fabricName };
        // Time window: "last 24h" / "past 7 days" / "last week" etc.
        const winNum = text.match(/\b(?:last|past|previous)\s+(\d+)\s*(hour|hr|day|d|week|wk|month|mo)s?\b/i);
        const winSing = text.match(/\b(?:last|past|previous)\s+(hour|day|week|month)\b/i);
        const shortH = text.match(/\b(\d+)\s*h(?:ours?)?\b/i);
        if (winNum) {
          const n = parseInt(winNum[1], 10);
          const unitMap: Record<string, number> = { h: n, d: n * 24, w: n * 168, m: n * 720 };
          const hrs = unitMap[winNum[2][0].toLowerCase()];
          if (hrs) inputs.window_hours = hrs;
        } else if (winSing) {
          const u = winSing[1].toLowerCase();
          const sMap: Record<string, number> = { hour: 1, day: 24, week: 168, month: 720 };
          if (sMap[u]) inputs.window_hours = sMap[u];
        } else if (shortH) {
          inputs.window_hours = parseInt(shortH[1], 10);
        }
        return {
          kind: "direct_tool",
          tool: "fabric_get_fabric_health_timeline",
          inputs,
          label: "fabric timeline",
        } as any;
      }
      return { kind: "direct_tool", tool: "fault_get_alarm_details_with_context", label: "recent events" };
    }
    // Alarms / faults / alerts
    if (/\b(alarm|alert|fault|error)s?\b/i.test(t) &&
        /\b(show|check|any|list|get|view|what|are\s+there)/i.test(t)) {
      return { kind: "direct_tool", tool: "fault_get_alarm_details_with_context", label: "alarms" };
    }
    // Health / status / overview (generic)
    if (/\b(health|status)\s+(of|check|report|overview)/i.test(t) ||
        /\b(how\s+is|how's)\b.*\b(network|fabric|system|everything)\b/i.test(t) ||
        /\b(is\s+everything|everything)\s+(ok|healthy|fine|good|working)/i.test(t) ||
        /\bnetwork\s+(health|status)/i.test(t) ||
        /\bsystem\s+(health|status)/i.test(t) ||
        /\b(summary|overview)\s+(of\s+)?(everything|all|what'?s?\s+going\s+on)/i.test(t) ||
        /\bwhat'?s?\s+(going\s+on|happening)\b/i.test(t) ||
        /\bgive\b.*\b(summary|overview|rundown|status)\b/i.test(t) ||
        /\b(overall|general)\s+(status|health|state)\b/i.test(t) ||
        /\bhow\s+(are|is)\s+(things|my\s+(network|fabric|environment|system))\b/i.test(t) ||
        /\banything\s+(wrong|broken|down|degraded)\b/i.test(t) ||
        /\bany\s+(issues?|problems?|outages?)\b/i.test(t) ||
        /\bany\s+(interfaces?|ports?|links?)\s+(down|error|flapping)/i.test(t) ||
        /\b(are|is)\s+(any|there)\s+(interfaces?|ports?|links?)\s+(down|in\s+error|flapping)/i.test(t) ||
        (/\b(interface|port|link)\s+(down|errors?|flap)/i.test(t) && !/\bon\s+(switch|device|\d)/i.test(t)) ||
        (/\b(interface|port|link)\s+(status|state|summary)\b/i.test(t) && !/\bon\s+(switch|device|\d)/i.test(t) && !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t))) {
      return { kind: "direct_tool", tool: "fabric_get_fabric_health_summary", label: "health check" };
    }
    // "show interfaces" (bare, no switch) — open switch picker
    if (/\b(show|list|get|check)\s+(all\s+)?interfaces?\b/i.test(t) && !/\bon\s+(switch|device|\d)/i.test(t) && !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t)) {
      return { kind: "pick_switch", action: "interfaces" } as any;
    }
    // Tenants / EPGs
    if (/\b(show|list|get|view|check)\b.*\btenants?\b/i.test(t) ||
        /\btenants?\s+(list|overview)/i.test(t) ||
        /\bhow\s+many\s+tenants?\b/i.test(t)) {
      return { kind: "direct_tool", tool: "tenant_get_tenants", label: "tenants" };
    }
    if (/\b(show|list|get|view)\b.*\b(epg|endpoint\s+group)s?\b/i.test(t)) {
      return { kind: "direct_tool", tool: "tenant_get_all_endpoint_groups", label: "endpoint groups" };
    }
    // Execution / running jobs / platform status
    if (/\b(execution|job|task)s?\s+(status|running|progress|monitor)/i.test(t) ||
        /\b(show|check|view)\b.*\b(execution|running\s+job|task)s?\b/i.test(t) ||
        /\bwhat('s|\s+is)\s+running\b/i.test(t) ||
        /\bplatform\s+(status|health)/i.test(t)) {
      return { kind: "direct_tool", tool: "monitor_get_platform_quick_status", label: "platform status" };
    }
    // Certificates
    if (/\bcertificates?\b/i.test(t) ||
        /\bcerts?\b/i.test(t) ||
        /\bssl\b/i.test(t) ||
        /\btls\b/i.test(t)) {
      // "expiring" / "expiry" → expiring soon; otherwise → alarm context (general check)
      if (/\bexpir/i.test(t)) {
        return { kind: "direct_tool", tool: "system_get_certificates_expiring_soon", label: "certificates expiring" };
      }
      return { kind: "direct_tool", tool: "system_get_certificate_alarm_context", label: "certificate status" };
    }
    // HA / cluster health
    if (/\bha\b/i.test(t) && /\b(status|health|check|cluster)\b/i.test(t) ||
        /\bcluster\s+(health|status)\b/i.test(t) ||
        /\bhigh\s+availability\b/i.test(t)) {
      return { kind: "direct_tool", tool: "system_get_ha_and_node_health_summary", label: "HA cluster health" };
    }
    // Unreachable / down devices
    if (/\bunreachable\b/i.test(t) ||
        /\b(device|switch)s?\s+(down|offline|unreachable|not\s+responding)\b/i.test(t) ||
        /\b(down|offline)\s+(device|switch)/i.test(t) ||
        /\bcan'?t\s+reach\b/i.test(t) ||
        /\bnot\s+respond/i.test(t)) {
      return { kind: "direct_tool", tool: "inventory_get_unreachable_devices", label: "unreachable devices" };
    }
    // Device health rollup
    if (/\bdevice\s+health\b/i.test(t) ||
        /\bswitch\s+health\b/i.test(t) ||
        /\b(dragging|degrading|worst|unhealthy)\b.*\b(device|switch|health)\b/i.test(t)) {
      return { kind: "direct_tool", tool: "inventory_get_device_health_rollup", label: "device health" };
    }
    // Active alarms (top)
    if (/\b(active|top|critical)\s+alarms?\b/i.test(t) ||
        /\balarms?\s+(summary|top|active|critical)\b/i.test(t)) {
      return { kind: "direct_tool", tool: "fault_get_active_alarms_top", label: "active alarms" };
    }
    // Note: LLDP / neighbors handled by detectLldpIntent() which runs after this function

    return null;
  }

  // ── Tier-3 widget closer ────────────────────────────────────────────────────
  function closeAllTier3Widgets() {
    setAdminActivityOpen(false);
    setAdminSettingsOpen(false);
    setInvestigateOpen(false);
    setAllClocksOpen(false);
    // Close inline console widgets & topology
    setQuickActive("");
    setRunningConfigOpen(false);
    setIfaceWidgetOpen(false);
    setIfaceDetailWidgetOpen(false);
    setFleetInvOpen(false);
    setFleetMediaOpen(false);
    setIpMacSearchOpen(false);
    setFabricsHealthWidgetOpen(false);
    setFabricHealthWidgetOpen(false);
    setFabricTopoOpen(false);
  }

  // Open the read-only Fabric Topology diagram. Close every tier-3 widget
  // first (CLAUDE.md modal-stacking rule), then open with an optional
  // pre-selected fabric (NL "show topology for <fabric>"); empty → picker.
  function handleOpenFabricTopology(fabricName?: string) {
    closeAllTier3Widgets();
    setQuickActive("");
    setFabricTopoName(fabricName || "");
    setFabricTopoOpen(true);
    setActiveTab("console");
  }

  // ── Fleet inventory / media / compass openers ──────────────────────
  // Each closes the other tier-2 console widgets first (so they don't
  // stack), sets the filter/fabric scope, opens the widget, switches to
  // the console tab, and kicks off the hook fetch. The open useEffect
  // also fires refresh() on open — calling it here makes the first
  // paint immediate instead of waiting a tick.
  function handleOpenFleetInventory(filter?: string, fabric?: string) {
    closeAllConsoleWidgets();
    setFleetInvFilter(filter || "");
    setFleetInvFabric(fabric || "");
    setFleetInvOpen(true);
    setActiveTab("console");
    void fleetInv.refresh();
  }

  function handleOpenFleetMedia(filter?: string, fabric?: string) {
    closeAllConsoleWidgets();
    setFleetMediaFilter(filter || "");
    setFleetMediaFabric(fabric || "");
    setFleetMediaOpen(true);
    setActiveTab("console");
    void fleetMedia.refresh();
  }

  // Compass opener. Empty query → blank search box (operator types).
  // Non-empty query (+ optional scope IPs) → the widget auto-fires on
  // open. Fed from the bare "compass" keyword and "where is X" NL.
  function handleOpenIpMacSearch(query: string, scopeIps: string[]) {
    closeAllConsoleWidgets();
    setIpMacSearchQuery(query);
    setIpMacSearchScope(scopeIps);
    setIpMacSearchOpen(true);
    setActiveTab("console");
  }

  /** Close every tier-2 result widget pinned to the AI Console.
   *
   *  Tier-2 widgets are the inline panels that render under the NL prompt
   *  (FleetInventory, PortStats, Firmware version, Tenant table, etc.).
   *  They survive tier-3 modal open/close (intentional — operator can
   *  open Plan Detail without losing the data they were just looking at)
   *  but SHOULD clear when a new "answer flow" starts: NL submit, quick
   *  action, AI skill run.
   *
   *  Also closes the Firmware Upgrade wizard for the same reason as the
   *  NL reset block — it's a lifecycle wizard the operator has clearly
   *  moved on from when they start a new query.
   *
   *  Use this BESIDE (not instead of) closeAllTier3Widgets() when you
   *  also want to close PlanDetail / Admin panels. Most callers want
   *  just this one — the user submitted a new question, not a new
   *  modal-open intent. */
  function closeAllConsoleWidgets() {
    setRunningConfigOpen(false);
    setIfaceWidgetOpen(false);
    setIfaceDetailWidgetOpen(false);
    setClockWidgetOpen(false);
    setMediaWidgetOpen(false);
    setFleetInvOpen(false);
    setFleetMediaOpen(false);
    setIpMacSearchOpen(false);
    setPortStatsWidgetOpen(false);
    setIpIfaceWidgetOpen(false);
    setArpTableWidgetOpen(false);
    setLldpNeighWidgetOpen(false);
    setMaintRateWidgetOpen(false);
    setVlanBriefWidgetOpen(false);
    setVrfSummaryWidgetOpen(false);
    setFirmwareWidgetOpen(false);
    setFabricHealthWidgetOpen(false);
    setMonitorHealthWidgetOpen(false);
    setTenantWidgetOpen(false);
    setEpgWidgetOpen(false);
    setTenantHistoryWidgetOpen(false);
    setSwVerWidgetOpen(false);
    setFabricsHealthWidgetOpen(false);
    setAlarmDetailsWidgetOpen(false);
    setBgpWidgetOpen(false);
  }

  // ── All Switch Clocks + NTP Sync handlers ──────────────────────────────
  async function handleOpenAllClocks(switchFilter?: string) {
    closeAllTier3Widgets();
    setAllClocksOpen(true);
    setAllClocksLoading(true);
    setAllClocksData([]);
    setAllClocksNtpServer("");

    let switches = switchOptions.length > 0 ? switchOptions : [];
    if (switchFilter) {
      const f = switchFilter.toLowerCase();
      const filtered = switches.filter(
        (sw) => sw.ip === f || sw.ip.includes(f) || (sw.name || "").toLowerCase() === f || (sw.name || "").toLowerCase().includes(f)
      );
      if (filtered.length > 0) switches = filtered;
    }
    setAllClocksQueryCount(switches.length);
    if (switches.length === 0) {
      setAllClocksLoading(false);
      return;
    }

    const results = await Promise.allSettled(
      switches.map(async (sw) => {
        const [clockRes, fwRes] = await Promise.all([
          postJSON<any>("/api/invoke", {
            tool: "restconf_get_clock",
            inputs: { switch_ip: sw.ip },
          }),
          postJSON<any>("/api/invoke", {
            tool: "restconf_show_firmware_version",
            inputs: { switch_ip: sw.ip },
          }).catch(() => null),
        ]);
        const clockPayload = clockRes?.result?.payload ?? clockRes?.payload ?? {};
        const clockSummary = clockPayload?.summary ?? {};
        const fwPayload = fwRes?.result?.payload ?? fwRes?.payload ?? {};
        const fwSummary = fwPayload?.summary ?? {};
        return {
          ip: sw.ip,
          name: sw.name || sw.ip,
          currentTime: clockSummary.current_time || new Date().toISOString(),
          timezone: clockSummary.timezone || "UTC",
          uptime: fwSummary.system_uptime || "",
          source: clockSummary.source || "",
        };
      })
    );

    const data = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return {
        ip: switches[i].ip,
        name: switches[i].name || switches[i].ip,
        currentTime: "",
        timezone: "",
        uptime: "",
        source: "",
        error: "Failed to fetch clock",
      };
    });

    setAllClocksData(data);
    setAllClocksLoading(false);
  }

  // NTP sync is a mutation flow (removed in the lean community client —
  // read-only). The All Clocks modal still renders its NTP field; submit
  // is a no-op stub so the read-only clock view keeps working.
  function handleSubmitNtpSync() {
    /* read-only build: NTP push disabled */
  }

  function handleOpenAdminActivity() {
    closeAllTier3Widgets();
    setAdminActivityOpen(true);
    // loadAudit() runs via useEffect when adminActivityOpen flips true.
  }

  async function handleOpenAdminSettings() {
    closeAllTier3Widgets();
    setAdminSettingsOpen(true);
    setAdminSettingsLoading(true);
    setAdminSettingsErr("");
    try {
      const r = await getJSON<any>("/api/client-settings");
      setAdminSettings(r ?? {});
    } catch (e: any) {
      setAdminSettingsErr(e.message ?? "Failed to load settings");
    } finally {
      setAdminSettingsLoading(false);
    }
  }

  // Persist a single client-settings key (used by the MCP-server /
  // Ollama config sections composed into the Server Settings panel).
  // Mirrors the runtime-settings PATCH but flashes a "✓ saved" hint.
  async function saveClientSetting(key: string, value: any) {
    try {
      setAdminSettingsErr("");
      await patchJSON<any>("/api/client-settings", { [key]: value });
      setAdminSettings((prev) => ({
        ...prev,
        [key]: key.includes("secret") || key.includes("password") || key.includes("token") ? "***" : value,
      }));
      setSavedFlash(key);
      setTimeout(() => setSavedFlash((cur) => (cur === key ? "" : cur)), 1800);
    } catch (err: any) { setAdminSettingsErr(err.message ?? "Failed to update"); }
  }

  // Tool-result widget dispatch table.
  //
  // A declarative table for openWidgetForTool. Each entry knows its tool
  // name, its open setter, and any extra per-widget state init
  // (filter/sort/tab resets). The dispatcher iterates this once to close
  // all, then finds + opens the matching entry.
  //
  // Lives inside the component body because the setters are React
  // setState handles closed over hook scope.
  // The setOpen type is the loose `(v: boolean) => void` rather than
  // React.Dispatch<SetStateAction<boolean>> because some setters in
  // this codebase are wrapped/normalized to that simpler shape (e.g.
  // setters threaded through hooks). The dispatcher only ever calls
  // setOpen(true) / setOpen(false) — never the functional-update form
  // — so the wider type is safe.
  const toolResultWidgetDispatch: Array<{
    tool: string;
    setOpen: (v: boolean) => void;
    onOpen?: () => void;
  }> = [
    { tool: "restconf_get_running_config",                       setOpen: setRunningConfigOpen },
    { tool: "restconf_get_interface_all",                        setOpen: setIfaceWidgetOpen,
      onOpen: () => {
        setIfaceFilter("all");
        setIfaceSort({ col: "name", dir: "asc" });
      } },
    { tool: "restconf_get_interface_detail",                     setOpen: setIfaceDetailWidgetOpen,
      onOpen: () => {
        setIfaceDetailFilter("all");
        setIfaceDetailSort({ col: "name", dir: "asc" });
        setIfaceDetailTab("overview");
      } },
    { tool: "restconf_get_clock",                                setOpen: setClockWidgetOpen },
    { tool: "restconf_get_media_detail",                         setOpen: setMediaWidgetOpen },
    { tool: "restconf_get_port_statistics_summary",              setOpen: setPortStatsWidgetOpen },
    { tool: "restconf_get_ip_interface",                         setOpen: setIpIfaceWidgetOpen },
    { tool: "restconf_get_arp_table",                            setOpen: setArpTableWidgetOpen },
    { tool: "restconf_get_lldp_neighbor_detail",                 setOpen: setLldpNeighWidgetOpen },
    { tool: "restconf_get_system_maintenance_rate_monitoring",   setOpen: setMaintRateWidgetOpen },
    { tool: "restconf_get_vlan_brief",                           setOpen: setVlanBriefWidgetOpen },
    { tool: "restconf_get_vrf_summary",                          setOpen: setVrfSummaryWidgetOpen },
    { tool: "restconf_show_firmware_version",                    setOpen: setFirmwareWidgetOpen },
    { tool: "fabric_get_fabric_health_summary",                  setOpen: setFabricHealthWidgetOpen },
    { tool: "monitor_get_health",                                setOpen: setMonitorHealthWidgetOpen },
    { tool: "tenant_get_tenants",                                setOpen: setTenantWidgetOpen },
    { tool: "tenant_get_all_endpoint_groups",                    setOpen: setEpgWidgetOpen },
    { tool: "fabric_get_fabrics_health",                         setOpen: setFabricsHealthWidgetOpen },
    // Direct run of inventory_getswitches opens the sortable fleet
    // inventory table (instead of the dashboard donut). onOpen resets
    // the filter/fabric scope and kicks the hook's parallel fetch.
    { tool: "inventory_getswitches",                             setOpen: setFleetInvOpen,
      onOpen: () => {
        setFleetInvFilter("");
        setFleetInvFabric("");
        void fleetInv.refresh();
      } },
    { tool: "fault_get_alarm_details_with_context",              setOpen: setAlarmDetailsWidgetOpen },
    { tool: "tenant_get_service_epg_historical_report_stub",     setOpen: setTenantHistoryWidgetOpen },
    { tool: "inventory_get_software_version_mismatch",           setOpen: setSwVerWidgetOpen },
    { tool: "restconf_get_bgp_summary",                          setOpen: setBgpWidgetOpen },
  ];

  function openWidgetForTool(tool: string) {
    // Close ALL tier 3/4 modals + lifecycle wizards via the shared helper.
    // Without this, an open modal would stay on top of the newly-opened
    // result widget.
    closeAllTier3Widgets();
    // Operators who move on to another widget (NL query, quick action, or
    // any tool-result render) usually mean "I'm done with that, answer
    // this instead." Other tier-3 modals (PlanDetail, Admin panels)
    // DELIBERATELY stay open via the dispatcher above because operators
    // often query NL to verify state mid-workflow.
    // Close every tool-result widget via the registry, then open the
    // matching one. Removes the 30-line if/else chain that used to live
    // here. Adding a new tool-result widget = one entry in the table
    // above (no edits to this function).
    for (const entry of toolResultWidgetDispatch) entry.setOpen(false);
    const match = toolResultWidgetDispatch.find((e) => e.tool === tool);
    if (match) {
      match.setOpen(true);
      match.onOpen?.();
    }
  }

  // Per-skill quick-run config. Each AI Agent button in the AI Console
  // calls runAgentSkill with one of these. To add a new skill: add a
  // backend/agent_skills/<name>.md, append an entry here, and (in the
  // Console JSX) a new button that calls runAgentSkill with the key.
  //
  // `defaultQuery` is what the agent receives when the user clicks the
  // button without typing anything — the skill is expected to handle
  // these bare queries (auto-discover fabric, etc.). The skill prompt
  // is the source of truth for that behavior.
  const AGENT_SKILLS: Record<string, {
    skill: string;
    defaultQuery: string;
    buttonLabel: string;        // short label rendered in the dropdown row
    panelDisplayName: string;   // shown in the result panel title
    description: string;        // 1-line description in the dropdown row
    verb: string;               // "Investigating" / "Verifying" / etc.
    accent: string;             // dot color in dropdown row
    /** When set, clicking the skill with no relevant input in the text box
     *  opens a small modal asking for the specified field(s). The values
     *  get composed into a query string before the skill runs. */
    inputPrompt?: {
      title: string;
      fields: { key: string; label: string; placeholder?: string; required?: boolean }[];
      composeQuery: (vals: Record<string, string>, originalText: string) => string;
      // Optional predicate: if returns true on the current text, skip the prompt
      // (because the user already typed enough info). Default: skip if any IP
      // address is present in the text.
      skipIf?: (text: string) => boolean;
    };
  }> = {
    investigate: {
      skill: "fabric-health-investigation",
      defaultQuery: "investigate the health of the network",
      buttonLabel: "Investigate",
      panelDisplayName: "Fabric Health Investigation",
      description: "Diagnose why a fabric is unhealthy — chains alarms → BGP → interfaces → firmware checks.",
      verb: "Investigating",
      accent: "#a78bfa",
    },
    preflightUpgrade: {
      skill: "pre-firmware-upgrade-check",
      defaultQuery: "check if we are ready to upgrade firmware",
      buttonLabel: "Pre-flight Upgrade Check",
      panelDisplayName: "Pre-Firmware-Upgrade Readiness Check",
      description: "Go/no-go gate before a firmware upgrade: storage, alarms, BGP, version baseline, reachability, drift.",
      verb: "Pre-checking",
      accent: "#fbbf24",
    },
    verifyUpgrade: {
      skill: "post-firmware-upgrade-verification",
      defaultQuery: "verify the most recent firmware upgrade",
      buttonLabel: "Verify Upgrade",
      panelDisplayName: "Post-Firmware-Upgrade Verification",
      description: "5-point checklist after a firmware upgrade: version, commit state, reachability, BGP, alarms.",
      verb: "Verifying",
      accent: "#34d399",
    },
    safeFabricCleanup: {
      skill: "safe-fabric-cleanup",
      defaultQuery: "is this fabric safe to delete?",
      buttonLabel: "Safe Fabric Cleanup",
      panelDisplayName: "Safe Fabric Cleanup (proposal-capable)",
      description: "Audits a named fabric (zero switches? long-stale status? no recent activity?) and proposes deletion if safe. The first skill that ENDS in a gated mutation — operator approves to execute.",
      verb: "Auditing",
      accent: "#fb7185",
      // The skill needs a fabric name. Prompt if the user didn't type one
      // we recognize. Same UX pattern as Pre-RMA Check.
      inputPrompt: {
        title: "Safe Fabric Cleanup — which fabric?",
        fields: [
          { key: "fabricName", label: "Fabric name (required)", placeholder: "e.g. lab-decom-old", required: true },
        ],
        composeQuery: (vals, originalText) => {
          const f = (vals.fabricName || "").trim();
          const base = (originalText.trim() || "is this fabric safe to delete?");
          return f ? `${base} fabric ${f}` : base;
        },
        // Skip the prompt if the operator already mentioned a fabric name
        // anywhere in the text — same heuristic as the RMA skill.
        skipIf: (text) => /\bfabric\s+[A-Za-z0-9_\-]+/i.test(text),
      },
    },
    decommissionStaleSwitch: {
      skill: "decommission-stale-switch",
      defaultQuery: "is this switch safe to decommission?",
      buttonLabel: "Decommission Stale Switch",
      panelDisplayName: "Decommission Stale Switch (proposal-capable)",
      description: "Audits a switch IP for long-unreachability, absence of recent activity, and no non-unreachable alarms. Proposes inventory_delete_switch if safe. Second proposal_capable skill — proves the pattern from Safe Fabric Cleanup generalizes per-device.",
      verb: "Auditing switch",
      accent: "#f97316",
      // Skill needs the switch IP. Same pattern as Pre-RMA: prompt if
      // not present in the text, skip if it is.
      inputPrompt: {
        title: "Decommission Stale Switch — which switch?",
        fields: [
          { key: "switchIp", label: "Switch IP (required)", placeholder: "e.g. 10.9.140.31", required: true },
        ],
        composeQuery: (vals, originalText) => {
          const ip = (vals.switchIp || "").trim();
          const base = (originalText.trim() || "is this switch safe to decommission?");
          return ip ? `${base} switch ${ip}` : base;
        },
        skipIf: (text) => /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text),
      },
    },
    decommissionTenantFully: {
      skill: "decommission-tenant-fully",
      defaultQuery: "decommission this tenant fully",
      buttonLabel: "Decommission Tenant Fully",
      panelDisplayName: "Decommission Tenant Fully (chained proposal)",
      description: "Enumerates a tenant's VRFs + EPGs and proposes a CHAINED decommissioning — delete each attachment, then the tenant itself, as a single approve-or-reject. Sixth proposal_capable skill and the first to emit multi-step proposals.",
      verb: "Building chain for tenant",
      accent: "#e879f9",
      inputPrompt: {
        title: "Decommission Tenant Fully — which tenant?",
        fields: [
          { key: "tenantName", label: "Tenant name (required)", placeholder: "e.g. lab-experiment-2025", required: true },
        ],
        composeQuery: (vals, originalText) => {
          const t = (vals.tenantName || "").trim();
          const base = (originalText.trim() || "decommission this tenant fully");
          return t ? `${base} tenant ${t}` : base;
        },
        skipIf: (text) => /\btenant\s+[A-Za-z0-9_\-]+/i.test(text),
      },
    },
    retireUnusedTenant: {
      skill: "retire-unused-tenant",
      defaultQuery: "is this tenant safe to retire?",
      buttonLabel: "Retire Unused Tenant",
      panelDisplayName: "Retire Unused Tenant (proposal-capable)",
      description: "Audits a tenant for zero-attachment status (no VRFs, no EPGs, no port-channels, no recent activity) and proposes tenant_delete if safe. Third proposal_capable skill — covers the application overlay tier after fabric (#5) and switch (#6) levels.",
      verb: "Auditing tenant",
      accent: "#a855f7",
      // Skill needs a tenant name. Same prompt/skip pattern as the
      // fabric cleanup skill.
      inputPrompt: {
        title: "Retire Unused Tenant — which tenant?",
        fields: [
          { key: "tenantName", label: "Tenant name (required)", placeholder: "e.g. lab-old-test", required: true },
        ],
        composeQuery: (vals, originalText) => {
          const t = (vals.tenantName || "").trim();
          const base = (originalText.trim() || "is this tenant safe to retire?");
          return t ? `${base} tenant ${t}` : base;
        },
        // Skip prompt if operator already typed a tenant name.
        skipIf: (text) => /\btenant\s+[A-Za-z0-9_\-]+/i.test(text),
      },
    },
    orphanedPortChannel: {
      skill: "orphaned-port-channel",
      defaultQuery: "is this port-channel safe to delete?",
      buttonLabel: "Orphaned Port-Channel",
      panelDisplayName: "Orphaned Port-Channel (proposal-capable)",
      description: "Audits a single port-channel (inside a named tenant) for orphan status: no member interfaces, no EPG binding, no recent activity. Proposes tenant_delete_portchannel if safe. Seventh proposal_capable skill — physical-layer cleanup target.",
      verb: "Auditing port-channel",
      accent: "#14b8a6",
      inputPrompt: {
        title: "Orphaned Port-Channel — which PC in which tenant?",
        fields: [
          { key: "tenantName", label: "Tenant name (required)", placeholder: "e.g. lab-staging", required: true },
          { key: "poName",     label: "Port-channel name (required)", placeholder: "e.g. po-test-bundle", required: true },
        ],
        composeQuery: (vals, originalText) => {
          const t = (vals.tenantName || "").trim();
          const p = (vals.poName || "").trim();
          const base = (originalText.trim() || "is this port-channel safe to delete?");
          if (t && p) return `${base} tenant ${t} port-channel ${p}`;
          if (p) return `${base} port-channel ${p}`;
          return base;
        },
        skipIf: (text) => /\btenant\s+[A-Za-z0-9_\-]+/i.test(text) && /\b(po|port[\s-]?channel)\s+[A-Za-z0-9_\-]+/i.test(text),
      },
    },
    orphanedEndpointGroup: {
      skill: "orphaned-endpoint-group",
      defaultQuery: "is this EPG safe to delete?",
      buttonLabel: "Orphaned EPG",
      panelDisplayName: "Orphaned Endpoint Group (proposal-capable)",
      description: "Audits a single EPG (inside a named tenant) for orphan status: no port-channels attached, no errors, no recent activity. Proposes tenant_delete_endpoint_group if safe. Fifth proposal_capable skill — sibling to clean-orphaned-vrf at the L2 attachment tier.",
      verb: "Auditing EPG",
      accent: "#22d3ee",
      inputPrompt: {
        title: "Orphaned EPG — which EPG in which tenant?",
        fields: [
          { key: "tenantName", label: "Tenant name (required)", placeholder: "e.g. lab-test", required: true },
          { key: "epgName",    label: "EPG name (required)",    placeholder: "e.g. experiment-l2", required: true },
        ],
        composeQuery: (vals, originalText) => {
          const t = (vals.tenantName || "").trim();
          const e = (vals.epgName || "").trim();
          const base = (originalText.trim() || "is this EPG safe to delete?");
          if (t && e) return `${base} tenant ${t} epg ${e}`;
          if (e) return `${base} epg ${e}`;
          return base;
        },
        skipIf: (text) => /\btenant\s+[A-Za-z0-9_\-]+/i.test(text) && /\b(epg|endpoint[\s-]?group)\s+[A-Za-z0-9_\-]+/i.test(text),
      },
    },
    cleanOrphanedVrf: {
      skill: "clean-orphaned-vrf",
      defaultQuery: "is this VRF safe to delete?",
      buttonLabel: "Clean Orphaned VRF",
      panelDisplayName: "Clean Orphaned VRF (proposal-capable)",
      description: "Audits a single VRF (inside a named tenant) for orphan status: no static routes, no BGP peers, no recent activity, no errors. Proposes tenant_delete_vrf if safe. Fourth proposal_capable skill — finest-grained mutation target so far.",
      verb: "Auditing VRF",
      accent: "#06b6d4",
      // Skill needs BOTH a tenant name and a VRF name — two-field prompt.
      inputPrompt: {
        title: "Clean Orphaned VRF — which VRF in which tenant?",
        fields: [
          { key: "tenantName", label: "Tenant name (required)", placeholder: "e.g. lab-test", required: true },
          { key: "vrfName",    label: "VRF name (required)",    placeholder: "e.g. experiment-dev", required: true },
        ],
        composeQuery: (vals, originalText) => {
          const t = (vals.tenantName || "").trim();
          const v = (vals.vrfName || "").trim();
          const base = (originalText.trim() || "is this VRF safe to delete?");
          if (t && v) return `${base} tenant ${t} vrf ${v}`;
          if (v) return `${base} vrf ${v}`;
          return base;
        },
        // Skip the prompt if the operator already typed both a tenant
        // and a VRF reference inline.
        skipIf: (text) => /\btenant\s+[A-Za-z0-9_\-]+/i.test(text) && /\bvrf\s+[A-Za-z0-9_\-]+/i.test(text),
      },
    },
    rmaCheck: {
      skill: "pre-rma-check",
      defaultQuery: "check rma readiness",
      buttonLabel: "Pre-RMA Check",
      panelDisplayName: "Pre-RMA Readiness Check",
      description: "Go/no-go gate before a switch RMA: failed-switch ID, unreachability, MCT partner health, new-switch reachability, model match, fabric baseline.",
      verb: "Checking RMA",
      accent: "#f87171",
      // The skill needs at minimum a failed-switch IP to do anything useful.
      // If the user hasn't typed an IP, prompt for it so we don't waste a run
      // on cannot_check_no_target.
      inputPrompt: {
        title: "Pre-RMA Check — required inputs",
        fields: [
          { key: "failedIp", label: "Failed switch IP (required)", placeholder: "e.g. 10.9.140.31", required: true },
          { key: "newIp", label: "New switch IP (optional)", placeholder: "e.g. 10.9.140.99 — leave blank if not yet provisioned" },
        ],
        composeQuery: (vals, originalText) => {
          const f = (vals.failedIp || "").trim();
          const n = (vals.newIp || "").trim();
          const base = (originalText.trim() || "rma check");
          if (f && n) return `${base} on ${f} to ${n}`;
          if (f) return `${base} on ${f}`;
          return base;
        },
        // If the text already contains an IP, skip the prompt — user gave us
        // what we need.
        skipIf: (text) => /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text),
      },
    },
  };
  type AgentSkillKey = keyof typeof AGENT_SKILLS;

  async function runAgentSkill(skillKey: AgentSkillKey) {
    const cfg = AGENT_SKILLS[skillKey];
    // AI Agent buttons are self-contained — they run the skill's defined
    // canned query (or open the skill's input modal). They DO NOT silently
    // pick up whatever happens to be in the prompt box. The prompt box is
    // for free-form chat (type + Enter); the agent buttons are dedicated
    // skill launchers with predictable scope.
    //
    // Earlier behaviour pulled `text.trim() || cfg.defaultQuery` here, which
    // meant a user with stale text in the box (e.g. "add 5 switches to
    // lab-b") who later clicked "Investigate" got an LLM refusal because
    // the read-only Investigate skill received the stale switch-add query.
    // That was confusing and non-obvious — fixed.
    if (cfg.inputPrompt) {
      // Always open the skill's input modal. The modal collects the fields
      // the skill actually needs (e.g. the failed-switch IP for Pre-RMA).
      // No silent bypass.
      //
      // Convenience pre-fill: if the prompt box happens to contain an
      // IP address AND the modal has a field whose key suggests it's
      // an IP target, seed that field with the first IP we found. The
      // operator sees the pre-filled value, can edit / clear / accept.
      // No surprise.
      setSkillPromptSkillKey(skillKey);
      const ipMatch = text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      const initial: Record<string, string> = {};
      if (ipMatch) {
        const ipKeyField = cfg.inputPrompt.fields.find((f) =>
          /ip\b|address|target/i.test(f.key) || /ip\b|address/i.test(f.label)
        );
        if (ipKeyField) initial[ipKeyField.key] = ipMatch[0];
      }
      setSkillPromptValues(initial);
      setSkillPromptError("");
      setSkillPromptOpen(true);
      return;
    }
    // No inputPrompt — run the skill's canned default query.
    return runAgentSkillWithQuery(skillKey, cfg.defaultQuery);
  }

  async function runAgentSkillWithQuery(skillKey: AgentSkillKey, query: string) {
    const cfg = AGENT_SKILLS[skillKey];
    // Clear tier-2 console widgets (FleetInventory, PortStats, Firmware
    // version, etc.) before opening the Investigate modal — otherwise
    // the stale widget sits visible below the modal and looks like part
    // of the new answer. Same intent as the reset blocks in runNL /
    // runNLWithText: a new "answer flow" wipes the previous one's
    // visible artefacts. Tier-3 modals (PlanDetail, Admin panels) stay
    // because operators commonly run an AI skill alongside one.
    closeAllConsoleWidgets();
    // Also wipe the previous NL response — the viz panel (device_health,
    // donut, bar, ha_health, exec_diagnostic, etc.) renders directly
    // from `resp` via a useMemo and is gated independently of the
    // per-widget flags above. Without this, a previous "device health"
    // viz block stays visible below the Investigate modal.
    setResp(null);
    setInvestigateActiveSkillKey(skillKey);
    setInvestigateRunning(true);
    setInvestigateOpen(true);
    setInvestigateResult(null);
    setInvestigateLiveTrace([]);
    setInvestigateTraceOpen(true);  // auto-open trace during streaming so user sees progress
    setErr("");

    const body: any = { query, skill: cfg.skill };

    try {
      // SSE consumer lives in lib/api.ts:streamSSE. The reusable helper
      // is the consumer pair to backend/core/sse.py:queue_stream —
      // together they stream a long-running tool's progress to the
      // operator.
      let gotDone = false;
      await streamSSE<any>("/api/agent/investigate/stream", body, {
        onEvent: (ev) => {
          if (ev.kind === "done") {
            gotDone = true;
            setInvestigateResult(ev);
          } else if (ev.kind === "error") {
            setInvestigateResult({ error: ev.error || "Investigation failed" });
            gotDone = true;
          } else {
            setInvestigateLiveTrace((prev) => [...prev, ev]);
          }
        },
        onHttpError: (status) => {
          // streamSSE returns instead of throwing when onHttpError is
          // set; convert to a thrown error here so the outer catch
          // triggers the non-streaming fallback below.
          throw new Error(`stream_http_${status}`);
        },
      });
      if (!gotDone) {
        // Connection closed without a done event. Surface a soft error.
        setInvestigateResult({ error: "Stream ended without a final 'done' event." });
      }
    } catch (streamErr: any) {
      // Fall back to the non-streaming endpoint. Keeps a working agent on
      // any reverse-proxy / network setup that doesn't pass SSE cleanly.
      try {
        const res = await postJSON<any>("/api/agent/investigate", body);
        setInvestigateResult(res);
      } catch (e: any) {
        setInvestigateResult({
          error: `Streaming failed (${streamErr?.message ?? "unknown"}); fallback also failed: ${e?.message ?? "unknown"}`,
        });
      }
    } finally {
      setInvestigateRunning(false);
    }
  }

  async function runNL() {
    const reqId = ++nlReqSeq.current;
		setNlRunning(true);
		// nlElapsedMs is now driven by useElapsedMsWhile(nlRunning).
    setErr("");
    setResp(null);
    setRunningConfigOpen(false);
    setRunningConfigFullscreen(false);
    setIfaceWidgetOpen(false);
    setIfaceDetailWidgetOpen(false);
    setClockWidgetOpen(false);
    setMediaWidgetOpen(false);
    setFleetInvOpen(false);
    setFleetMediaOpen(false);
    setIpMacSearchOpen(false);
    setPortStatsWidgetOpen(false);
    setIpIfaceWidgetOpen(false);
    setArpTableWidgetOpen(false);
    setLldpNeighWidgetOpen(false);
    setMaintRateWidgetOpen(false);
    setVlanBriefWidgetOpen(false);
    setVrfSummaryWidgetOpen(false);
    setFirmwareWidgetOpen(false);
    setFabricHealthWidgetOpen(false);
    setMonitorHealthWidgetOpen(false);
    setTenantWidgetOpen(false);
    setEpgWidgetOpen(false);
    setTenantHistoryWidgetOpen(false);
    setSwVerWidgetOpen(false);

    // ── Compass (IP / MAC / port / VLAN search) intent ───────────────────────
    // "compass" (bare) opens the empty search box; "where is X" / "find X" /
    // "what's on port X" / "show MACs in VLAN N" opens it pre-filled and
    // auto-fires. parseCompassPrompt classifies; App.tsx applies via setters.
    {
      const compass = parseCompassPrompt(text, switchOptions);
      if (compass.kind === "open_empty") {
        setNlRunning(false);
        handleOpenIpMacSearch("", []);
        return;
      }
      if (compass.kind === "open_with_query") {
        setNlRunning(false);
        handleOpenIpMacSearch(compass.query, compass.scopeIps);
        return;
      }
      // compass.kind === "no_match" → fall through to the other detectors.
    }

    // ── Plan intent detection ─────────────────────────────────────────────────
    const planIntent = detectPlanIntent(text.trim());
    if (planIntent) {
      setNlRunning(false);

      if ((planIntent as any).kind === "show_help") {
        setNlRunning(false);
        setHelpWidgetOpen(true);
        return;
      }

      if (planIntent.kind === "fabrics_health") {
        setText("");
        runNLWithText(text.trim() || "show fabric health", { force_tool: "fabric_get_fabric_health_summary", force_inputs: {} });
      } else if (planIntent.kind === "show_all_clocks") {
        handleOpenAllClocks(planIntent.switchFilter);
      } else if (planIntent.kind === "show_switches") {
        setText("");
        runNLWithText(text.trim() || "show switches", { force_tool: "inventory_get_switches_widget_table", force_inputs: {} });
      } else if (planIntent.kind === "direct_tool") {
        const promptMsg = (planIntent.inputs as any)?.__prompt;
        if (promptMsg && !planIntent.tool) {
          // Ambiguous command — show helpful prompt instead of calling a tool
          setResp({
            tool: "",
            text: promptMsg,
            summary: promptMsg,
            raw: { picked: { text: text.trim(), intent: "ambiguous" } },
            picked: { text: text.trim(), intent: "ambiguous" },
          } as any);
          setViewMode("summary");
          return;
        }
        setText("");
        runNLWithText(text.trim() || planIntent.label, { force_tool: planIntent.tool, force_inputs: planIntent.inputs ?? {} });
      } else if ((planIntent as any).kind === "pick_switch") {
        const action = (planIntent as any).action;
        setSwitchPickerTitle(
          action === "interfaces" ? "Show interfaces — select a switch" : "Select a switch"
        );
        switchPickerCallback.current = (ip: string, _name: string) => {
          setSwitchPickerOpen(false);
          if (action === "interfaces") {
            runNLWithText(`show interfaces on switch ${ip}`, {
              force_tool: "restconf_get_interface_all",
              force_inputs: { switch_ip: ip },
            });
          }
        };
        setSwitchPickerOpen(true);
        return;
      }
      return;
    }

    // ── LLDP client-side routing ─────────────────────────────────────────────
    // Intercept common LLDP phrasings before sending to the NL backend so the
    // right mode (neighbor widget vs topology map) is triggered deterministically.
    // Resolve switch names → IPs in the text before LLDP detection
    let lldpText = text.trim();
    if (!/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(lldpText) && switchOptions.length > 0) {
      const tLower = lldpText.toLowerCase();
      for (const sw of switchOptions) {
        if (sw.name && sw.ip && tLower.includes(sw.name.toLowerCase())) {
          lldpText = lldpText.replace(new RegExp(sw.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), sw.ip);
          break;
        }
      }
    }
    const lldpIntent = detectLldpIntent(lldpText);
    if (lldpIntent) {
      setNlRunning(false); // we handle this outside the NL pipeline
      if (lldpIntent.kind === "neighbor_detail") {
        // Single-switch detail → runNLWithText (keeps resp/picked in sync)
        await runNLWithText(`Show LLDP neighbors for switch ${lldpIntent.ip}.`, {
          llm_mode: "deterministic",
          force_tool: "restconf_get_lldp_neighbor_detail",
          force_inputs: { switch_ip: lldpIntent.ip },
          include_raw: true,
        });
      } else {
        // Topology map — possibly with a new seed IP and/or depth
        const seedIp = lldpIntent.seedIp ?? lldpSeedIp;
        const depth  = lldpIntent.depth  ?? lldpDepth;
        if (lldpIntent.seedIp) setLldpSeedIp(lldpIntent.seedIp);
        if (lldpIntent.depth)  setLldpDepth(lldpIntent.depth);
        setQuickActive("lldp_topology");
        setForcedTool(null);
        setForcedInputs({});
        setActiveTab("console");
        setIncludeRaw(true);
        await buildLldpTopology(seedIp, depth);
      }
      return;
    }
    // ── Fabric topology intent ────────────────────────────────────────────────
    // "show topology" / "fabric topology" / "show topology for <fabric>"
    // (no switch IP, no "lldp") opens the read-only FabricTopologyView. The
    // detector returns no-match for LLDP / IP-seeded prompts so the existing
    // LLDP map flow above keeps its cases.
    const fabricTopoIntent = detectFabricTopologyIntent(text);
    if (fabricTopoIntent.matched) {
      setNlRunning(false); // handled outside the NL pipeline
      handleOpenFabricTopology(fabricTopoIntent.fabricName || undefined);
      return;
    }
    // ── Search-by-serial intent → Fleet Inventory ─────────────────────────────
    // "find switch with serial X" / "where is sn FLN…" — opens the fleet
    // inventory table pre-filtered to the serial. The widget's free-text
    // filter already searches the serial column, so the row falls out.
    {
      const snHit = detectSerialSearchIntent(text.trim());
      if (snHit.matched && snHit.serial) {
        setNlRunning(false);
        handleOpenFleetInventory(snHit.serial, "");
        return;
      }
    }
    // ── Fleet media (transceiver / optics) intent → Fleet Media ───────────────
    // "show transceivers" / "list optics" / "media across the fabric" opens
    // the fan-out media table. If the operator scoped to ONE switch (by name
    // or IP), fall through to the standard NL pipeline — the single-switch
    // MediaWidget has the nicer per-port visual. Only the un-scoped /
    // fabric-level case opens the fleet aggregate here.
    {
      const mediaHit = detectFleetMediaInventoryIntent(text.trim());
      if (mediaHit.matched && !mediaHit.scopeName && !mediaHit.scopeIp) {
        setNlRunning(false);
        handleOpenFleetMedia("", mediaHit.scopeFabric || "");
        return;
      }
      // else: scoped to one switch → fall through to RESTCONF / LLM path.
    }
    // ── Fleet chassis inventory intent → Fleet Inventory ──────────────────────
    // "fleet inventory" / "chassis inventory" / "serial numbers for switches"
    // opens the sortable + exportable fleet table.
    {
      const fiHit = detectFleetInventoryIntent(text.trim());
      if (fiHit.matched) {
        setNlRunning(false);
        const scope = fiHit.scopeName || fiHit.scopeIp || "";
        handleOpenFleetInventory(scope, fiHit.scopeFabric || "");
        return;
      }
    }
    // ── Direct tool name detection ────────────────────────────────────────────
    // If the user typed the tool name verbatim, skip the LLM entirely.
    const directIntent = detectDirectToolCall(text.trim());
    if (directIntent) {
      setNlRunning(false); // runNLWithText will set it true again
      const tenantName = directIntent.tenantName ?? selectedTenantName;
      if (directIntent.tenantName) setSelectedTenantName(directIntent.tenantName);
      const extraInputs: Record<string, any> = {};
      if (directIntent.tool === "tenant_get_service_epg_historical_report_stub") {
        extraInputs.tenant_name    = tenantName;
        extraInputs.window_days    = historyWindowDays;
        extraInputs.allow_unscoped = historyAllowUnscoped;
      }
      await runNLWithText(
        `Run ${directIntent.tool}${tenantName ? ` for ${tenantName}` : ""}.`,
        {
          llm_mode: "deterministic",
          force_tool: directIntent.tool,
          force_inputs: extraInputs,
          include_raw: true,
        }
      );
      if (directIntent.tool === "tenant_get_service_epg_historical_report_stub") {
        setQuickActive("tenant_history");
      }
      return;
    }
    // ── Software version mismatch NL routing ─────────────────────────────────
    if (detectSwVersionIntent(text.trim())) {
      setNlRunning(false);
      await runNLWithText("Check software version consistency across all switches.", {
        llm_mode: "deterministic",
        force_tool: "inventory_get_software_version_mismatch",
        force_inputs: {},
        include_raw: true,
      });
      return;
    }
    // ── Fuzzy fallback: if no deterministic match AND no forced tool, show suggestions ──
    // ── Fuzzy fallback: only block truly unrecognizable input ──────────────
    // If the input contains known domain terms, let the LLM try.
    // Only show suggestions for gibberish / no recognizable terms.
    if (!forcedTool) {
      const DOMAIN_TERMS = /\b(ip|interface|vlan|vrf|route|routing|bgp|ospf|mac|arp|acl|qos|port|lag|mct|evpn|vxlan|nve|loopback|config|running|startup|snmp|syslog|ntp|aaa|radius|tacacs|ssh|telnet|http|https|rest|api|restconf|cli|show|run|exec|ping|trace|debug|monitor|log|sflow|span|mirror|multicast|igmp|pim|bfd|ecmp|hash|mtu|jumbo|storm|control|rate|limit|policy|prefix|community|neighbor|peer|session|adverti|redistribute|aggregate|summary|default|static|connected|learned|overlay|underlay|vtep|anycast|gateway|svi|irb|dhcp|dns|domain|hostname|management|oob|inband|console|serial|usb|firmware|upgrade|boot|reload|reboot|stack|virtual|chassis|slot|module|fan|power|temperature|cpu|memory|utilization|bandwidth|throughput|latency|jitter|packet|frame|error|drop|discard|crc|collision|duplex|speed|auto|negotiate|trunk|access|hybrid|native|tagged|untagged|allowed|blocked|forwarding|spanning|stp|rstp|mstp|loop|guard|root|bridge|priority|cost|designated|backup|alternate|edge|bpdu|filter|portfast|rapid|convergence|fabric|switch|device|spine|leaf|border|tenant|epg|endpoint|alarm|alert|fault|health|healthy|unhealthy|degraded|down|up|status|topology|inventory|deploy|destroy|certificate|cert|ssl|tls|drift|compliance|maintenance|window|outage|capacity|performance|version|mismatch|outdated|stale|environment|network|infrastructure|datacenter|data.center|xco|clos|cluster|node|service|platform|system|changed|happen|wrong|issue|problem|read(y|iness)|compare|differ|configure|establish|uplink|downlink|utiliz|anomal|investig|diagnos|troubleshoot|why|what|how|which|where|when|who|roce|rocev2|pfc|dscp|lossless|path)\b/i;
      // Also test with plurals stripped (VTEPs→VTEP, interfaces→interface, etc.)
      const textDepluralized = text.replace(/\b(\w{3,})s\b/gi, "$1");
      const hasDomainTerm = DOMAIN_TERMS.test(text) || DOMAIN_TERMS.test(textDepluralized);

      if (!hasDomainTerm) {
        // Define known command suggestions grouped by category
        const SUGGESTIONS: { cat: string; cmds: string[] }[] = [
          { cat: "Fabric", cmds: ["show fabrics", "check fabric health"] },
          { cat: "Switches", cmds: ["show switches", "list serial numbers", "show uptime"] },
          { cat: "Monitoring", cmds: ["show alarms", "check BGP status", "show software versions", "show uptime", "what's running", "is everything ok"] },
          { cat: "Tenants", cmds: ["show tenants", "show EPGs"] },
        ];
        const allCmds = SUGGESTIONS.flatMap((g) => g.cmds);
        const inputWords = new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
        const scored = allCmds.map((cmd) => {
          const cmdWords = cmd.toLowerCase().split(/\s+/);
          let score = 0;
          for (const w of cmdWords) {
            if (inputWords.has(w)) score += 2;
            else { for (const iw of inputWords) { if (iw.includes(w) || w.includes(iw)) { score += 1; break; } } }
          }
          return { cmd, score };
        }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

        const suggestionsHtml = scored.length > 0
          ? `Did you mean?\n\n${scored.map((s) => `  → ${s.cmd}`).join("\n")}\n\nOr try one of these:`
          : "I didn't recognize that command. Try:";
        const fullMsg = `${suggestionsHtml}\n\n${SUGGESTIONS.map((g) => `${g.cat}: ${g.cmds.join(", ")}`).join("\n")}`;

        setNlRunning(false);
        setResp({
          tool: "",
          text: fullMsg,
          summary: fullMsg,
          raw: { picked: { text: text.trim(), intent: "unrecognized" } },
          picked: { text: text.trim(), intent: "unrecognized" },
        } as any);
        setViewMode("summary");
        return;
      }
      // Has domain terms but no regex match — let LLM try
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      // Resolve switch names → IPs in the text before sending to LLM.
      //
      // We apply EVERY matching substitution (not just the first) so
      // multi-switch queries like "check Leaf-1 and Leaf-3" reach the
      // backend with all switches' IPs present, enabling per-switch
      // fan-out for tools that accept a single switch_ip per call.
      //
      // The leading no-IP guard is preserved so a query that already
      // contains IPs ("show clock on 10.9.140.41") doesn't get
      // double-processed.
      // Resolve switch NAMES → IPs (the backend only extracts literal IPs).
      // (lib/nl/switchNameToIp)
      let resolvedText = substituteSwitchNames(text, switchOptions);
      // Auto-heal stale inventory: if the prompt names a switch that didn't
      // resolve (and isn't a fabric), switchOptions may be stale — re-fetch
      // inventory once and retry. Fixes "check media on DC-Leaf6" 400-ing
      // against a switch that was added after the last inventory load.
      if (unresolvedSwitchRef(text, switchOptions)) {
        const fresh = await refreshSwitchOptions();
        if (fresh && fresh.length) resolvedText = substituteSwitchNames(text, fresh);
      }

      const payload: any = {
        text: resolvedText,
        include_raw: includeRaw,
        prefer_tier2: true,
      };

      // If a tool was selected from Tools tab, keep it deterministic when clicking Run.
      if (forcedTool) {
        payload.force_tool = forcedTool;
        payload.force_inputs = forcedInputs ?? {};
      }

      const r = await postJSON<NLResp>("/api/nl", payload);

      // Ignore stale responses (e.g., previous in-flight requests finishing late)
      if (reqId !== nlReqSeq.current) return;

      setResp(r);
      setViewMode(includeRaw ? "raw" : "summary");
      // Extract BGP data for widget
      if (r.picked?.tool === "restconf_get_bgp_summary") {
        const bgpPayload = r.raw?.result?.payload ?? r.raw?.payload ?? {};
        setBgpWidgetData(bgpPayload);
      }
      if (r.picked?.tool) openWidgetForTool(r.picked.tool);
    } catch (e: any) {
      if (reqId !== nlReqSeq.current) return;
      setErr(String(e?.message ?? e));
    } finally {
      if (reqId === nlReqSeq.current) setNlRunning(false);
    }
  }

  async function runNLWithText(
    t: string,
    extra?: { force_tool?: string; force_inputs?: any; include_raw?: boolean; llm_mode?: "deterministic" | "ollama" | "openai" }
  ) {
    const reqId = ++nlReqSeq.current;
		setNlRunning(true);
		// nlElapsedMs is now driven by useElapsedMsWhile(nlRunning).
    setErr("");
    setResp(null);
    setRunningConfigOpen(false);
    setRunningConfigFullscreen(false);
    setIfaceWidgetOpen(false);
    setIfaceDetailWidgetOpen(false);
    setClockWidgetOpen(false);
    setMediaWidgetOpen(false);
    setFleetInvOpen(false);
    setFleetMediaOpen(false);
    setIpMacSearchOpen(false);
    setPortStatsWidgetOpen(false);
    setIpIfaceWidgetOpen(false);
    setArpTableWidgetOpen(false);
    setLldpNeighWidgetOpen(false);
    setMaintRateWidgetOpen(false);
    setVlanBriefWidgetOpen(false);
    setVrfSummaryWidgetOpen(false);
    setFirmwareWidgetOpen(false);
    setFabricHealthWidgetOpen(false);
    setMonitorHealthWidgetOpen(false);
    setTenantWidgetOpen(false);
    setEpgWidgetOpen(false);
    setTenantHistoryWidgetOpen(false);
    setSwVerWidgetOpen(false);
    setText(t);

    // When the UI forces a tool, remember it so the Console Run button stays deterministic.
    if (extra?.force_tool) {
      setForcedTool(extra.force_tool);
      setForcedInputs(extra.force_inputs ?? {});
    }

    try {
      const wantsRaw = typeof extra?.include_raw === "boolean" ? extra.include_raw : includeRaw;

      // Routing:
      // - explicit per-request override via extra.llm_mode
      // - otherwise follow the UI toggle (nlMode)
      // "smart" mode = deterministic first on backend, fallback to OpenAI if no match
      const modeField =
        extra?.llm_mode === "openai" ? "openai"
          : extra?.llm_mode === "ollama" ? "ollama"
          : extra?.llm_mode === "deterministic" ? undefined
          : nlMode === "openai" ? "openai"
          : nlMode === "smart" ? "openai"
          : nlMode === "ollama" ? "ollama"
          : undefined;

      const body: any = {
        text: t,
        include_raw: wantsRaw,
        prefer_tier2: true,
      };

      if (modeField) body.llm_mode = modeField;
      if (extra?.force_tool) body.force_tool = extra.force_tool;
      if (extra?.force_inputs) body.force_inputs = extra.force_inputs;

      const r = await postJSON<NLResp>("/api/nl", body);

      if (reqId !== nlReqSeq.current) return;

      setResp(r);
      setViewMode(wantsRaw ? "raw" : "summary");
      if (r.picked?.tool === "restconf_get_bgp_summary") {
        const bgpPayload = r.raw?.result?.payload ?? r.raw?.payload ?? {};
        setBgpWidgetData(bgpPayload);
      }
      if (r.picked?.tool) openWidgetForTool(r.picked.tool);
    } catch (e: any) {
      if (reqId !== nlReqSeq.current) return;
      setErr(String(e?.message ?? e));
    } finally {
      if (reqId === nlReqSeq.current) setNlRunning(false);
    }
  }


  // nlChips removed — duplicated by quick-action buttons

// Visualization: tool-specific adapters first (clean dashboard-like charts),
// then a small generic fallback for numeric KPIs.
  type VizKind = "none" | "bar" | "stacked" | "donut" | "device_health" | "ha_health" | "exec_diagnostic" | "notif_delivery" | "notif_events";
  type VizSpec = {
    kind: VizKind;
    title: string;
    subtitle: string;
    // For bar/stacked:
    data?: any[];
    xKey?: string;
    // For stacked:
    keys?: string[];
    // For donut:
    donut?: { name: string; value: number }[];
    // For device health (custom):
    deviceHealth?: any;
    // Optional table:
    table?: { columns: string[]; rows: Array<Record<string, any>> };
  };

  function unwrapToolPayload(raw: any): any {
    const p = raw?.result?.payload;
    if (!p) return null;
    // Many Tier-2 tools return {status, payload:{...}}
    if (typeof p === "object" && p && "status" in p && "payload" in p) return (p as any).payload;
    return p;
  }

  function isNum(v: any): v is number {
    return typeof v === "number" && Number.isFinite(v);
  }

  function severityOrder(s: string): number {
    const x = (s || "").toLowerCase();
    if (x === "critical") return 0;
    if (x === "major") return 1;
    if (x === "warning") return 2;
    if (x === "minor") return 3;
    if (x === "info") return 4;
    return 99;
  }

  function shortLabel(path: string): string {
    const p = path
      .replace(/^payload\./, "")
      .replace(/\[\d+\]/g, "")
      .replace(/headline\.counts\./g, "")
      .replace(/counts\./g, "")
      .replace(/summary\./g, "")
      .replace(/health_raw\./g, "health.")
      .replace(/summary_raw\./g, "summary.")
      .replace(/fabric_health/g, "health")
      .replace(/topology_health/g, "topology")
      .replace(/services_total/g, "services total")
      .replace(/services_problem/g, "services problem")
      .replace(/nodes_total/g, "nodes total")
      .replace(/nodes_problem/g, "nodes problem")
      .replace(/resources_total/g, "resources total")
      .replace(/resources_problem/g, "resources problem");
    const parts = p.split(".").filter(Boolean);
    return parts.slice(-2).join(".");
  }

  function extractNumericKpis(
    obj: any,
    max = 10
  ): Array<{ name: string; value: number; full: string }> {
    const out: Array<{ name: string; value: number; full: string }> = [];

    function walk(o: any, path: string, depth: number) {
      if (out.length >= max) return;
      if (!o || depth > 5) return;

      if (isNum(o)) {
        out.push({ name: shortLabel(path), value: o, full: path });
        return;
      }
      if (Array.isArray(o)) return;
      if (typeof o !== "object") return;

      const keys = Object.keys(o);

      // Prefer summary/counts/signals blocks first
      for (const k of ["summary", "counts", "signals", "headline"]) {
        if (out.length >= max) break;
        if (k in o) walk((o as any)[k], path ? `${path}.${k}` : k, depth + 1);
      }

      for (const k of keys) {
        if (out.length >= max) break;
        if (["summary", "counts", "signals", "headline"].includes(k)) continue;
        const v = (o as any)[k];
        if (typeof v === "object" && v) walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }

    walk(obj, "payload", 0);

    // Dedupe by label
    const seen = new Set<string>();
    return out.filter((x) => {
      if (seen.has(x.name)) return false;
      seen.add(x.name);
      return true;
    });
  }

  const viz: VizSpec = useMemo(() => {
    if (!resp) {
      return { kind: "none", title: "Visualization", subtitle: "Run a request to populate charts." };
    }

    const toolName = resp?.picked?.tool ?? "";
    const payload = unwrapToolPayload(resp.raw);

    // --- Adapter: Platform quick status ---
    if (toolName === "monitor_get_platform_quick_status") {
      const summary = payload?.summary ?? payload?.payload?.summary ?? null;
      const efa = summary?.efa ?? payload?.efa ?? {};
      const services = summary?.services ?? payload?.services ?? {};
      const health = summary?.health ?? payload?.health ?? {};

      const nodesTotal = isNum(efa?.nodes_total) ? efa.nodes_total : 0;
      const nodesProblem = isNum(efa?.nodes_problem) ? efa.nodes_problem : 0;
      const servicesTotal = isNum(services?.services_total) ? services.services_total : 0;
      const servicesProblem = isNum(services?.services_problem) ? services.services_problem : 0;
      const healthTotal = isNum(health?.resources_total) ? health.resources_total : 0;
      const healthProblem = isNum(health?.resources_problem) ? health.resources_problem : 0;

      const data = [
        { name: "EFA Nodes", ok: Math.max(0, nodesTotal - nodesProblem), problem: nodesProblem },
        {
          name: "Services",
          ok: Math.max(0, servicesTotal - servicesProblem),
          problem: servicesProblem,
        },
        { name: "Health", ok: Math.max(0, healthTotal - healthProblem), problem: healthProblem },
      ];

      return {
        kind: "stacked",
        title: "Platform quick status",
        subtitle: "Totals vs problems for EFA nodes, services, and health endpoints.",
        data,
        xKey: "name",
        keys: ["ok", "problem"],
      };
    }

    
    // --- Adapter: Device health rollup ---
    if (toolName === "inventory_get_device_health_rollup") {
      const raw = payload ?? {};
      const summary = raw?.summary ?? {};
      const counts = summary?.unhealthy_counts_global ?? { red: 0, yellow: 0, green: 0, unknown: 0 };

      const toNum = (v: any) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

      const red = toNum((counts as any).red);
      const yellow = toNum((counts as any).yellow);
      const green = toNum((counts as any).green);
      const unknown = toNum((counts as any).unknown);

      const total = toNum(summary?.devices_scanned ?? (red + yellow + green + unknown));

      const pie = [
        { name: "Red", value: red, tone: "bad" },
        { name: "Yellow", value: yellow, tone: "warn" },
        { name: "Green", value: green, tone: "good" },
        { name: "Unknown", value: unknown, tone: "neutral" },
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
        .slice(0, 10);

      const byFabric = groups.map((g: any) => ({
        fabric: g?.fabric?.name ?? g?.fabric ?? "—",
        health: String(g?.fabric?.health ?? "").toUpperCase() || "—",
        devices: toNum(g?.devices_total),
        red: toNum(g?.health_counts?.red),
        yellow: toNum(g?.health_counts?.yellow),
        green: toNum(g?.health_counts?.green),
      }));

      const headline = raw?.headline ?? null;

      return {
        kind: "device_health",
        title: "Device health",
        subtitle: "Health rollup (auto)",
        deviceHealth: { headline, total, pie, counts: { red, yellow, green, unknown }, byFabric, driversTop },
      };
    }

// --- Adapter: Fabric overview ---
    if (toolName === "fabric_get_fabric_overview") {
      const fabrics = Array.isArray(payload?.fabrics) ? payload.fabrics : [];
      const total = isNum(payload?.count) ? payload.count : fabrics.length;

      const byHealth: Record<string, number> = {};
      for (const f of fabrics) {
        const h = f?.headline?.fabric_health ?? "Unknown";
        byHealth[h] = (byHealth[h] ?? 0) + 1;
      }
      const donut = Object.entries(byHealth).map(([name, value]) => ({ name, value }));

      const rows = fabrics.slice(0, 20).map((f: any) => ({
        fabric: f?.fabric ?? "—",
        status: f?.headline?.fabric_status ?? "—",
        health: f?.headline?.fabric_health ?? "—",
        topology: f?.headline?.topology_health ?? "—",
      }));

      return {
        kind: donut.length ? "donut" : "none",
        title: "Fabrics",
        subtitle: `Fabrics by health color (total ${total}).`,
        donut,
        table: {
          columns: ["fabric", "status", "health", "topology"],
          rows,
        },
      };
    }

    // --- Adapter: Fabric health timeline (chronological events + executions) ---
    // Renders as: title with fabric name + current health, subtitle with
    // counts + window, then a table of events newest-first (timestamp / kind
    // / message). Server returns three overlapping lists (events flat,
    // executions system-wide, timeline = executions wrapping events) — to
    // avoid double-counting we merge events + timeline-items only and label
    // timeline rows with their summary.stages chain.
    if (toolName === "fabric_get_fabric_health_timeline") {
      const headline = payload?.headline ?? {};
      const fabHealth = String(headline?.fabric_health ?? "?");
      const topoHealth = String(headline?.topology_health ?? "?");
      const filt = payload?.filter ?? {};
      const fabName = String(filt?.name ?? payload?.name ?? "(fabric)");
      const events = Array.isArray((payload?.events ?? {}).items) ? payload.events.items : [];
      const eventsCount = isNum(payload?.events?.count) ? payload.events.count : events.length;
      const tlItems = Array.isArray((payload?.timeline ?? {}).items) ? payload.timeline.items : [];
      const tlCount = isNum(payload?.timeline?.count) ? payload.timeline.count : tlItems.length;
      const execCount = isNum(payload?.executions?.count) ? payload.executions.count : 0;
      const windowNote = String(filt?.window_note ?? "").trim();

      const tsField = (e: any) =>
        e?.date || e?.timestamp || e?.ts || e?.time || e?.start_time ||
        e?.end_time || e?.Timestamp || "";
      const labelOf = (e: any, kind: string) => {
        if (kind === "EXECUTION") {
          const stages = (e?.summary?.stages || []) as string[];
          const stageLine = stages.length ? stages.join(" → ") : "(no stages)";
          const uuid = e?.execution_uuid ? ` · ${String(e.execution_uuid).slice(0, 8)}` : "";
          const ec = e?.event_count ? ` · ${e.event_count} event(s)` : "";
          return `Execution: ${stageLine}${ec}${uuid}`;
        }
        return e?.message || e?.description || e?.title || e?.event ||
               e?.command || e?.name || "(no message)";
      };

      const merged = [
        ...events.map((e: any) => ({ ...e, _kind: "EVENT" as const })),
        ...tlItems.map((e: any) => ({ ...e, _kind: "EXECUTION" as const })),
      ].sort((a, b) => String(tsField(b)).localeCompare(String(tsField(a))));

      const rows = merged.slice(0, 50).map((e: any) => ({
        timestamp: tsField(e) || "—",
        kind: e._kind,
        message: labelOf(e, e._kind),
      }));

      // Subtitle: current health + counts + window. Make it one tight line
      // since the table carries the actual chronology.
      const subtitleParts: string[] = [
        `Fabric ${fabHealth} · Topology ${topoHealth}`,
        `${eventsCount} event${eventsCount !== 1 ? "s" : ""}`,
        `${tlCount} execution${tlCount !== 1 ? "s" : ""} correlated`,
      ];
      if (execCount > tlCount) subtitleParts.push(`(${execCount} system-wide)`);
      if (windowNote) subtitleParts.push(windowNote);

      return {
        // Custom kind — the renderer's `kind !== "none"` gate hides the
        // whole panel for "none", which would suppress our table too.
        // No specific handler exists for "fabric_timeline" so the chart
        // slot stays empty and the title + subtitle + table flow normally.
        kind: "fabric_timeline" as any,
        title: `Fabric timeline: ${fabName}`,
        subtitle: subtitleParts.join(" · "),
        table: {
          columns: ["timestamp", "kind", "message"],
          rows,
        },
      };
    }

    // --- Adapter: Unreachable devices ---
    if (toolName === "inventory_get_unreachable_devices") {
      const c = payload?.counts ?? {};
      const reachable = isNum(c?.reachable) ? c.reachable : 0;
      const unreachable = isNum(c?.unreachable) ? c.unreachable : 0;
      const unknown = isNum(c?.unknown) ? c.unknown : 0;

      const data = [
        { name: "reachable", value: reachable },
        { name: "unreachable", value: unreachable },
        { name: "unknown", value: unknown },
      ];

      const groups = Array.isArray(payload?.groups) ? payload.groups : [];
      const rows = groups.slice(0, 20).map((g: any) => ({
        group: g?.group ?? "—",
        devices_total: g?.devices_total ?? "—",
        unreachable: g?.unreachable_count ?? "—",
      }));

      return {
        kind: "bar",
        title: "Device reachability",
        subtitle: "Reachable vs unreachable vs unknown.",
        data,
        xKey: "name",
        keys: ["value"],
        table: rows.length ? { columns: ["group", "devices_total", "unreachable"], rows } : undefined,
      };
    }

    
    // --- Adapter: Switches widget table (summary-based) ---
    if (toolName === "inventory_get_switches_widget_table") {
      const sum: any = payload?.summary ?? {};
      const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
      // Some upstream serializers key un-fabriced switches under the literal
      // string "{}" (the JSON repr of their empty-object fabric), or
      // "[object Object]" / "" / "null". Strip these noise keys so they
      // don't leak into the donut, the KPI bar, or the subtitle. They get
      // counted under "(unassigned)" instead so operators see how many
      // switches lack a fabric without seeing serializer junk.
      const isJunkFabricKey = (k: string) =>
        !k || k === "{}" || k === "[object Object]" || k === "null" || k === "undefined";
      const cleanFabricMap = (m: Record<string, number>): Record<string, number> => {
        const out: Record<string, number> = {};
        let unassigned = 0;
        for (const [k, v] of Object.entries(m)) {
          if (isJunkFabricKey(k)) unassigned += isNum(v) ? v : 0;
          else out[k] = isNum(v) ? v : 0;
        }
        if (unassigned > 0) out["(unassigned)"] = unassigned;
        return out;
      };
      const byRole: Record<string, number> = sum?.by_role ?? {};
      const byFabric: Record<string, number> = cleanFabricMap(sum?.by_fabric ?? {});
      const totalCount: number = sum?.count ?? items.length;

      // Donut: by role (Leaf, Spine, BorderLeaf, …)
      const donut = Object.entries(byRole).map(([name, value]) => ({ name, value: isNum(value) ? value : 0 }));

      // KPI bar: by fabric — already noise-filtered above
      const fabricData = Object.entries(byFabric).map(([name, value]) => ({ name, value: isNum(value) ? value : 0 }));

      // Table rows from items (may be empty)
      const rows = items.slice(0, 15).map((it: any) => ({
        ip: pickStr(it?.ip_address ?? it?.ip ?? it?.management_ip) ?? "—",
        name: pickStr(it?.name ?? it?.hostname) ?? "—",
        role: pickStr(it?.role) ?? "—",
        // Fabric — handles the three shapes inventory_getswitches /
        // inventory_get_switches_widget_table return:
        //   • {fabric_name: "lab-b-alex"}    ← fabriced switch (object)
        //   • {}                             ← un-fabriced switch (empty obj)
        //   • "lab-b-alex"                   ← already-flattened string
        // Some serializers convert {} → literal string "{}" or
        // "[object Object]"; both are treated as un-fabriced (— dash).
        // Without this, fabriced switches showed "—" (pickStr returned
        // null for the nested object) and un-fabriced showed the leaked
        // literal "{}" — the bug operators reported.
        fabric: extractFabricName(it),
        firmware: pickStr(it?.firmware ?? it?.firmware_version ?? it?.firmware_display) ?? "—",
      }));

      // Build subtitle: "10 switches in DC — Leaf (6) · Spine (2) · BorderLeaf (2)"
      const fabricLabel = Object.keys(byFabric).join(", ");
      const roleLabel   = Object.entries(byRole).map(([r, n]) => `${r} (${n})`).join(" · ");
      const subtitle = totalCount
        ? `${totalCount} switch${totalCount !== 1 ? "es" : ""}${fabricLabel ? ` in ${fabricLabel}` : ""} — ${roleLabel || "no role data"}`
        : "No switch data returned.";

      return {
        kind: "donut",
        title: "Switch topology",
        subtitle,
        donut: donut.length ? donut : fabricData,
        table: rows.length
          ? { columns: ["name", "ip", "role", "fabric", "firmware"], columnLabels: { ip: "IP Address" }, rows }
          : undefined,
        // Hint to the viz renderer that this viz has a richer companion
        // widget. The renderer adds a link to open FleetInventoryWidget
        // (full sortable table + serial / part number columns + CSV
        // export). Pure UX affordance — no extra data needed.
        linkToFleetInventory: true,
      };
    }

    // --- Adapter: Switch inventory overview (merged) ---
    if (toolName === "inventory_get_switch_inventory_overview") {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const total = items.length;

      // Spread by chassis name (SKU)
      const countsObj: Record<string, number> = {};
      for (const it of items) {
        const m =
          pickStr(it?.chassis_name ?? it?.chassisName ?? it?.["chassis-name"]) ??
          "Unknown";
        countsObj[m] = (countsObj[m] ?? 0) + 1;
      }

      const counts = Object.entries(countsObj)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      const TOP = 6;
      const donut =
        counts.length > TOP
          ? [
              ...counts.slice(0, TOP),
              { name: "Other", value: counts.slice(TOP).reduce((s, x) => s + (x.value ?? 0), 0) },
            ]
          : counts;

      const rows = items.slice(0, 10).map((it: any) => ({
        name: pickStr(it?.name) ?? "—",
        "IP Address": pickStr(it?.ip_address ?? it?.ip ?? it?.management_ip) ?? "—",
        role: pickStr(it?.role) ?? "—",
        model: pickStr(it?.chassis_name ?? it?.chassisName ?? it?.["chassis-name"]) ?? "—",
        type: pickStr(it?.device_type ?? it?.type) ?? "—",
        firmware: pickStr(it?.firmware ?? it?.firmware_version) ?? "—",
      }));

      return {
        kind: "donut",
        title: "Switch models",
        subtitle: `${total} switches (showing first 10)`,
        donut,
        table: {
          columns: ["name", "IP Address", "role", "model", "type", "firmware"],
          rows,
        },
      };
    }

// --- Adapter: Alarm summary (stacked by cleared/not cleared) ---
    if (toolName === "faultmanager_get_alarm_summary") {
      const list = Array.isArray(payload?.Alarms) ? payload.Alarms : [];
      const data = list
        .map((a: any) => ({
          name: (a?.Severity ?? "unknown").toLowerCase(),
          notCleared: isNum(a?.NotCleared) ? a.NotCleared : 0,
          cleared: isNum(a?.Cleared) ? a.Cleared : 0,
        }))
        .sort((a: any, b: any) => severityOrder(a.name) - severityOrder(b.name));

      return {
        kind: "stacked",
        title: "Alarms by severity",
        subtitle: "Cleared vs active alarms by severity.",
        data,
        xKey: "name",
        keys: ["notCleared", "cleared"],
      };
    }

    // --- Adapter: Active alarms top (counts by severity + small table) ---
    if (toolName === "fault_get_active_alarms_top") {
      const by = payload?.summary?.by_severity ?? {};
      const data = Object.entries(by)
        .map(([name, value]) => ({ name, value: isNum(value) ? value : 0 }))
        .sort((a: any, b: any) => severityOrder(a.name) - severityOrder(b.name));

      const top = Array.isArray(payload?.top) ? payload.top : [];
      const rows = top.slice(0, 10).map((t: any) => {
        const sample = Array.isArray(t?.samples) ? t.samples[0] : null;
        const alarmCategory = sample?.alarm_type ?? "—";
        const rawMsg: string = sample?.message ?? "";
        const msg = rawMsg.length > 80 ? rawMsg.slice(0, 78) + "…" : rawMsg || "—";
        return {
          severity: t?.severity ?? "—",
          alarm: t?.name ?? "—",
          category: alarmCategory,
          count: t?.count ?? "—",
          message: msg,
        };
      });

      const totalFetched: number = payload?.summary?.active_total_fetched ?? 0;
      const subtitle = totalFetched
        ? `${totalFetched} active alarm${totalFetched !== 1 ? "s" : ""} — top groups by severity.`
        : "Top active alarm groups by severity.";

      return {
        kind: "bar",
        title: "Active alarms (top)",
        subtitle,
        data,
        xKey: "name",
        keys: ["value"],
        table: rows.length ? { columns: ["severity", "alarm", "category", "count", "message"], rows } : undefined,
      };
    }

    // --- Adapter: HA & Node Health Summary ---
    if (toolName === "system_get_ha_and_node_health_summary") {
      const sig = payload?.summary?.signals ?? {};
      const platformOk: boolean = payload?.summary?.platform_ok ?? false;

      // Nodes from system_health_status + k3s overlay
      const rawNodes: any[] = Array.isArray(payload?.system_health_status?.nodes)
        ? payload.system_health_status.nodes : [];
      const k3sNodes: any[] = Array.isArray(payload?.k3s_nodes?.nodes)
        ? payload.k3s_nodes.nodes : [];

      const nodes = rawNodes.map((n: any) => {
        const k3s = k3sNodes.find((k: any) => k.name === n.name) ?? {};
        return {
          name: n.name ?? "—",
          status: n.status ?? "—",
          role: n.role ?? "—",
          ip: n.IP ?? n.ip ?? "—",
          podsRunning: n.pod_count_running ?? 0,
          podsFailed: n.pod_count_failed ?? 0,
          podsStopped: n.pod_count_stopped ?? 0,
          k3sStatus: k3s.status ?? "—",
          k3sVersion: k3s.version ?? "—",
          k3sRoles: k3s.roles ?? "—",
        };
      });

      // Subsystem health — clean up resource path to a short label
      const rawHealth: any[] = Array.isArray(payload?.system_health_status?.health)
        ? payload.system_health_status.health : [];
      const subsystems = rawHealth.map((h: any) => {
        const parts = String(h?.Resource ?? "").split("/").filter(Boolean);
        const label = parts[parts.length - 1] ?? h?.Resource ?? "—";
        return {
          label,
          color: h?.HQI?.Color ?? "—",
          status: h?.StatusText ?? "—",
        };
      });

      // Pod counts donut — sum across all nodes
      const totalRunning = nodes.reduce((s, n) => s + n.podsRunning, 0);
      const totalFailed  = nodes.reduce((s, n) => s + n.podsFailed,  0);
      const totalStopped = nodes.reduce((s, n) => s + n.podsStopped, 0);
      const pie = [
        { name: "Running", value: totalRunning || 0, tone: "good" },
        ...(totalFailed  ? [{ name: "Failed",  value: totalFailed,  tone: "bad"  }] : []),
        ...(totalStopped ? [{ name: "Stopped", value: totalStopped, tone: "warn" }] : []),
      ];
      if (!pie.length || pie.every(p => !p.value))
        pie.splice(0, pie.length, { name: "Pods", value: 1, tone: "good" });

      const warnings: string[] = Array.isArray(payload?.warnings) ? payload.warnings : [];
      const subtitle = platformOk
        ? `Platform healthy — ${nodes.length} node${nodes.length !== 1 ? "s" : ""}, all signals OK.`
        : "Platform has problems — check HA, storage, or node signals.";

      return {
        kind: "ha_health",
        title: "HA & Node Health",
        subtitle,
        haHealth: {
          platformOk,
          signals: {
            ha:      !sig.ha_problem,
            storage: !sig.storage_problem,
            nodes:   !sig.node_problem,
            health:  !sig.health_problem,
          },
          nodes,
          subsystems,
          pie,
          warnings,
        },
      };
    }

    // --- Adapter: Last execution diagnostic ---
    if (toolName === "system_get_last_execution_diagnostic") {
      const status: string  = String(payload?.status ?? "unknown").toLowerCase();
      const summary: any    = payload?.summary ?? {};
      const details: any    = payload?.details ?? {};

      // Parse URL into path + query
      const rawUrl: string = summary?.URL ?? details?.URL ?? "";
      const qMark = rawUrl.indexOf("?");
      const urlPath   = qMark >= 0 ? rawUrl.slice(0, qMark) : rawUrl;
      const urlParams = qMark >= 0 ? rawUrl.slice(qMark + 1) : "";

      // Extract duration from status string e.g. "Failed(3.793497ms)"
      const durationMatch = String(summary?.status ?? "").match(/\(([^)]+)\)/);
      const duration = durationMatch ? durationMatch[1] : "—";

      // Parse structured log lines, drop polling noise
      const rawLogs: string = details?.logs ?? "";
      const logLines: any[] = rawLogs.split("\n")
        .map((l: string) => { try { return JSON.parse(l.trim()); } catch { return null; } })
        .filter(Boolean)
        .filter((e: any) => {
          const msg: string = String(e?.msg ?? "");
          // drop pure polling/retrieval entries
          return !msg.includes("Called Execution get") && !msg.includes("ExecutionGet");
        })
        .slice(0, 12);

      return {
        kind: "exec_diagnostic",
        title: "Last Failed Execution",
        subtitle: `Execution ${payload?.execution_id ?? "—"} · ${status === "failed" ? "FAILED" : status.toUpperCase()}`,
        execDiag: {
          status,
          executionId: payload?.execution_id ?? "—",
          urlPath: urlPath || "—",
          urlParams,
          method: summary?.method ?? details?.method ?? "—",
          startTime: summary?.start_time ?? "—",
          duration,
          logLines,
        },
      };
    }

    // --- Adapter: Notification recent events filtered ---
    if (toolName === "notification_get_recent_events_filtered") {
      const sum: any = payload?.summary ?? {};
      const eventsRaw: any[] = Array.isArray(payload?.events) ? payload.events : [];
      const events: any[] = eventsRaw.slice(0, 200); // cap to avoid UI hang
      const warnings: string[] = Array.isArray(payload?.warnings) ? payload.warnings : [];
      const nextActions: any[] = Array.isArray(payload?.next_actions) ? payload.next_actions : [];
      const perSource: Record<string, any> = sum?.per_source ?? {};

      // Per-source rows
      const sourceRows = Object.entries(perSource).map(([src, v]: [string, any]) => ({
        source: src,
        fetched: v?.executions_fetched ?? 0,
        events: v?.events_extracted ?? 0,
        status: v?.unsupported ? "unsupported" : v?.skipped ? "skipped" : "ok",
      }));

      // By-severity bar data
      const bySev: Record<string, number> = sum?.by_severity ?? {};
      const sevData = Object.entries(bySev).map(([name, value]) => ({ name, value: isNum(value) ? value : 0 }));

      const totalEvents: number = sum?.events_returned ?? 0;
      const sourcesUsed: number = (sum?.sources_used ?? []).length;
      const errCount: number = sum?.errors ?? 0;
      const subtitle = totalEvents
        ? `${totalEvents} event${totalEvents !== 1 ? "s" : ""} returned across ${sourcesUsed} sources.`
        : `No events returned — ${sourcesUsed} sources scanned.`;

      return {
        kind: "notif_events",
        title: "Recent Events",
        subtitle,
        notifEvents: { totalEvents, sourcesUsed, errCount, sourceRows, sevData, events, warnings, nextActions },
      };
    }

    // --- Adapter: Notification last failed delivery ---
    if (toolName === "notification_get_last_failed_delivery_or_errors") {
      const sum: any      = payload?.summary ?? {};
      const lastFailed    = payload?.last_failed ?? null;
      const recentFailed: any[] = Array.isArray(payload?.recent_failed) ? payload.recent_failed : [];
      const warnings: string[]  = Array.isArray(payload?.warnings) ? payload.warnings : [];
      const nextActions: any[]  = Array.isArray(payload?.next_actions) ? payload.next_actions : [];
      const healthy = sum.last_failed_found === false && recentFailed.length === 0;

      // bar: scan stats
      const windowHours: number = payload?.input_echo?.window_hours ?? 0;
      const data = [
        { name: "Scanned", value: sum.executions_total_fetched_effective ?? 0 },
        { name: "In window", value: sum.executions_in_window ?? 0 },
        { name: "Failed", value: recentFailed.length + (lastFailed ? 1 : 0) },
      ];

      const subtitle = healthy
        ? `All clear — ${sum.executions_total_fetched_effective ?? 0} executions scanned in ${windowHours}h window, no failures.`
        : `Failures found — check recent_failed list below.`;

      return {
        kind: "notif_delivery",
        title: "Notification Delivery",
        subtitle,
        data,
        xKey: "name",
        keys: ["value"],
        notifDelivery: {
          healthy,
          windowHours,
          scanned: sum.executions_total_fetched_effective ?? 0,
          inWindow: sum.executions_in_window ?? 0,
          failedCount: recentFailed.length + (lastFailed ? 1 : 0),
          modeUsed: sum.tier1_mode_used ?? "—",
          lastFailed,
          recentFailed,
          warnings,
          nextActions,
        },
      };
    }

    // --- Adapter: Certificate alarms by severity ---
    if (toolName === "system_get_certificate_alarm_context") {
      const by = payload?.summary?.by_severity ?? {};
      const donut = Object.entries(by).map(([name, value]) => ({
        name,
        value: isNum(value) ? value : 0,
      }));
      return {
        kind: "donut",
        title: "Certificate alarms",
        subtitle: "Certificate-related alarms by severity.",
        donut,
      };
    }

    // --- Adapter: Certificates expiring soon (buckets) ---
    if (toolName === "system_get_certificates_expiring_soon") {
      const counts = payload?.summary?.counts ?? {};
      const expired = isNum(counts?.expired) ? counts.expired : 0;
      const e30 = isNum(counts?.expiring_30) ? counts.expiring_30 : 0;
      const e60 = isNum(counts?.expiring_60) ? counts.expiring_60 : 0;
      const e90 = isNum(counts?.expiring_90) ? counts.expiring_90 : 0;
      const ok = isNum(counts?.ok) ? counts.ok : 0;

      const data = [
        { name: "expired", value: expired },
        { name: "0–30d", value: e30 },
        { name: "30–60d", value: e60 },
        { name: "60–90d", value: e90 },
        { name: "ok", value: ok },
      ];

      return {
        kind: "bar",
        title: "Certificates expiring soon",
        subtitle: "Counts by expiry bucket.",
        data,
        xKey: "name",
        keys: ["value"],
      };
    }

    // --- Generic fallback: numeric KPIs ---
    const kpis = extractNumericKpis(payload, 10);
    if (kpis.length) {
      const data = kpis.map((k) => ({ name: k.name, value: k.value }));
      return {
        kind: "bar",
        title: toolName || "Counts & KPIs",
        subtitle: "Auto-derived counts/KPIs from common fields (varies by tool).",
        data,
        xKey: "name",
        keys: ["value"],
      };
    }

    return { kind: "none", title: "Visualization", subtitle: `No visualization available for ${toolName}.` };
  }, [resp]);

  // Cache uptime whenever any tool response includes it (e.g. firmware tool),
  // so the ClockWidget can show it even though the clock RPC doesn't return uptime.
  useEffect(() => {
    if (!resp) return;
    const payload: any = (resp.raw as any)?.result?.payload ?? (resp.raw as any)?.payload ?? {};
    const uptime: string =
      payload?.summary?.system_uptime ??
      payload?.item?.system_uptime ??
      "";
    if (uptime) setCachedUptime(uptime);
  }, [resp]);

  // Lazy raw JSON — only computed when user clicks Raw tab or Copy.
  // Prevents multi-MB JSON.stringify from blocking UI on response arrival.
  const rawJsonCache = useRef<{ key: any; full: string; display: string; explain: string } | null>(null);
  const cachedRawJson = useMemo(() => {
    // Return a lazy accessor; only compute on first access per response
    const RAW_DISPLAY_MAX = 80_000;
    const getCache = () => {
      if (rawJsonCache.current?.key === resp) return rawJsonCache.current;
      if (!resp?.raw) {
        rawJsonCache.current = { key: resp, full: "{}", display: "{}", explain: "{}" };
        return rawJsonCache.current;
      }
      try {
        const full = JSON.stringify(resp.raw, null, 2);
        const display = full.length > RAW_DISPLAY_MAX
          ? full.slice(0, RAW_DISPLAY_MAX) + `\n\n… truncated (${(full.length / 1024).toFixed(0)} KB total — use Copy to get full JSON)`
          : full;
        const explain = JSON.stringify(resp.raw?.explain ?? {}, null, 2);
        rawJsonCache.current = { key: resp, full, display, explain };
      } catch {
        rawJsonCache.current = { key: resp, full: "Error: could not serialize.", display: "Error: could not serialize.", explain: "{}" };
      }
      return rawJsonCache.current!;
    };
    return {
      get full()    { return getCache().full; },
      get display() { return getCache().display; },
      get explain() { return getCache().explain; },
    };
  }, [resp]);

  const chartSupported = viz.kind !== "none";

  const chartMeta = useMemo(() => {
    const toolName = resp?.picked?.tool ?? "";
    if (!chartSupported) {
      return {
        title: "Visualization",
        subtitle: `No visualization available for ${toolName}.`,
      };
    }
    return { title: viz.title, subtitle: viz.subtitle };
  }, [resp, chartSupported, viz.title, viz.subtitle]);

  function renderFiltersBlock(detailed: boolean): string {
    // Filters are only present when the backend actually applied them.
    // Still show an explicit "none" line so operators can tell whether filtering happened.
    if (!resp) return "";
    if (!resp?.explain) return "Filters: (missing explain from backend)";
    const fa = resp?.explain?.filters_applied;
    if (!fa) return "Filters: none";

    const sourceRaw = fa?.source ?? "unknown";
    const source =
      sourceRaw === "ollama"
        ? "Ollama (LLM)"
        : sourceRaw === "regex"
        ? "Regex"
        : String(sourceRaw);

    const before = typeof fa?.before === "number" ? fa.before : null;
    const after = typeof fa?.after === "number" ? fa.after : null;

    const lines: string[] = [];
    lines.push(
      `Filters: ${source}${before !== null && after !== null ? ` — ${before} → ${after} items` : ""}`
    );

    const extracted = Array.isArray(fa?.extracted) ? fa.extracted : [];
    if (extracted.length) {
      if (detailed) {
        lines.push("");
        lines.push("Extracted clauses:");
        lines.push(JSON.stringify(extracted, null, 2));
      } else {
        const compact = extracted
          .slice(0, 3)
          .map((c: any) => {
            const field = c?.field ?? c?.key ?? c?.path ?? "";
            const op = c?.op ?? c?.operator ?? c?.match ?? "";
            const value =
              c?.value !== undefined
                ? c.value
                : c?.text !== undefined
                ? c.text
                : c?.contains !== undefined
                ? c.contains
                : undefined;

            if (field && op && value !== undefined) return `${field} ${op} ${JSON.stringify(value)}`;
            if (field && value !== undefined) return `${field}: ${JSON.stringify(value)}`;
            return JSON.stringify(c);
          })
          .join("; ");

        lines.push(`Clauses: ${compact}${extracted.length > 3 ? " …" : ""}`);
      }
    }

    const llm = fa?.llm ?? {};
    if (llm?.attempted && llm?.used === false) {
      const err = llm?.error || llm?.type || llm?.message;
      if (err) lines.push(`LLM filters fallback: ${String(err)}`);
    }
    // ---- Routing + filters metadata from /api/nl (authoritative) ----
    if (resp.explain) {
      lines.push("");
      lines.push("Routing / Filters meta:");
      const meta = {
        router: resp.explain.router ?? null,
        selected: resp.explain.selected ?? null,
        deterministic: resp.explain.deterministic ?? null,
        llm: resp.explain.llm ?? null,
        filters_applied: resp.explain.filters_applied ?? null,
      };
      lines.push(JSON.stringify(meta, null, 2));
    } else {
      lines.push("");
      lines.push("Routing / Filters meta: (missing explain from backend)");
    }


    return lines.join("\n");
  }

  function renderWithFilters(body: string, detailed: boolean): string {
    const header = renderFiltersBlock(detailed);
    return header ? `${header}\n\n${body}` : body;
  }

  function renderHumanSummary(): string {
    // Unrecognized intent — show suggestions
    const fakeIntent = (resp?.picked as any)?.intent;
    if ((fakeIntent === "unrecognized" || fakeIntent === "ambiguous" || fakeIntent === "help") && (resp as any)?.text) return (resp as any).text;
    if (!resp?.summary) return "Run a request to see results.";

    // RESTCONF failure detection — check every path the meta can live at
    const rcMeta: any =
      resp.raw?.result?.payload?.meta ??          // normal MCP envelope
      resp.raw?.payload?.meta ??                  // alternate shape
      unwrapToolPayload(resp.raw)?.meta ??        // via helper
      null;
    const switchIp: string =
      rcMeta?.switch_ip ?? resp.picked?.inputs?.switch_ip ?? "unknown";

    if (rcMeta && rcMeta.ok === false && rcMeta.source === "direct_switch_restconf") {
      const errStr: string = String(rcMeta.error ?? "");
      const isTimeout = rcMeta.error_type === "connect_timeout" || /timeout|timed.out|connect.*error|max retries/i.test(errStr);
      if (isTimeout) {
        return [
          `\u26A0 Could not reach device at ${switchIp}`,
          "",
          "The switch did not respond (connection timed out).",
          "Possible reasons:",
          `\u2022 IP ${switchIp} is not reachable from this system`,
          "\u2022 The device does not exist or is powered off",
          "\u2022 RESTCONF (HTTPS/443) is blocked by a firewall",
          "",
          "Verify the IP is correct and the device is reachable.",
        ].join("\n");
      }
      return [
        `\u26A0 RESTCONF call failed for ${switchIp}`,
        "",
        `Error: ${errStr.slice(0, 300)}`,
      ].join("\n");
    }

    // resp.error from backend (e.g. invoke exception or missing_switch_ip)
    if (resp.error) {
      const msg: string = resp.error.message ?? resp.error.error ?? "Unknown error";
      return `\u26A0 ${msg}`;
    }

    const s = resp.summary;
    const sum = s.summary;

    // Platform quick status summary
    if (sum?.efa && sum?.services) {
      const efaTotal = sum.efa.nodes_total ?? 0;
      const efaProb = sum.efa.nodes_problem ?? 0;
      const svcTotal = sum.services.services_total ?? 0;
      const svcProb = sum.services.services_problem ?? 0;

      const lines = [
        `\u2022 EFA nodes: ${efaTotal} total, ${efaProb} problem`,
        `\u2022 Services: ${svcTotal} total, ${svcProb} problem`,
      ];

      if (sum.health?.included !== undefined) {
        lines.push(`\u2022 Health checks included: ${sum.health.included ? "yes" : "no"}`);
      }

      return lines.join("\n");
    }

    // Generic: show useful top-level keys
    const keys = Object.keys(s).slice(0, 25);
    return `\u2022 Returned fields: ${keys.join(", ")}`;
  }

  function renderExplain(): string {
    if (!resp) return "Run a request first.";

    // RESTCONF failure detection — check every path the meta can live at
    const rcMeta2: any =
      resp.raw?.result?.payload?.meta ??
      resp.raw?.payload?.meta ??
      unwrapToolPayload(resp.raw)?.meta ??
      null;
    const switchIp2: string =
      rcMeta2?.switch_ip ?? resp.picked?.inputs?.switch_ip ?? "unknown";

    if (rcMeta2 && rcMeta2.ok === false && rcMeta2.source === "direct_switch_restconf") {
      const tool2 = resp.picked?.tool ?? "unknown_tool";
      const errStr2: string = String(rcMeta2.error ?? "");
      const isTimeout2 = rcMeta2.error_type === "connect_timeout" || /timeout|timed.out|connect.*error|max retries/i.test(errStr2);
      const lines2: string[] = [
        `Tool: ${tool2}`,
        `Target IP: ${switchIp2}`,
        "",
      ];
      if (isTimeout2) {
        lines2.push(`Diagnosis: Device at ${switchIp2} is unreachable.`);
        lines2.push("The connection timed out — the IP may not exist on your network,");
        lines2.push("the device may be offline, or HTTPS/443 may be blocked.");
      } else {
        lines2.push("Diagnosis: RESTCONF call returned an error.");
        lines2.push(`Detail: ${errStr2.slice(0, 400)}`);
      }
      lines2.push("", "Suggested actions:");
      lines2.push(`• Verify ${switchIp2} is reachable (try ping or SSH)`);
      lines2.push("• Confirm the device has RESTCONF enabled on port 443");
      lines2.push("• Check the IP against your switch inventory");
      return lines2.join("\n");
    }

    // resp.error from backend
    if (resp.error) {
      const msg2: string = resp.error.message ?? resp.error.error ?? "Unknown error";
      return [`⚠ Error`, "", msg2].join("\n");
    }

    const tool = resp.picked?.tool ?? "unknown_tool";
    const inputs = resp.picked?.inputs ?? {};
    const s = resp.summary ?? {};
    const sum = s.summary ?? {};

    // Collect numeric KPIs from summary (recursive)
    function collectNumericKPIs(
      obj: any,
      prefix = "",
      out: Array<[string, number]> = []
    ) {
      if (!obj || typeof obj !== "object") return out;

      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;

        if (typeof v === "number" && Number.isFinite(v)) {
          out.push([key, v]);
        } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          collectNumericKPIs(v, key, out);
        }
      }
      return out;
    }

    const kpis = collectNumericKPIs(sum)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 8);

    const warnings = Array.isArray(s.warnings)
      ? s.warnings
      : Array.isArray(sum.warnings)
      ? sum.warnings
      : [];

    const nextActions = Array.isArray(s.next_actions)
      ? s.next_actions
      : Array.isArray(sum.next_actions)
      ? sum.next_actions
      : [];

    const lines: string[] = [];
    // Show OpenAI/LLM-generated explanation if available
    const aiExplain = (resp as any)?.assistant_text || resp.raw?.assistant_text;
    if (aiExplain && typeof aiExplain === "string") {
      lines.push(aiExplain);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    lines.push(`Ran ${tool}.`);
    if (Object.keys(inputs).length) {
      lines.push(`Inputs: ${JSON.stringify(inputs)}.`);
    }

    if (kpis.length) {
      lines.push("");
      lines.push("Key signals:");
      for (const [k, v] of kpis) lines.push(`• ${k}: ${v}`);
    }

    if (warnings.length) {
      lines.push("");
      lines.push("Warnings:");
      for (const w of warnings.slice(0, 5)) {
        lines.push(`• ${typeof w === "string" ? w : JSON.stringify(w)}`);
      }
    }

    if (nextActions.length) {
      lines.push("");
      lines.push("Suggested next actions:");
      for (const a of nextActions.slice(0, 5)) {
        lines.push(`• ${typeof a === "string" ? a : JSON.stringify(a)}`);
      }
    } else {
      lines.push("");
      lines.push(
        "Next: If anything looks unhealthy, drill down with a more specific Tier-2 tool (alarms, event logs, fabric health contributors, device drill-down)."
      );
    }

    return lines.join("\n");
  }

function normalizeName(s: string) {
  return (s || "").trim().toLowerCase();
}

/** Compact an interface name for the LLDP topology edge labels. */
function compactPort(port: string | null | undefined): string {
  if (!port) return "?";
  return port.replace(/ethernet/i, "Eth").replace(/^Eth(ernet)?/i, "Eth");
}

async function buildLldpTopology(seedIp: string, depth: 1 | 2) {
  if (!seedIp) return;
  setLldpLoading(true);
  setLldpErr("");
  try {
    // Maps for resolving system-name -> inventory IP/name
    const nameToIp = new Map<string, string>();
    const ipToLabel = new Map<string, string>();
    for (const s of switchOptions) {
      nameToIp.set(normalizeName(s.name || ""), s.ip);
      ipToLabel.set(s.ip, s.name ? `${s.ip}\n${s.name}` : s.ip);
    }

    const visited = new Set<string>();
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const seedId = `ip:${seedIp}`;
    nodes.push({
      id: seedId,
      position: { x: 0, y: 0 },
      data: { label: ipToLabel.get(seedIp) || seedIp },
      style: {
        border: "2px solid var(--accent)",
        background: "rgba(137,129,229,0.15)",
        color: "var(--accent)",
        fontWeight: 700,
        padding: 10,
        borderRadius: 12,
        width: 190,
        fontSize: 12,
        fontFamily: "ui-monospace,monospace",
      },
    });

    async function fetchLldp(ip: string) {
      const r = await invokeTool("restconf_get_lldp_neighbor_detail", { switch_ip: ip });
      const payload = unwrapInvokePayload(r);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      return { payload, items };
    }

    function nodeIdForRemote(remoteIp: string | null, remoteName: string | null, chassis: string | null) {
      if (remoteIp) return `ip:${remoteIp}`;
      if (remoteName) return `name:${remoteName}`;
      if (chassis) return `chassis:${chassis}`;
      return `unknown:${Math.random().toString(16).slice(2)}`;
    }

    function labelForRemote(remoteIp: string | null, remoteName: string | null) {
      if (remoteIp && remoteName) return `${remoteIp}\n${remoteName}`;
      if (remoteIp) return remoteIp;
      return remoteName || "Unknown";
    }

    // Level 1
    visited.add(seedIp);
    const seedRes = await fetchLldp(seedIp);
    const lvl1 = seedRes.items.map((it: any) => {
      const local = pickStr(it?.local_interface);
      const rname = pickStr(it?.remote_system_name);
      const rport = pickStr(it?.remote_port_id);
      const rdescr = pickStr(it?.remote_port_description);
      const chassis = pickStr(it?.remote_chassis_id);
      const rip = rname ? (nameToIp.get(normalizeName(rname)) || null) : null;
      return { local, rname, rport, rdescr, chassis, rip };
    });

    const lvl1Nodes = [];
    for (const n of lvl1) {
      const rid = nodeIdForRemote(n.rip, n.rname, n.chassis);
      const already = nodes.find((x) => x.id === rid);
      if (!already) {
        nodes.push({
          id: rid,
          position: { x: 0, y: 0 }, // layout later
          data: { label: labelForRemote(n.rip, n.rname) },
          style: { border: "1px solid rgba(255,255,255,0.18)", background: "#161B27", color: "rgba(248,248,251,0.85)", padding: 10, borderRadius: 12, width: 190, fontSize: 12, fontFamily: "ui-monospace,monospace" },
        });
      }
      lvl1Nodes.push({ rid, ...n });
      const edgeId = `${seedId}-${rid}-${n.local || ""}-${n.rport || ""}`;
      const fullLabel = `${n.local || "?"} → ${n.rport || "?"}`;
      const compactLabel = `${compactPort(n.local)}→${compactPort(n.rport)}`;
      edges.push({
        id: edgeId,
        source: seedId,
        target: rid,
        label: fullLabel,
        data: { fullLabel, compactLabel },
        style: { stroke: "#8981E5", strokeWidth: 1.5 },
        labelStyle: { fill: "rgba(248,248,251,0.9)", fontSize: 11, fontWeight: 600, fontFamily: "ui-monospace,monospace" },
        labelBgPadding: [8, 5],
        labelBgBorderRadius: 6,
        labelBgStyle: { fill: "#161B27", stroke: "rgba(137,129,229,0.55)", strokeWidth: 1 },
      });
    }

    // Level 2 (best-effort: only for neighbors resolved to an inventory IP)
    const lvl2Items: { parentId: string; parentIp: string; local?: string | null; rname?: string | null; rip?: string | null; rport?: string | null; chassis?: string | null }[] = [];
    if (depth === 2) {
      const maxQueries = 10;
      let q = 0;
      for (const n of lvl1Nodes) {
        if (!n.rip) continue;
        if (visited.has(n.rip)) continue;
        if (q >= maxQueries) break;
        visited.add(n.rip);
        q++;
        const res = await fetchLldp(n.rip);
        for (const it of res.items as any[]) {
          const local = pickStr(it?.local_interface);
          const rname = pickStr(it?.remote_system_name);
          const rport = pickStr(it?.remote_port_id);
          const chassis = pickStr(it?.remote_chassis_id);
          const rip = rname ? (nameToIp.get(normalizeName(rname)) || null) : null;
          lvl2Items.push({ parentId: n.rid, parentIp: n.rip, local, rname, rip, rport, chassis });
        }
      }

      for (const it of lvl2Items) {
        const rid = nodeIdForRemote(it.rip || null, it.rname || null, it.chassis || null);
        if (!nodes.find((x) => x.id === rid)) {
          nodes.push({
            id: rid,
            position: { x: 0, y: 0 },
            data: { label: labelForRemote(it.rip || null, it.rname || null) },
            style: { border: "1px solid rgba(255,255,255,0.18)", background: "#161B27", color: "rgba(248,248,251,0.85)", padding: 10, borderRadius: 12, width: 190, fontSize: 12, fontFamily: "ui-monospace,monospace" },
          });
        }
        const edgeId = `${it.parentId}-${rid}-${it.local || ""}-${it.rport || ""}`;
        const fullLabel = `${it.local || "?"} → ${it.rport || "?"}`;
        const compactLabel = `${compactPort(it.local)}→${compactPort(it.rport)}`;
        edges.push({
          id: edgeId,
          source: it.parentId,
          target: rid,
          label: fullLabel,
          data: { fullLabel, compactLabel },
          style: { stroke: "rgba(137,129,229,0.35)", strokeWidth: 1 },
          labelStyle: { fill: "rgba(248,248,251,0.65)", fontSize: 10, fontWeight: 500, fontFamily: "ui-monospace,monospace" },
          labelBgPadding: [8, 5],
          labelBgBorderRadius: 6,
          labelBgStyle: { fill: "#161B27", stroke: "var(--subtle-border)", strokeWidth: 1 },
        });
      }
    }

    // Layout: simple radial by hop count
    const seed = nodes.find((n) => n.id === seedId)!;
    seed.position = { x: 0, y: 0 };

    const hop1 = nodes.filter((n) => n.id !== seedId && edges.some((e) => e.source === seedId && e.target === n.id));
    const hop2 = nodes.filter((n) => n.id !== seedId && !hop1.some((h) => h.id === n.id));

    const r1 = 260;
    const r2 = 520;

    hop1.forEach((n, i) => {
      const ang = (2 * Math.PI * i) / Math.max(1, hop1.length);
      n.position = { x: Math.round(Math.cos(ang) * r1), y: Math.round(Math.sin(ang) * r1) };
    });

    hop2.forEach((n, i) => {
      const ang = (2 * Math.PI * i) / Math.max(1, hop2.length);
      n.position = { x: Math.round(Math.cos(ang) * r2), y: Math.round(Math.sin(ang) * r2) };
    });

    // apply label mode (compact/full/off) to current edge set
    const applyLabelModeToEdges = (list: Edge[]) => {
      return list.map((e: any) => {
        const full = e?.data?.fullLabel || e.label || "";
        const compact = e?.data?.compactLabel || full;
        const label = lldpLabelMode === "off" ? undefined : (lldpLabelMode === "full" ? full : compact);
        return { ...e, label, labelShowBg: lldpLabelMode !== "off" };
      });
    };

    setLldpNodes(nodes);
    setLldpEdges(applyLabelModeToEdges(edges));
  } catch (e: any) {
    setLldpErr(e?.message ? String(e.message) : "Failed to build topology");
    setLldpNodes([]);
    setLldpEdges([]);
  } finally {
    setLldpLoading(false);
  }
}




  // Derived: is any Tier-3/Tier-4 modal / widget currently open?
  // Replaces a 47-condition `!xxxOpen && !yyyOpen && …` chain that used
  // to gate the chartMeta `<Panel>` fallback at the bottom of the
  // console view. Keep all the per-modal booleans authoritative —
  // this is just a read-only roll-up.
  const anyTierWidgetOpen =
    ifaceWidgetOpen || ifaceDetailWidgetOpen || runningConfigOpen ||
    clockWidgetOpen || mediaWidgetOpen || fleetInvOpen || fleetMediaOpen ||
    ipMacSearchOpen || portStatsWidgetOpen ||
    ipIfaceWidgetOpen || arpTableWidgetOpen || lldpNeighWidgetOpen ||
    maintRateWidgetOpen || vlanBriefWidgetOpen || vrfSummaryWidgetOpen ||
    firmwareWidgetOpen || fabricHealthWidgetOpen || monitorHealthWidgetOpen ||
    tenantWidgetOpen || epgWidgetOpen || fabricsHealthWidgetOpen ||
    alarmDetailsWidgetOpen || tenantHistoryWidgetOpen || swVerWidgetOpen ||
    bgpWidgetOpen || adminActivityOpen || adminSettingsOpen;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-4"
        style={{
          background: "var(--bg1)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          className="xco-logo"
          style={{
            width: 64,
            height: 64,
            display: "inline-block",
            flexShrink: 0,
          }}
        >
          <img
            src="/xco-favicon.svg"
            alt="XCO MCP Client"
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </div>
        <div>
          <div className="text-2xl" style={{ fontWeight: 400 }}>
            XCO MCP Client Console (Demo)
          </div>
          <div className="text-sm opacity-80">
            Natural language → MCP tools
          </div>

          <div className="mt-2 flex gap-2">
            <button
              className="rounded-md px-3 py-1 text-sm"
              style={{
                background:
                  activeTab === "dashboard" ? "var(--accent)" : "transparent",
                border:
                  activeTab === "dashboard"
                    ? "none"
                    : "1px solid var(--border)",
                color: "var(--text)",
              }}
              onClick={() => { setQuickActive(""); setRunningConfigOpen(false); setIfaceWidgetOpen(false); setIfaceDetailWidgetOpen(false); setActiveTab("dashboard"); }}
            >
              Dashboard
            </button>

            <button
              className="rounded-md px-3 py-1 text-sm"
              style={{
                background:
                  activeTab === "console" ? "var(--accent)" : "transparent",
                border:
                  activeTab === "console"
                    ? "none"
                    : "1px solid var(--border)",
                color: "var(--text)",
              }}
              onClick={() => setActiveTab("console")}
            >
              Console
            </button>
            <button
              className="rounded-md px-3 py-1 text-sm"
              style={{
                background:
                  activeTab === "tools" ? "var(--accent)" : "transparent",
                border:
                  activeTab === "tools" ? "none" : "1px solid var(--border)",
                color: "var(--text)",
              }}
              onClick={() => { setQuickActive(""); setRunningConfigOpen(false); setIfaceWidgetOpen(false); setIfaceDetailWidgetOpen(false); setActiveTab("tools"); }}
            >
              Tools
            </button>
          </div>
        </div>

        {/* Theme toggle — pushed to the right */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              if (next === "light") document.documentElement.classList.add("theme-light");
              else document.documentElement.classList.remove("theme-light");
              try { localStorage.setItem("xco_theme", next); } catch {}
            }}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0.35rem 0.55rem",
              color: "var(--text)",
              fontSize: "0.8rem",
              cursor: "pointer",
              opacity: 0.7,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {theme === "dark" ? (
              // sun icon → indicates "click to go light"
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
              </svg>
            ) : (
              // moon icon → indicates "click to go dark"
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
              </svg>
            )}
          </button>
        </div>
      </div>


      {activeTab === "dashboard" ? (
        <DashboardView
          invoke={async (tool: string, inputs: Record<string, any> = {}, opts?: { include_raw?: boolean }) => {
            const merged: Record<string, any> = { ...(inputs ?? {}) };
            if (opts?.include_raw && merged.include_raw === undefined) merged.include_raw = true;
            return await postJSON<any>("/api/invoke", { tool, inputs: merged });
          }}
          onOpenInConsole={async (tool: string, inputs: Record<string, any>) => {
            setActiveTab("console");
            await runNLWithText(`Run ${tool}.`, {
              force_tool: tool,
              force_inputs: inputs ?? {},
            });
          }}
        />
      ) : activeTab === "console" ? (

      <div className="grid grid-cols-12 gap-6 p-6">
        {/* Left: Quick actions */}
        <div className="col-span-12 lg:col-span-3">
          <Panel title="Quick Actions">
	            <button disabled={nlRunning}
	              className="w-full rounded-md px-3 py-2 mb-2"
	              style={{
	                background: quickActive === "platform" ? "var(--accent)" : "transparent",
	                border: "1px solid var(--subtle-border)",
	              }}
              onClick={async () => {
                setQuickActive("platform");
                setForcedTool(null);
                setForcedInputs({});
                setActiveTab("console");
                setIncludeRaw(true);

                await runNLWithText("Run inventory_get_device_health_rollup.", {
                  llm_mode: "deterministic",
                  force_tool: "inventory_get_device_health_rollup",
                  include_raw: true,
                });
              }}
            >
              Platform Quick Status
            </button>

            <button disabled={nlRunning}
              className="w-full rounded-md px-3 py-2 mb-2"
              style={{
                background: quickActive === "fabric_overview" ? "var(--accent)" : "transparent",
                border: "1px solid var(--subtle-border)",
              }}
              onClick={async () => {
                setQuickActive("fabric_overview");
                setForcedTool(null);
                setForcedInputs({});
                setActiveTab("console");
                setIncludeRaw(true);

                await runNLWithText("Run fabric_get_fabric_overview.", {
                  llm_mode: "deterministic",
                  force_tool: "fabric_get_fabric_overview",
                  include_raw: true,
                });
              }}
            >
              Fabric Overview
            </button>

            <button disabled={nlRunning}
              className="w-full rounded-md px-3 py-2 mb-2"
              style={{
                background: quickActive === "inventory" ? "var(--accent)" : "transparent",
                border: "1px solid var(--border)",
              }}
              onClick={async () => {
                // Composite "virtual" tool provided by the client backend (calls 2 MCP tools and merges)
                setQuickActive("inventory");
                setForcedTool(null);
                setForcedInputs({});
                setActiveTab("console");
                setIncludeRaw(true);

                await runNLWithText("Run inventory_get_switch_inventory_overview.", {
                  force_tool: "inventory_get_switch_inventory_overview",
                  force_inputs: { max_items: 200 },
                  include_raw: true,
                });
              }}
            >
              Switch Inventory
            </button>

            

            <button disabled={nlRunning}
              className="w-full rounded-md px-3 py-2 mb-2"
              style={{
                background: quickActive === "unreachable" ? "var(--accent)" : "transparent",
                border: "1px solid var(--border)",
              }}
              onClick={async () => {
                const prompt = "Run inventory_get_unreachable_devices.";
              setQuickActive("unreachable");
              setForcedTool(null);
              setForcedInputs({});
              setActiveTab("console");
              await runNLWithText(prompt, { llm_mode: "deterministic", force_tool: "inventory_get_unreachable_devices" });
              }}
            >
              Unreachable Devices
            </button>

            <button
              className="w-full rounded-md px-3 py-2"
              style={{
                background: quickActive === "example" ? "var(--accent)" : "transparent",
                border: "1px solid var(--border)",
              }}
              disabled={nlRunning} onClick={() => {
              setQuickActive("example");
              // Make sure the operator lands on the Console tab where the
              // result actually renders — Random Example always shows its
              // output here, but we used to silently update resp state
              // while the user was on a different tab.
              setActiveTab("console");
              randomExample();
            }}
            >
              Random Example
            </button>

<button
  className="w-full rounded-md px-3 py-2"
  style={{
    background: quickActive === "tenant_history" ? "var(--accent)" : "transparent",
    border: "1px solid var(--border)",
    color: quickActive === "tenant_history" ? "#0b0b0f" : "var(--text)",
    fontWeight: quickActive === "tenant_history" ? 700 : 400,
  }}
  disabled={nlRunning}
  onClick={async () => {
    setQuickActive("tenant_history");
    setForcedTool(null);
    setForcedInputs({});
    setActiveTab("console");
    setIncludeRaw(true);
    if (!tenantNames.length) await loadTenantNames();
  }}
>
  EPG History Report
</button>

{quickActive === "tenant_history" ? (
  <div
    className="rounded-md p-3 mb-3"
    style={{ border: "1px solid var(--border)", background: "var(--subtle-bg)" }}
  >
    <div className="text-xs" style={{ opacity: 0.8, marginBottom: 8 }}>
      7 or 30-day health &amp; alarm summary for a tenant's Service/EPG scope.
    </div>
    <div className="flex flex-col gap-2">
      <label className="text-xs" style={{ opacity: 0.8 }}>Tenant</label>
      <div className="flex items-center gap-2">
        <select
          className="rounded-md px-2 py-2 text-sm"
          style={{ background: "var(--bg0)", border: "1px solid var(--border)", color: "var(--text)", flex: 1 }}
          value={selectedTenantName}
          onChange={(e) => setSelectedTenantName(e.target.value)}
        >
          {(tenantNames.length ? tenantNames : [""]).map((n) => (
            <option key={n || "_"} value={n}>
              {n || (tenantNamesLoading ? "Loading…" : "(no tenants)")}
            </option>
          ))}
        </select>
        <button
          className="rounded-md px-3 py-2 text-sm"
          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
          disabled={tenantNamesLoading}
          onClick={() => loadTenantNames()}
        >
          Refresh
        </button>
      </div>
      {tenantNamesErr ? (
        <div className="text-xs" style={{ color: "var(--warn)", opacity: 0.95 }}>{tenantNamesErr}</div>
      ) : null}
      <label className="text-xs" style={{ opacity: 0.8, marginTop: 4 }}>Window</label>
      <select
        className="rounded-md px-2 py-2 text-sm"
        style={{ background: "var(--bg0)", border: "1px solid var(--border)", color: "var(--text)" }}
        value={historyWindowDays}
        onChange={(e) => setHistoryWindowDays(Number(e.target.value) === 30 ? 30 : 7)}
      >
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
      </select>
      <button
        className="w-full rounded-md px-3 py-2 text-sm"
        style={{ background: "var(--accent)", border: "none", color: "#0b0b0f", fontWeight: 700, marginTop: 8 }}
        disabled={nlRunning || !selectedTenantName}
        onClick={async () => {
          setIncludeRaw(true);
          await runNLWithText(
            `Run tenant_get_service_epg_historical_report_stub for ${selectedTenantName}.`,
            {
              llm_mode: "deterministic",
              force_tool: "tenant_get_service_epg_historical_report_stub",
              force_inputs: { tenant_name: selectedTenantName, window_days: historyWindowDays, allow_unscoped: historyAllowUnscoped },
              include_raw: true,
            }
          );
          openWidgetForTool("tenant_get_service_epg_historical_report_stub");
          setQuickActive("tenant_history");
        }}
      >
        Run Report
      </button>
    </div>
  </div>
) : null}

<button
  className="w-full rounded-md px-3 py-2 mt-4"
  style={{
    background: quickActive === "lldp_topology" ? "var(--accent)" : "transparent",
    border: "1px solid var(--border)",
    color: quickActive === "lldp_topology" ? "#0b0b0f" : "var(--text)",
    fontWeight: quickActive === "lldp_topology" ? 700 : 400,
  }}
  disabled={nlRunning || switchOptionsLoading || !switchOptions.length}
  onClick={async () => {
    setQuickActive("lldp_topology");
    setIfaceWidgetOpen(false);
    setIfaceDetailWidgetOpen(false);
    setRunningConfigOpen(false);
    setClockWidgetOpen(false);
    setMediaWidgetOpen(false);
    setFleetInvOpen(false);
    setFleetMediaOpen(false);
    setIpMacSearchOpen(false);
    setPortStatsWidgetOpen(false);
    setIpIfaceWidgetOpen(false);
    setArpTableWidgetOpen(false);
    setLldpNeighWidgetOpen(false);
    setMaintRateWidgetOpen(false);
    setVlanBriefWidgetOpen(false);
    setVrfSummaryWidgetOpen(false);
    setFirmwareWidgetOpen(false);
    setFabricHealthWidgetOpen(false);
    setMonitorHealthWidgetOpen(false);
    setTenantWidgetOpen(false);
    setEpgWidgetOpen(false);
    setTenantHistoryWidgetOpen(false);
    setSwVerWidgetOpen(false);
    setForcedTool(null);
    setForcedInputs({});
    setActiveTab("console");
    setIncludeRaw(true);
    refreshSwitchOptions();          // refresh seed list every time panel opens
    await buildLldpTopology(lldpSeedIp, lldpDepth);
  }}
>
  LLDP Topology (RESTCONF)
</button>

<button
  className="w-full rounded-md px-3 py-2 mt-2"
  style={{
    background: fabricTopoOpen ? "var(--accent)" : "transparent",
    border: "1px solid var(--border)",
    color: fabricTopoOpen ? "#0b0b0f" : "var(--text)",
    fontWeight: fabricTopoOpen ? 700 : 400,
  }}
  disabled={nlRunning}
  onClick={() => handleOpenFabricTopology()}
>
  Fabric Topology
</button>

<button
  className="w-full rounded-md px-3 py-2 mb-2 mt-2"
  style={{
    background: quickActive === "restconf" ? "var(--accent)" : "transparent",
    border: "1px solid var(--border)",
  }}
  disabled={nlRunning}
  onClick={async () => {
    setQuickActive("restconf");
    setForcedTool(null);
    setForcedInputs({});
    setActiveTab("console");
    setIncludeRaw(true);

    // Prime defaults
    if (!restconfTool) {
      const first = restconfTools?.[0]?.name;
      if (first) setRestconfTool(first);
    }
    if (!restconfIps.length) {
      await loadRestconfIps();
    }
  }}
>
  RESTCONF
</button>

{quickActive === "restconf" ? (
  <div
    className="rounded-md p-3 mb-3"
    style={{ border: "1px solid var(--border)", background: "var(--subtle-bg)" }}
  >
    <div className="text-xs" style={{ opacity: 0.8, marginBottom: 8 }}>
      Run RESTCONF tools directly against a switch (device-sourced data).
    </div>

    <div className="flex flex-col gap-2">
      <label className="text-xs" style={{ opacity: 0.8 }}>
        Switch IP
      </label>
      <div className="flex items-center gap-2">
        <select
          className="rounded-md px-2 py-2 text-sm"
          style={{ background: "var(--bg0)", border: "1px solid var(--border)", color: "var(--text)", flex: 1 }}
          value={restconfIp}
          onChange={(e) => setRestconfIp(e.target.value)}
        >
          {(restconfIps.length ? restconfIps : [""]).map((ip) => {
            const swName = switchOptions.find((s) => s.ip === ip)?.name;
            return (
              <option key={ip || "_"} value={ip}>
                {ip ? `${ip}${swName ? ` \u2014 ${swName}` : ""}` : (restconfLoading ? "Loading..." : "(no IPs)")}
              </option>
            );
          })}
        </select>
        <button
          className="rounded-md px-3 py-2 text-sm"
          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
          disabled={restconfLoading}
          onClick={() => loadRestconfIps()}
        >
          Refresh
        </button>
      </div>

      {restconfLoadErr ? (
        <div className="text-xs" style={{ color: "var(--warn)", opacity: 0.95 }}>
          {restconfLoadErr}
        </div>
      ) : null}

      <label className="text-xs" style={{ opacity: 0.8, marginTop: 6 }}>
        RESTCONF Tool
      </label>
      <select
        className="rounded-md px-2 py-2 text-sm"
        style={{ background: "var(--bg0)", border: "1px solid var(--border)", color: "var(--text)" }}
        value={restconfTool}
        onChange={(e) => setRestconfTool(e.target.value)}
      >
        {restconfTools.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>

      <label className="text-xs" style={{ opacity: 0.8 }}>
        Extra inputs (optional JSON)
      </label>
      <textarea
        className="rounded-md px-2 py-2 text-xs"
        style={{
          background: "var(--bg0)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          width: "100%",
          minHeight: 72,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        }}
        placeholder='e.g. { "max_ports": 32, "top_n": 5 }'
        value={restconfExtraInputs}
        onChange={(e) => setRestconfExtraInputs(e.target.value)}
      />
      {restconfExtraErr ? (
        <div className="text-xs" style={{ color: "var(--bad)", opacity: 0.95 }}>
          {restconfExtraErr}
        </div>
      ) : null}

      <button
        className="w-full rounded-md px-3 py-2 text-sm"
        style={{ background: "var(--accent)", border: "none", color: "#0b0b0f", fontWeight: 700, marginTop: 8 }}
        disabled={nlRunning || !restconfTool || !restconfIp}
        onClick={async () => {
          setRestconfExtraErr("");
          let extra: any = {};
          const t = (restconfExtraInputs ?? "").trim();
          if (t.length) {
            try {
              extra = JSON.parse(t);
              if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
                throw new Error("Extra inputs must be a JSON object.");
              }
            } catch (e: any) {
              setRestconfExtraErr(`Invalid JSON: ${String(e?.message ?? e)}`);
              return;
            }
          }

          // Pick the right input key from the tool's schema. 18/19 RESTCONF tools
          // take `switch_ip` (singular string), but a few (currently just
          // restconf_get_bgp_summary) take `switch_ips` (plural array). Picking
          // by schema instead of hardcoded list so a future tool with the same
          // shape doesn't trip the same 400.
          const selectedToolDef = restconfTools.find((x) => x.name === restconfTool);
          const schemaProps = (selectedToolDef as any)?.input_schema?.properties ?? {};
          const ipInputs: Record<string, any> =
            "switch_ips" in schemaProps && !("switch_ip" in schemaProps)
              ? { switch_ips: [restconfIp] }
              : { switch_ip: restconfIp };

          setIncludeRaw(true);
          await runNLWithText(`Run ${restconfTool}.`, {
            llm_mode: "deterministic",
            force_tool: restconfTool,
            force_inputs: { ...ipInputs, ...extra },
            include_raw: true,
          });
          openWidgetForTool(restconfTool);
          setQuickActive("restconf");
        }}
      >
        Run RESTCONF Tool
      </button>

      {(() => {
        const d = restconfTools.find((x) => x.name === restconfTool)?.description;
        return d ? (
          <div className="text-xs" style={{ opacity: 0.75, marginTop: 6 }}>
            {d}
          </div>
        ) : null;
      })()}
    </div>
  </div>
) : null}

{/* Admin sidebar — see components/AdminSidebar.tsx. */}
<AdminSidebar
  visible={true}
  collapsed={sidebarAdminCollapsed}
  setCollapsed={setSidebarAdminCollapsed}
  items={[
    { label: "Activity Log",   isOpen: adminActivityOpen,       onOpen: () => handleOpenAdminActivity() },
    { label: "Server Settings", isOpen: adminSettingsOpen,      onOpen: () => handleOpenAdminSettings() },
  ]}
/>

</Panel>
        </div>

        {/* Center: Dashboard */}
        <div className="col-span-12 lg:col-span-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <Card title="Picked Tool" value={resp?.picked?.tool ?? "—"} />
            <Card title="Status" value={resp ? "OK" : "—"} />
          </div>


{quickActive === "lldp_topology" && (() => {
  /* ── Shared ReactFlow edge-interaction handlers ── */
  const rfEdgeHandlers = {
    onPaneClick: () => setLldpEdgeTip(null),
    onEdgeMouseEnter: (evt: any, edge: any) => {
      const full = edge?.data?.fullLabel || edge?.label || "";
      setLldpEdgeTip({ text: String(full), x: evt?.clientX || 0, y: evt?.clientY || 0, pinned: false });
    },
    onEdgeMouseMove: (evt: any) => {
      setLldpEdgeTip((prev: any) => {
        if (!prev || prev.pinned) return prev;
        return { ...prev, x: evt?.clientX || prev.x, y: evt?.clientY || prev.y };
      });
    },
    onEdgeMouseLeave: () => {
      setLldpEdgeTip((prev: any) => {
        if (!prev || prev.pinned) return prev;
        return null;
      });
    },
    onEdgeClick: (evt: any, edge: any) => {
      evt?.stopPropagation?.();
      const full = edge?.data?.fullLabel || edge?.label || "";
      setLldpEdgeTip({ text: String(full), x: evt?.clientX || 0, y: evt?.clientY || 0, pinned: true });
    },
  };

  /* ── Figma-styled select helper ── */
  const fgSelect: React.CSSProperties = {
    padding: "6px 12px", fontSize: 12,
    background: "var(--inner-card-bg)", color: "var(--subtitle-color)",
    border: "1px solid var(--container-border)", borderRadius: 8,
    outline: "none",
  };

  /* ── Figma Network icon (inline SVG) ── */
  const lldpNetIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" />
    </svg>
  );

  return (
  <div style={{ ...widgetContainer() }}>

    {/* ── Header (Figma: bg-indigo-300/10, border-b border-slate-700) ── */}
    <div style={{
      padding: "16px 24px",
      background: "var(--header-tint-bg)",
      borderBottom: "1px solid var(--container-border)",
      display: "flex", alignItems: "start", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {lldpNetIcon}
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--heading-color)" }}>
            LLDP Topology Map
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--dim-color)" }}>
            Built from RESTCONF LLDP neighbor data &middot; best-effort
          </p>
        </div>
      </div>
      <button
        onClick={() => setQuickActive("")}
        style={{
          color: "var(--muted-color)", background: "transparent", border: "none",
          padding: 8, borderRadius: 8, cursor: "pointer", lineHeight: 0,
          transition: "all 0.15s",
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

    {/* ── Controls Bar (Figma: px-6 py-3, border-b, bg-slate-800/50) ── */}
    <div style={{
      padding: "12px 24px",
      borderBottom: "1px solid var(--container-border)",
      background: "var(--inner-card-bg)",
      display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {/* Seed IP */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted-color)", fontWeight: 500 }}>Seed:</span>
          <select
            style={fgSelect}
            value={lldpSeedIp}
            onChange={(e) => setLldpSeedIp(e.target.value)}
            disabled={switchOptionsLoading || !switchOptions.length}
          >
            {switchOptions.map((s) => (
              <option key={s.ip} value={s.ip}>
                {s.ip}{s.name ? ` \u2014 ${s.name}` : ""}
              </option>
            ))}
          </select>
          <button
            title="Refresh switch list"
            style={{
              padding: "5px 8px", fontSize: 12, borderRadius: 6,
              background: "transparent", border: "1px solid var(--container-border)", color: "var(--muted-color)",
              cursor: switchOptionsLoading ? "wait" : "pointer",
              opacity: switchOptionsLoading ? 0.4 : 0.7,
              transition: "all 0.15s",
            }}
            disabled={switchOptionsLoading}
            onClick={() => refreshSwitchOptions()}
          >{"\u27F3"}</button>
        </div>

        {/* Depth */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted-color)", fontWeight: 500 }}>Depth:</span>
          <select
            style={fgSelect}
            value={lldpDepth}
            onChange={(e) => setLldpDepth((Number(e.target.value) as any) === 2 ? 2 : 1)}
          >
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
          </select>
        </div>

        {/* Labels */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted-color)", fontWeight: 500 }}>Labels:</span>
          <select
            style={fgSelect}
            value={lldpLabelMode}
            onChange={(e) => setLldpLabelMode((e.target.value as any) === "off" ? "off" : (e.target.value as any) === "full" ? "full" : "compact")}
          >
            <option value={"compact"}>Compact</option>
            <option value={"full"}>Full</option>
            <option value={"off"}>Off</option>
          </select>
        </div>

        {/* Build button */}
        <button
          style={{
            padding: "6px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8,
            background: "#818cf8", border: "none", color: "#0f172a",
            cursor: (lldpLoading || !lldpSeedIp) ? "not-allowed" : "pointer",
            opacity: (lldpLoading || !lldpSeedIp) ? 0.5 : 1,
            transition: "all 0.15s",
          }}
          disabled={lldpLoading || !lldpSeedIp}
          onClick={() => buildLldpTopology(lldpSeedIp, lldpDepth)}
        >
          {lldpLoading ? "Building\u2026" : "Build"}
        </button>

        {lldpErr ? <span style={{ fontSize: 12, color: "#ef4444" }}>{lldpErr}</span> : null}
      </div>

      {/* Right side: Fullscreen + Zoom */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          style={{
            padding: "5px 10px", fontSize: 12, borderRadius: 6,
            background: "var(--inner-card-bg)", border: "1px solid var(--container-border)", color: "var(--muted-color)",
            cursor: "pointer", transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--heading-color)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-color)"; }}
          onClick={() => { setLldpFullscreen(true); setLldpEdgeTip(null); }}
          title="Open the topology map in full screen"
        >
          {/* Maximize2 icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>
    </div>

    {/* ── Main Content: Sidebar + ReactFlow Canvas ── */}
    <div style={{ display: "flex" }}>

      {/* Sidebar Legend */}
      <div style={{
        width: 150, flexShrink: 0, padding: 16,
        background: "var(--inner-card-bg-2)", borderRight: "1px solid var(--container-border)",
      }}>
        <div style={{ fontSize: 12, color: "var(--muted-color)", fontWeight: 500, marginBottom: 12 }}>Topology</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: "var(--btn-neutral-bg)", border: "1px solid var(--btn-secondary-border)" }} />
          <span style={{ fontSize: 11, color: "var(--muted-color)" }}>{lldpNodes.length}</span>
          <span style={{ fontSize: 11, color: "var(--dim-color)" }}>Nodes</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 12, height: 2, background: "#818cf8" }} />
          <span style={{ fontSize: 11, color: "var(--muted-color)" }}>{lldpEdges.length}</span>
          <span style={{ fontSize: 11, color: "var(--dim-color)" }}>Links</span>
        </div>

        <div style={{ borderTop: "1px solid var(--container-border)", margin: "12px 0", paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: "var(--dim-color)", marginBottom: 8 }}>Hop distance</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(137,129,229,0.15)", border: "2px solid #818cf8" }} />
            <span style={{ fontSize: 11, color: "var(--dim-color)" }}>Seed</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 14, height: 2, background: "#8981E5" }} />
            <span style={{ fontSize: 11, color: "var(--dim-color)" }}>Hop 1</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 14, height: 2, background: "rgba(137,129,229,0.35)" }} />
            <span style={{ fontSize: 11, color: "var(--dim-color)" }}>Hop 2</span>
          </div>
        </div>
      </div>

      {/* ReactFlow Canvas */}
      <div style={{ flex: 1, position: "relative", minHeight: 460, background: "rgba(15,23,42,0.2)" }}>
        {!lldpFullscreen && (
          <div style={{ height: 460 }}>
            <ReactFlow
              nodes={lldpNodes}
              edges={lldpEdges}
              fitView
              {...rfEdgeHandlers}
            >
              <MiniMap />
              <Controls />
              <Background />
            </ReactFlow>
          </div>
        )}

        {/* Footer Stats */}
        <div style={{
          position: "absolute", bottom: 8, left: 16,
          fontSize: 11, color: "var(--dim-color)",
        }}>
          {lldpNodes.length} nodes &middot; {lldpEdges.length} links &middot; Depth {lldpDepth}
        </div>
      </div>
    </div>

    {/* ── Edge Hover Tooltip ── */}
    {lldpEdgeTip ? (
      <div
        style={{
          position: "fixed",
          left: Math.min((lldpEdgeTip.x || 0) + 14, window.innerWidth - 380),
          top: Math.min((lldpEdgeTip.y || 0) + 14, window.innerHeight - 120),
          maxWidth: 360,
          background: "var(--container-bg)",
          color: "var(--heading-color)",
          border: "1px solid #818cf8",
          borderRadius: 8,
          boxShadow: "0 10px 26px rgba(0,0,0,0.55)",
          padding: "10px 14px",
          zIndex: 10001,
          pointerEvents: "none",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "ui-monospace,monospace",
          whiteSpace: "pre-line" as const,
        }}
      >
        {lldpEdgeTip.text}
        {lldpEdgeTip.pinned ? (
          <div style={{ fontSize: 10, fontWeight: 500, color: "var(--dim-color)", marginTop: 6 }}>Pinned (click empty area to clear)</div>
        ) : null}
      </div>
    ) : null}

    {/* ── Fullscreen Overlay ── */}
    {lldpFullscreen ? (
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        }}
        onClick={() => { setLldpFullscreen(false); setLldpEdgeTip(null); }}
      >
        <div
          style={{
            position: "absolute", inset: 24,
            background: "var(--container-bg)", border: "1px solid var(--container-border)",
            borderRadius: 12, overflow: "hidden",
            display: "flex", flexDirection: "column",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fullscreen Header */}
          <div style={{
            padding: "16px 24px",
            background: "var(--header-tint-bg)",
            borderBottom: "1px solid var(--container-border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {lldpNetIcon}
              <div>
                <div style={{ fontSize: 18, fontWeight: 500, color: "var(--heading-color)" }}>LLDP Topology Map</div>
                <div style={{ fontSize: 12, color: "var(--dim-color)", marginTop: 2 }}>Built from RESTCONF LLDP neighbor data &middot; best-effort</div>
              </div>
            </div>
            <button
              onClick={() => { setLldpFullscreen(false); setLldpEdgeTip(null); }}
              style={{
                color: "var(--muted-color)", background: "transparent", border: "none",
                padding: 8, borderRadius: 8, cursor: "pointer", lineHeight: 0,
                transition: "all 0.15s",
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

          {/* Fullscreen ReactFlow */}
          <div style={{ flex: 1, position: "relative" }}>
            <ReactFlow
              nodes={lldpNodes}
              edges={lldpEdges}
              fitView
              {...rfEdgeHandlers}
              proOptions={{ hideAttribution: true }}
            >
              <MiniMap />
              <Controls />
              <Background />
            </ReactFlow>
            <div style={{
              position: "absolute", bottom: 12, left: 20,
              fontSize: 11, color: "var(--dim-color)",
            }}>
              {lldpNodes.length} nodes &middot; {lldpEdges.length} links &middot; Depth {lldpDepth}
            </div>
          </div>
        </div>
      </div>
    ) : null}
  </div>
  );
})()}

{/* ── Fabric Topology (read-only Clos diagram) ───────────────────── */}
{/* FabricTopologyView — extracted to features/fabric/FabricTopologyView.tsx.
    Parent owns open + selected fabric; the component fetches + parses +
    renders the ReactFlow graph. */}
{fabricTopoOpen ? (
  <div style={{ marginTop: 12 }}>
    <FabricTopologyView
      open={fabricTopoOpen}
      fabricName={fabricTopoName}
      onPickFabric={(name) => setFabricTopoName(name)}
      onClose={() => { setFabricTopoOpen(false); setFabricTopoName(""); }}
    />
  </div>
) : null}

{/* ── Running-config CLI Widget ─────────────────────────────────── */}
{/* Running Config — see features/widgets/RunningConfigWidget.tsx. */}
<RunningConfigWidget
  open={runningConfigOpen}
  raw={resp?.raw}
  fullscreen={runningConfigFullscreen}
  setFullscreen={setRunningConfigFullscreen}
  onClose={() => setRunningConfigOpen(false)}
/>

{/* ── Interface Detail Widget ─────────────────────────────────── */}
{/* Interface Detail — see features/widgets/IfaceDetailWidget.tsx. */}
<IfaceDetailWidget
  open={ifaceDetailWidgetOpen}
  raw={resp?.raw}
  filter={ifaceDetailFilter}
  setFilter={setIfaceDetailFilter}
  tab={ifaceDetailTab}
  setTab={setIfaceDetailTab}
  sort={ifaceDetailSort}
  setSort={setIfaceDetailSort}
  animatePie={true}
  onClose={() => setIfaceDetailWidgetOpen(false)}
/>

{/* ── Interface Status Widget ─────────────────────────────────── */}
{/* Interface Status — see features/widgets/IfaceWidget.tsx. */}
<IfaceWidget
  open={ifaceWidgetOpen}
  raw={resp?.raw}
  filter={ifaceFilter}
  setFilter={setIfaceFilter}
  sort={ifaceSort}
  setSort={setIfaceSort}
  animatePie={true}
  onClose={() => setIfaceWidgetOpen(false)}
/>

{/* ── Device Clock Widget ─────────────────────────────────── */}
{clockWidgetOpen && (() => {
  const rawCk: any = resp?.raw ?? {};
  const payloadCk: any = rawCk?.result?.payload ?? rawCk?.payload ?? {};
  const metaCk: any = payloadCk?.meta ?? {};
  const summaryCk: any = payloadCk?.summary ?? {};
  const currentTime: string = summaryCk?.current_time ?? new Date().toISOString();
  const timezone: string = summaryCk?.timezone ?? "UTC";
  const switchIpCk: string = metaCk?.switch_ip ?? "";
  const uptimeCk: string = summaryCk?.system_uptime ?? payloadCk?.item?.system_uptime ?? cachedUptime;
  const fetchUptime = async () => {
    const ip = switchIpCk;
    if (!ip) return;
    try {
      const r: any = await postJSON<any>("/api/invoke", { tool: "restconf_show_firmware_version", inputs: { switch_ip: ip } });
      const p: any = r?.result?.payload ?? r?.payload ?? {};
      const ut: string = p?.summary?.system_uptime ?? p?.item?.system_uptime ?? "";
      if (ut) setCachedUptime(ut);
    } catch { /* ignore */ }
  };
  return (
    <ClockWidget
      currentTime={currentTime}
      timezone={timezone}
      switchIp={switchIpCk}
      uptime={uptimeCk || undefined}
      onFetchUptime={fetchUptime}
      onClose={() => setClockWidgetOpen(false)}
    />
  );
})()}

{/* ── All Switch Clocks + NTP Sync Widget (Figma: All_clock_widget) ── */}
{/* All Switch Clocks — see features/widgets/AllClocksModal.tsx. */}
<AllClocksModal
  open={allClocksOpen}
  loading={allClocksLoading}
  data={allClocksData as any}
  queryCount={allClocksQueryCount}
  totalSwitchCount={switchOptions.length}
  ntpServer={allClocksNtpServer}
  setNtpServer={setAllClocksNtpServer}
  ntpSubmitting={allClocksNtpSubmitting}
  onReload={() => handleOpenAllClocks()}
  onSubmitNtp={() => handleSubmitNtpSync()}
  onClose={() => setAllClocksOpen(false)}
/>

{/* Simple-shape mounts via SimpleToolResultWidgetMount. All follow the
    {items, summary, switchIp, onClose} pattern; the helper handles unwrap
    + render. Adding a new simple widget = 1 line here. */}
<SimpleToolResultWidgetMount open={portStatsWidgetOpen} resp={resp} Widget={PortStatsWidget} onClose={() => setPortStatsWidgetOpen(false)} />
<SimpleToolResultWidgetMount open={mediaWidgetOpen} resp={resp} Widget={MediaWidget} onClose={() => setMediaWidgetOpen(false)} />

{/* ── Fleet inventory / media / Compass (tier-2 console widgets) ────────
    Self-contained: each reads its own hook bundle, not `resp`. Opened
    via NL detectors + the inventory_getswitches registry entry. */}
{fleetMediaOpen && (
  <FleetMediaInventoryWidget
    items={fleetMedia.items}
    initialFilter={fleetMediaFilter}
    initialFabric={fleetMediaFabric}
    loading={fleetMedia.loading}
    errors={fleetMedia.errors}
    progress={fleetMedia.progress}
    onClose={() => setFleetMediaOpen(false)}
  />
)}
{fleetInvOpen && (
  <FleetInventoryWidget
    items={fleetInv.items}
    initialFilter={fleetInvFilter}
    initialFabric={fleetInvFabric}
    onClose={() => setFleetInvOpen(false)}
  />
)}
{ipMacSearchOpen && (
  <IpMacSearchWidget
    open={ipMacSearchOpen}
    initialQuery={ipMacSearchQuery}
    initialScopeIps={ipMacSearchScope}
    fleetSwitchIps={compassFleetIps}
    switchNameByIp={compassSwitchNameByIp}
    switchIpByName={compassSwitchIpByName}
    onClose={() => setIpMacSearchOpen(false)}
  />
)}

<SimpleToolResultWidgetMount open={ipIfaceWidgetOpen} resp={resp} Widget={IpIfaceWidget} onClose={() => setIpIfaceWidgetOpen(false)} />
<SimpleToolResultWidgetMount open={lldpNeighWidgetOpen} resp={resp} Widget={LldpNeighWidget} onClose={() => setLldpNeighWidgetOpen(false)} />
<SimpleToolResultWidgetMount open={arpTableWidgetOpen} resp={resp} Widget={ArpTableWidget} onClose={() => setArpTableWidgetOpen(false)} />
{/* MaintRate uses extraProps because it needs the additional `warnings` field —
    the rest of its shape matches the simple pattern. */}
<SimpleToolResultWidgetMount
  open={maintRateWidgetOpen} resp={resp} Widget={MaintRateWidget}
  onClose={() => setMaintRateWidgetOpen(false)}
  extraProps={{ warnings: (resp && unwrapWidgetPayload(resp).warnings) || [] }}
/>
<SimpleToolResultWidgetMount open={vlanBriefWidgetOpen} resp={resp} Widget={VlanBriefWidget} onClose={() => setVlanBriefWidgetOpen(false)} />
<SimpleToolResultWidgetMount open={vrfSummaryWidgetOpen} resp={resp} Widget={VrfSummaryWidget} onClose={() => setVrfSummaryWidgetOpen(false)} />

{/* ── Firmware Version Widget ──────────────────────────────── */}
{firmwareWidgetOpen && (() => {
  const { payload: payloadFw, summary: summaryFw, meta: metaFw } = unwrapWidgetPayload(resp);
  const itemFw: any = payloadFw?.item ?? {};
  const switchIpFw: string = metaFw?.switch_ip ?? itemFw?.switch_ip ?? "";
  return (
    <FirmwareVersionWidget
      item={itemFw}
      summary={summaryFw}
      switchIp={switchIpFw}
      onClose={() => setFirmwareWidgetOpen(false)}
    />
  );
})()}

{/* Tool-result widget mounts — see lib/ToolResultMounts.tsx.
    Parent owns the state; child just renders the matching one. */}
<ToolResultMounts
  resp={resp}
  swVerWidgetOpen={swVerWidgetOpen}
  setSwVerWidgetOpen={setSwVerWidgetOpen}
  alarmDetailsWidgetOpen={alarmDetailsWidgetOpen}
  setAlarmDetailsWidgetOpen={setAlarmDetailsWidgetOpen}
  fabricsHealthWidgetOpen={fabricsHealthWidgetOpen}
  setFabricsHealthWidgetOpen={setFabricsHealthWidgetOpen}
  fabricHealthWidgetOpen={fabricHealthWidgetOpen}
  setFabricHealthWidgetOpen={setFabricHealthWidgetOpen}
  monitorHealthWidgetOpen={monitorHealthWidgetOpen}
  setMonitorHealthWidgetOpen={setMonitorHealthWidgetOpen}
  tenantWidgetOpen={tenantWidgetOpen}
  setTenantWidgetOpen={setTenantWidgetOpen}
  epgWidgetOpen={epgWidgetOpen}
  setEpgWidgetOpen={setEpgWidgetOpen}
  onOpenFabricTopology={() => {}}
/>

{/* ── Tenant EPG Historical Report Widget ──────────────────────────────── */}
{tenantHistoryWidgetOpen && (() => {
  const { inner: innerTH } = unwrapWidgetPayloadDouble(resp);
  return (
    <TenantHistoryReportWidget
      payload={innerTH}
      tenantNames={tenantNames}
      tenantNamesLoading={tenantNamesLoading}
      selectedTenantName={selectedTenantName}
      onTenantChange={(n) => setSelectedTenantName(n)}
      windowDays={historyWindowDays}
      onWindowChange={(d) => setHistoryWindowDays(d)}
      allowUnscoped={historyAllowUnscoped}
      onAllowUnscopedChange={(v) => setHistoryAllowUnscoped(v)}
      nlRunning={nlRunning}
      onLoadTenants={() => loadTenantNames()}
      onRun={async (name, days, unscoped) => {
        setIncludeRaw(true);
        await runNLWithText(
          `Run tenant_get_service_epg_historical_report_stub for ${name}.`,
          {
            llm_mode: "deterministic",
            force_tool: "tenant_get_service_epg_historical_report_stub",
            force_inputs: { tenant_name: name, window_days: days, allow_unscoped: unscoped },
            include_raw: true,
          }
        );
        openWidgetForTool("tenant_get_service_epg_historical_report_stub");
        setQuickActive("tenant_history");
      }}
      onClose={() => setTenantHistoryWidgetOpen(false)}
    />
  );
})()}

{/* SwVer is rendered by ToolResultMounts.tsx (above). */}

{/* ── BGP Summary Widget ────────────────────────────────────────────── */}
{bgpWidgetOpen && bgpWidgetData && (() => {
  const switches: any[] = bgpWidgetData?.switches ?? [];
  const summary = bgpWidgetData?.summary ?? {};
  const fabName = bgpWidgetData?.fabric_name || "";
  const [bgpExpanded, setBgpExpanded] = [
    (window as any).__bgpExpanded as Set<string> ?? new Set<string>(),
    (s: Set<string>) => { (window as any).__bgpExpanded = s; setBgpWidgetData({ ...bgpWidgetData }); },
  ];
  const toggleSwitch = (ip: string) => {
    const next = new Set(bgpExpanded);
    next.has(ip) ? next.delete(ip) : next.add(ip);
    setBgpExpanded(next);
  };

  return (
    <div className="w-full max-w-5xl bg-slate-800 rounded-xl shadow-xl overflow-hidden border border-slate-700">
      <div className="bg-indigo-300/10 px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-slate-200 text-lg font-medium">BGP Summary</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              {fabName ? `Fabric: ${fabName} · ` : ""}{summary.total_switches ?? switches.length} switches · {summary.total_neighbors ?? 0} BGP neighbors
            </p>
          </div>
          <button onClick={() => setBgpWidgetOpen(false)} className="text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg p-2 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div className="p-6 space-y-4" style={{ maxHeight: "70vh", overflowY: "auto" }}>
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3 text-center">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-1">Switches</div>
            <div className="text-slate-200 text-2xl font-medium">{summary.total_switches ?? switches.length}</div>
            <div className="text-green-400 text-xs mt-1">{summary.switches_ok ?? switches.filter((s: any) => s.ok).length} healthy</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3 text-center">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-1">BGP Neighbors</div>
            <div className="text-slate-200 text-2xl font-medium">{summary.total_neighbors ?? 0}</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3 text-center">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-1">Status</div>
            {(() => {
              const allOk = summary.all_healthy || (summary.switches_ok === summary.total_switches && summary.switches_ok > 0);
              const hasErrors = switches.some((s: any) => !s.ok);
              const color = hasErrors ? "text-red-400" : allOk ? "text-green-400" : "text-yellow-400";
              const label = hasErrors ? "Error" : allOk ? "Healthy" : "OK";
              return <div className={`text-2xl font-medium ${color}`}>{label}</div>;
            })()}
          </div>
        </div>

        {/* Per-switch expandable list */}
        <div className="space-y-2">
          {switches.map((sw: any) => {
            const ip = sw.switch_ip || "";
            const swName = switchOptions.find((s) => s.ip === ip)?.name || ip;
            const isExp = bgpExpanded.has(ip);
            const neighbors: any[] = sw.neighbors ?? [];
            const peerGroups = sw.peer_groups ?? {};

            return (
              <div key={ip} className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSwitch(ip)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-900/70 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: sw.ok ? "#4ade80" : "#f87171" }} />
                    <span className="text-slate-200 text-sm font-medium">{swName}</span>
                    <code className="text-slate-400 text-xs">{ip}</code>
                    <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">AS {sw.local_as}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 text-sm">{neighbors.length} neighbors</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: "var(--dim-color)", transform: isExp ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </button>
                {isExp && neighbors.length > 0 && (
                  <div className="border-t border-slate-700/50">
                    {/* Peer groups */}
                    {Object.keys(peerGroups).length > 0 && (
                      <div className="px-4 py-2 bg-slate-900/30 flex gap-3 flex-wrap">
                        {Object.entries(peerGroups).map(([name, pg]: [string, any]) => (
                          <span key={name} className="text-xs px-2 py-1 rounded bg-slate-700/50 text-slate-300 border border-slate-600">
                            {name} {pg.remote_as ? `→ AS ${pg.remote_as}` : ""} {pg.description ? `(${pg.description})` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Neighbor table */}
                    <div className="grid grid-cols-4 gap-4 px-4 py-2 bg-slate-900/20 border-b border-slate-700/50">
                      <div className="text-slate-500 text-xs uppercase">Neighbor IP</div>
                      <div className="text-slate-500 text-xs uppercase">Remote AS</div>
                      <div className="text-slate-500 text-xs uppercase">Peer Group</div>
                      <div className="text-slate-500 text-xs uppercase">Description</div>
                    </div>
                    {neighbors.map((nbr: any, ni: number) => (
                      <div key={ni} className="grid grid-cols-4 gap-4 px-4 py-2 border-b border-slate-700/30 last:border-b-0 hover:bg-slate-900/40 transition-colors">
                        <code className="text-slate-200 text-xs">{nbr.neighbor_ip}</code>
                        <span className="text-indigo-400 text-xs font-mono">{nbr.remote_as || "—"}</span>
                        <span className="text-slate-400 text-xs">{nbr.peer_group || "—"}</span>
                        <span className="text-slate-500 text-xs">{nbr.peer_group_description || "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
})()}

{/* ── Per-skill Input Prompt (e.g. Pre-RMA needs a failed-switch IP) ──── */}
{/* Skill input prompt — see features/agent/SkillPromptModal.tsx. */}
<SkillPromptModal
  open={skillPromptOpen}
  config={(AGENT_SKILLS[skillPromptSkillKey] as any) ?? null}
  values={skillPromptValues}
  setValues={setSkillPromptValues}
  error={skillPromptError}
  setError={setSkillPromptError}
  onClose={() => setSkillPromptOpen(false)}
  onSubmit={() => {
    const cfg = AGENT_SKILLS[skillPromptSkillKey];
    if (!cfg?.inputPrompt) return;
    const query = cfg.inputPrompt.composeQuery(skillPromptValues, text);
    setSkillPromptOpen(false);
    runAgentSkillWithQuery(skillPromptSkillKey as AgentSkillKey, query);
  }}
/>


{/* ── Investigate (agent skill) result panel ──────────────────────────── */}
{/* AI Agent Investigate — see features/agent/InvestigateModal.tsx. */}
<InvestigateModal
  open={investigateOpen}
  title={(() => {
    if (investigateActiveSkillKey && AGENT_SKILLS[investigateActiveSkillKey]) {
      return `AI Agent — ${AGENT_SKILLS[investigateActiveSkillKey].panelDisplayName}`;
    }
    const fromResult = (investigateResult as any)?.skill || (investigateResult as any)?.skill_meta?.name;
    return fromResult ? `AI Agent — ${fromResult}` : "AI Agent";
  })()}
  running={investigateRunning}
  result={investigateResult as any}
  liveTrace={investigateLiveTrace}
  elapsedMs={investigateElapsedMs}
  liveTraceScrollRef={liveTraceScrollRef}
  traceOpen={investigateTraceOpen}
  setTraceOpen={setInvestigateTraceOpen}
  renderedSynthesis={investigateResult?.synthesis ? renderMarkdown(investigateResult.synthesis) : null}
  onClose={() => setInvestigateOpen(false)}
/>

{/* ── Help / Capabilities Widget (Figma-styled modal) ──────────────── */}
{/* Natural Language Examples (Help) — see features/help/HelpWidget.tsx. */}
<HelpWidget
  open={helpWidgetOpen}
  expandedCats={helpExpandedCats}
  setExpandedCats={setHelpExpandedCats}
  exampleNames={(() => {
    const leaves = switchOptions.filter((s) => /leaf/i.test(s.name || "")).filter((s) => !/border/i.test(s.name || ""));
    const spines = switchOptions.filter((s) => /spine/i.test(s.name || ""));
    return {
      fab: "my-fabric",
      // A real tenant from the current XCO for tenant-scoped examples (no
      // hardcoded names). selectedTenantName auto-resolves to the first tenant.
      tenant: selectedTenantName || tenantNames[0] || "my-tenant",
      leaf: (i: number) => leaves[i]?.name || "Leaf-" + (i + 1),
      spine: (i: number) => spines[i]?.name || "Spine-" + (i + 1),
    };
  })()}
  onClose={() => setHelpWidgetOpen(false)}
  onPick={(cmd) => setText(cmd)}
/>

{/* ── Switch Picker Widget ───────────────────────────────────────────── */}
{/* Switch Picker — see components/SwitchPickerModal.tsx. */}
<SwitchPickerModal
  open={switchPickerOpen}
  title={switchPickerTitle}
  switches={switchOptions}
  onPick={(ip, name) => { if (switchPickerCallback.current) switchPickerCallback.current(ip, name); }}
  onClose={() => setSwitchPickerOpen(false)}
/>

{/* ── Tier 4: Activity Log Widget ──────────────────────────────────────── */}
{/* Replaces the former top-nav "Audit" tab. Same data source (/api/audit
    via loadAudit), now wrapped in the standard admin-widget chrome so it
    sits naturally next to Audit Ledger in the Admin sidebar. */}
{/* Activity Log — see features/admin/ActivityLogPanel.tsx. */}
<ActivityLogPanel
  open={adminActivityOpen}
  loading={auditLoading}
  err={auditErr}
  records={auditRecords}
  onReload={loadAudit}
  onClose={() => setAdminActivityOpen(false)}
/>

{/* ── Admin: Server Settings ──────────────────────────────────────────── */}
{/* Server Settings — see features/admin/ServerSettingsPanel.tsx.
    Composes the MCP-server / Ollama / OpenAI-key config sections so this
    panel is the single home for client configuration. */}
<ServerSettingsPanel
  open={adminSettingsOpen}
  loading={adminSettingsLoading}
  err={adminSettingsErr}
  settings={adminSettings}
  onChangeSetting={async (key, value) => {
    try {
      setAdminSettingsErr("");
      await patchJSON<any>("/api/client-settings", { [key]: value });
      setAdminSettings((prev) => ({ ...prev, [key]: value }));
    } catch (err: any) { setAdminSettingsErr(err.message ?? "Failed to update"); }
  }}
  onClose={() => setAdminSettingsOpen(false)}
>
  <McpServerSection config={adminSettings} saveSetting={saveClientSetting} />
  <OllamaSection config={adminSettings} saveSetting={saveClientSetting} />
  <OpenAiKeySection
    openaiKey={openaiKey} setOpenaiKey={setOpenaiKey}
    openaiModel={openaiModel} setOpenaiModel={setOpenaiModel}
    openaiKeySet={openaiKeySet} setOpenaiKeySet={setOpenaiKeySet}
    openaiKeySaving={openaiKeySaving} setOpenaiKeySaving={setOpenaiKeySaving}
    adminClientConfig={adminSettings}
    savedFlash={savedFlash} setSavedFlash={setSavedFlash}
  />
</ServerSettingsPanel>


          {viz.kind !== "none" && !anyTierWidgetOpen && quickActive !== "lldp_topology" && <Panel title={chartMeta.title}>
            <p style={{ marginTop: 0, opacity: 0.85 }}>{chartMeta.subtitle}</p>

            {chartSupported ? (
              <>

                {viz.kind === "device_health" && (
                  <DeviceHealthViz
                    data={viz.deviceHealth ?? {}}
                    animatePie={true}
                  />
                )}

                {viz.kind === "donut" && (
                  <DonutChartViz data={viz.donut ?? []} animatePie={true} />
                )}

                {viz.kind === "bar" && (
                  <BarChartViz data={viz.data ?? []} xKey={viz.xKey} keys={viz.keys as string[] | undefined} />
                )}

                {viz.kind === "stacked" && (
                  <StackedBarViz data={viz.data ?? []} xKey={viz.xKey} keys={viz.keys as string[] | undefined} />
                )}

                {viz.kind === "ha_health" && (
                  <HaHealthViz data={(viz as any).haHealth} animatePie={true} />
                )}

                {viz.kind === "notif_events" && (
                  <NotifEventsViz data={(viz as any).notifEvents} />
                )}

                {viz.kind === "notif_delivery" && (
                  <NotifDeliveryViz data={(viz as any).notifDelivery} barData={viz.data ?? []} />
                )}

                {viz.kind === "exec_diagnostic" && (
                  <ExecDiagnosticViz data={(viz as any).execDiag} />
                )}

                {viz.table && (
                  <div style={{ marginTop: 12, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {viz.table.columns.map((c) => (
                            <th
                              key={c}
                              style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                borderBottom: "1px solid var(--border)",
                                opacity: 0.9,
                              }}
                            >
                              {(viz.table as any)?.columnLabels?.[c] ?? c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {viz.table.rows.map((row, idx) => (
                          <tr key={idx}>
                            {viz.table!.columns.map((c) => (
                              <td
                                key={c}
                                style={{
                                  padding: "8px 10px",
                                  borderBottom: "1px solid var(--divider)",
                                  opacity: 0.95,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {String((row as any)[c] ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div style={{ opacity: 0.75 }}>No visualization available for this tool yet.</div>
            )}
          </Panel>}
        </div>

        {/* Right: AI panel */}
        <div className="col-span-12 lg:col-span-3">
          <Panel title="AI Console" allowOverflow>
            <div className="flex gap-2 mb-3">
              <div className="text-sm opacity-80 self-center">Examples:</div>
              <select
                className="flex-1 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--bg0)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="All">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            
            {/* AI Engine selector + status */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted-color)", whiteSpace: "nowrap" }}>AI engine:</span>
                <select
                  value={nlMode}
                  onChange={(e) => setNlMode(e.target.value as any)}
                  style={{
                    flex: 1,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid var(--subtle-border)",
                    borderRadius: 6, padding: "6px 10px", color: "var(--heading-color)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  <option value="deterministic">Fast (deterministic only)</option>
                  <option value="smart">Smart (deterministic + OpenAI fallback)</option>
                  <option value="openai">OpenAI (always)</option>
                  <option value="ollama">Ollama (local LLM)</option>
                </select>
                {nlRunning && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted-color)", whiteSpace: "nowrap" }}>
                    <span className="inline-block h-3 w-3 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
                    {Math.max(1, Math.ceil(nlElapsedMs / 1000))}s
                  </span>
                )}
              </div>
              {/* OpenAI key now lives in Client Config — show status + link. */}
              {(nlMode === "openai" || nlMode === "smart") && (
                <div style={{ fontSize: 11, color: "var(--dim-color)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: (openaiKeySet || openaiKey.length > 5) ? "#86efac" : "#fbbf24" }}>
                    {(openaiKeySet || openaiKey.length > 5) ? `\u2713 OpenAI key active (${openaiModel})` : "\u26a0 No OpenAI key set"}
                  </span>
                  <button
                    onClick={() => handleOpenAdminSettings()}
                    style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}
                    title="The OpenAI key is configured in Server Settings"
                  >
                    {(openaiKeySet || openaiKey.length > 5) ? "change in Server Settings \u2192" : "set in Server Settings \u2192"}
                  </button>
                </div>
              )}
            </div>

            {/* NL shortcut chips removed — duplicated by quick-action buttons */}

<textarea
              className="w-full rounded-md p-3 mb-3"
              style={{
                background: "var(--bg0)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
              rows={7}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setForcedTool(null);
                setForcedInputs({});
              }}
              placeholder="Type a natural-language request…"
            />

            {/* SkillSuggestionChip — see components/SkillSuggestionChip.tsx.
                Matching logic kept here (parent owns the registry + dismissal
                state); chip component is presentational. */}
            {(() => {
              const lower = text.trim().toLowerCase();
              if (!lower || lower === skillChipDismissedFor.toLowerCase()) return null;
              if (agentSkillsRegistry.length === 0) return null;
              // Keyword-tier (client-side) match only.
              const matched = agentSkillsRegistry.find((s) =>
                s.trigger_keywords.some((kw) => lower.includes(kw.toLowerCase()))
              );
              if (!matched) return null;
              const frontendKey = Object.keys(AGENT_SKILLS).find(
                (k) => AGENT_SKILLS[k].skill === matched.name
              );
              if (!frontendKey) return null;
              const cfg = AGENT_SKILLS[frontendKey];
              return (
                <SkillSuggestionChip
                  matchedConfig={{ buttonLabel: cfg.buttonLabel, accent: cfg.accent, description: cfg.description }}
                  matchedKey={frontendKey}
                  isLlmSuggestion={false}
                  llmReason=""
                  onRun={(k) => runAgentSkill(k as AgentSkillKey)}
                  onDismiss={() => setSkillChipDismissedFor(text)}
                />
              );
            })()}

            <label className="flex items-center gap-2 text-sm mb-3">
              <input
                type="checkbox"
                checked={includeRaw}
                onChange={(e) => setIncludeRaw(e.target.checked)}
              />
              Include raw evidence (may be large)
            </label>

            <div className="flex gap-2">
              <button
	                className={`flex-1 rounded-md px-3 py-2 ${nlRunning ? "opacity-70 cursor-not-allowed" : ""}`}
                style={{ background: "var(--accent)" }}
	                disabled={nlRunning}
	                onClick={runNL}
              >
	                {nlRunning ? (
	                  <span className="inline-flex items-center justify-center gap-2">
	                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
	                    Running… {Math.max(1, Math.ceil(nlElapsedMs / 1000))}s
	                  </span>
	                ) : (
	                  "Run"
	                )}
              </button>
              <button
	                className={`flex-1 rounded-md px-3 py-2 ${nlRunning ? "opacity-70 cursor-not-allowed" : ""}`}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                }}
	                disabled={nlRunning}
                onClick={() => {
              setQuickActive("example");
              randomExample();
            }}
              >
                Example
              </button>
            </div>

            {/* AI Investigation Skills dropdown — see features/agent/AiInvestigationSkillsDropdown.tsx. */}
            <AiInvestigationSkillsDropdown
              skills={AGENT_SKILLS}
              runSkill={(k) => runAgentSkill(k as AgentSkillKey)}
              onShowFullSkillSet={() => {}}
              investigateRunning={investigateRunning}
              nlRunning={nlRunning}
              investigateActiveSkillKey={investigateActiveSkillKey || null}
              investigateElapsedMs={investigateElapsedMs}
            />

            {err && (
              <div className="mt-3 text-sm" style={{ color: "#ffb4b4" }}>
                {err}
              </div>
            )}

            <div className="mt-4">
              <div className="flex gap-2 mb-2">
                <button
                  className="flex-1 rounded-md px-3 py-2 text-sm"
                  style={{
                    background:
                      viewMode === "summary" ? "var(--accent)" : "transparent",
                    border:
                      viewMode === "summary"
                        ? "none"
                        : "1px solid var(--border)",
                  }}
                  onClick={() => setViewMode("summary")}
                >
                  Summary
                </button>

                <button
                  className="flex-1 rounded-md px-3 py-2 text-sm"
                  style={{
                    background:
                      viewMode === "explain" ? "var(--accent)" : "transparent",
                    border:
                      viewMode === "explain"
                        ? "none"
                        : "1px solid var(--border)",
                  }}
                  onClick={() => setViewMode("explain")}
                >
                  Explain
                </button>

                <button
                  className="flex-1 rounded-md px-3 py-2 text-sm"
                  style={{
                    background:
                      viewMode === "raw" ? "var(--accent)" : "transparent",
                    border:
                      viewMode === "raw" ? "none" : "1px solid var(--border)",
                  }}
                  onClick={() => setViewMode("raw")}
                >
                  Raw
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <pre
                  className="text-xs rounded-md p-3 overflow-auto whitespace-pre-wrap"
                  style={{
                    background: "var(--bg0)",
                    border: "1px solid var(--border)",
                    maxHeight: 260,
                  }}
                >
{viewMode === "summary"
  ? renderWithFilters(renderHumanSummary(), false)
  : viewMode === "explain"
  ? renderWithFilters(renderExplain(), true)
  : cachedRawJson.display}
                </pre>
                <div style={{ position: "absolute", top: 6, right: 6 }}>
                  <CopyButton text={viewMode === "raw" ? cachedRawJson.full : viewMode === "explain" ? (cachedRawJson.explain ?? "") : cachedRawJson.full} />
                </div>
              </div>

              <div className="flex items-center justify-between mt-3 mb-2">
                <div className="text-sm opacity-80">Picked Invocation</div>
                <CopyButton text={JSON.stringify(resp?.picked ?? {}, null, 2)} />
              </div>
              <pre
                className="text-xs rounded-md p-3 overflow-auto"
                style={{
                  background: "var(--bg0)",
                  border: "1px solid var(--border)",
                  maxHeight: 120,
                }}
              >
{JSON.stringify(resp?.picked ?? {}, null, 2)}
              </pre>
            </div>
          </Panel>
        </div>
      </div>
      ) : (
        <Suspense fallback={
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted-color)", fontSize: 14 }}>
            <span className="inline-block h-5 w-5 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" style={{ marginRight: 10, verticalAlign: "middle" }} />
            Loading Tools view…
          </div>
        }>
        <ToolsView
          tools={tools}
          toolQuery={toolQuery}
          setToolQuery={setToolQuery}
          toolCategory={toolCategory}
          setToolCategory={setToolCategory}
          selectedTool={selectedTool}
          setSelectedTool={setSelectedTool}
          setActiveTab={setActiveTab}
          runNLWithText={runNLWithText}
          setIncludeRaw={setIncludeRaw}
          setViewMode={setViewMode}
          setForcedTool={setForcedTool}
          setForcedInputs={setForcedInputs}
        />
        </Suspense>
      )}

    </div>
  );
}
