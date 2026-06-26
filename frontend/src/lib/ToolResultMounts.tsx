// ToolResultMounts — tool-result widget mount blocks.
//
// Each widget that follows a distinct unwrap pattern (more complex
// than the simple {items, summary, switchIp} shape that
// SimpleToolResultWidgetMount handles) lives here as its own
// conditional render. The parent owns the open-state booleans + the
// resp object + any callbacks the widgets need; this file just
// renders.
//
// Widgets NOT in this file (kept inline in App.tsx because they have
// tight App.tsx-scope coupling that doesn't extract cleanly without
// significant restructuring):
//   - ClockWidget        — fetchUptime callback uses postJSON +
//                          setCachedUptime closure
//   - FirmwareVersionWidget — singular `item` shape + custom switchIp
//                             derivation from item.switch_ip fallback
//   - TenantHistoryReportWidget — onRun callback uses runNLWithText +
//                                 openWidgetForTool + setQuickActive
//   - BgpWidget          — 200-line inline JSX (not yet a separate
//                          component file)
//
// This file is a pure presentational dispatcher. Adding a new complex
// widget = one conditional block here + one prop in the props interface
// + one mount-table entry in App.tsx.

import { unwrapWidgetPayloadDouble } from "./widgetResp";
import { AlarmDetailsWidget } from "../components/AlarmDetailsWidget";
import { FabricHealthSummaryWidget } from "../components/FabricHealthSummaryWidget";
import { FabricsHealthWidget } from "../components/FabricsHealthWidget";
import { MonitorHealthWidget } from "../components/MonitorHealthWidget";
import { TenantWidget } from "../components/TenantWidget";
import { EpgWidget } from "../components/EpgWidget";
import { SoftwareVersionMismatchWidget } from "../components/SoftwareVersionMismatchWidget";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ToolResultMountsProps {
  /** The /api/nl response wrapping the tool result. Source of truth
   *  for every widget's payload — each mount unwraps the bits it needs. */
  resp: any;

  // ── Open-state booleans + setters per widget ──────────────────
  swVerWidgetOpen: boolean;
  setSwVerWidgetOpen: (v: boolean) => void;

  alarmDetailsWidgetOpen: boolean;
  setAlarmDetailsWidgetOpen: (v: boolean) => void;

  fabricsHealthWidgetOpen: boolean;
  setFabricsHealthWidgetOpen: (v: boolean) => void;

  fabricHealthWidgetOpen: boolean;
  setFabricHealthWidgetOpen: (v: boolean) => void;

  monitorHealthWidgetOpen: boolean;
  setMonitorHealthWidgetOpen: (v: boolean) => void;

  tenantWidgetOpen: boolean;
  setTenantWidgetOpen: (v: boolean) => void;

  epgWidgetOpen: boolean;
  setEpgWidgetOpen: (v: boolean) => void;

  // ── Parent-owned context the widgets need ─────────────────────
  /** Fabric topology opener — used by Fabric Health + Fabrics Health
   *  to deep-link to a specific fabric's topology view. App.tsx owns
   *  this because opening topology requires resetting multiple state
   *  buckets (NL prompt, active tab, etc.). */
  onOpenFabricTopology: (fabricName: string) => void;

}

export function ToolResultMounts(props: ToolResultMountsProps) {
  const {
    resp,
    swVerWidgetOpen, setSwVerWidgetOpen,
    alarmDetailsWidgetOpen, setAlarmDetailsWidgetOpen,
    fabricsHealthWidgetOpen, setFabricsHealthWidgetOpen,
    fabricHealthWidgetOpen, setFabricHealthWidgetOpen,
    monitorHealthWidgetOpen, setMonitorHealthWidgetOpen,
    tenantWidgetOpen, setTenantWidgetOpen,
    epgWidgetOpen, setEpgWidgetOpen,
    onOpenFabricTopology,
  } = props;

  return (
    <>
      {/* ── Software Version Mismatch Widget ──────────────────── */}
      {swVerWidgetOpen && (() => {
        const { inner: innerSW } = unwrapWidgetPayloadDouble(resp);
        return (
          <SoftwareVersionMismatchWidget
            payload={innerSW}
            onClose={() => setSwVerWidgetOpen(false)}
          />
        );
      })()}

      {/* ── Alarm Details with Context Widget ─────────────────── */}
      {alarmDetailsWidgetOpen && (() => {
        const { inner: innerAD } = unwrapWidgetPayloadDouble(resp);
        return (
          <AlarmDetailsWidget
            resolved={innerAD?.resolved ?? {}}
            summary={innerAD?.summary ?? {}}
            explanation={innerAD?.explanation ?? ""}
            instances={Array.isArray(innerAD?.alarm_instances) ? innerAD.alarm_instances : []}
            relatedAlerts={Array.isArray(innerAD?.related_alerts) ? innerAD.related_alerts : []}
            resourceHealth={innerAD?.resource_health ?? {}}
            warnings={Array.isArray(innerAD?.warnings) ? innerAD.warnings : []}
            nextActions={Array.isArray(innerAD?.next_actions) ? innerAD.next_actions : []}
            onClose={() => setAlarmDetailsWidgetOpen(false)}
          />
        );
      })()}

      {/* ── Fabrics Health Widget ─────────────────────────────── */}
      {fabricsHealthWidgetOpen && (() => {
        const rawFHH: any = resp?.raw ?? {};
        const payloadFHH: any = rawFHH?.result?.payload ?? rawFHH?.payload ?? [];
        const fabricsFHH: any[] = Array.isArray(payloadFHH) ? payloadFHH : [];
        return (
          <FabricsHealthWidget
            fabrics={fabricsFHH}
            onClose={() => setFabricsHealthWidgetOpen(false)}
            onFabricClick={(name) => {
              // Close the plural widget BEFORE opening topology so the
              // operator sees the topology modal alone, not stacked under
              // the fabrics list. The singular FabricHealthSummaryWidget
              // (below) already does this; the plural was missing it.
              // handleOpenFabricTopology's closeAllTier3Widgets() does
              // NOT include the inline result widgets (those live in
              // closeAllConsoleWidgets), so this explicit close is the
              // only thing that unmounts the panel.
              setFabricsHealthWidgetOpen(false);
              onOpenFabricTopology(name);
            }}
          />
        );
      })()}

      {/* ── Fabric Health Summary Widget ──────────────────────── */}
      {fabricHealthWidgetOpen && (() => {
        const { inner: innerFH } = unwrapWidgetPayloadDouble(resp);
        const fabricName: string = innerFH?.filter?.name ?? "";
        const globalCtx: any = innerFH?.global_context ?? {};
        const fabrics: any[] = globalCtx?.fabrics ?? [];
        // Derive headline: use explicit field when present
        // (single-fabric drill-down), otherwise compute worst-health
        // across all fabrics from global_context.
        const _hs = (h: string) => {
          const v = String(h ?? "").toLowerCase();
          return v === "red" ? 0 : v === "yellow" ? 1 : v === "green" ? 2 : 3;
        };
        const headline: any = innerFH?.headline ?? (fabrics.length ? {
          fabric_health:   fabrics.reduce((w, f) => _hs(f.fabric_health)   < _hs(w) ? f.fabric_health   : w, fabrics[0].fabric_health   ?? ""),
          topology_health: fabrics.reduce((w, f) => _hs(f.topology_health) < _hs(w) ? f.topology_health : w, fabrics[0].topology_health ?? ""),
        } : {});
        const deviceCounts: any = innerFH?.device_health_counts ?? {};
        const unhealthyDevices: any[] = innerFH?.unhealthy_devices ?? [];
        const serviceHealth: any = innerFH?.service_health ?? {};
        return (
          <FabricHealthSummaryWidget
            fabricName={fabricName}
            headline={headline}
            fabrics={fabrics}
            deviceCounts={deviceCounts}
            unhealthyDevices={unhealthyDevices}
            serviceHealth={serviceHealth}
            onClose={() => setFabricHealthWidgetOpen(false)}
            onFabricClick={(name) => {
              setFabricHealthWidgetOpen(false);
              onOpenFabricTopology(name);
            }}
          />
        );
      })()}

      {/* ── Monitor Health Widget ─────────────────────────────── */}
      {monitorHealthWidgetOpen && (() => {
        const rawMH: any = resp?.raw ?? {};
        const payloadMH: any = rawMH?.result?.payload ?? rawMH?.payload ?? {};
        const itemsMH: any[] = payloadMH?.items ?? [];
        const metaMH: any = rawMH?.result?.meta ?? rawMH?.meta ?? {};
        const hostMH: string = (() => {
          try { return new URL(metaMH?.url ?? "").hostname; } catch { return metaMH?.url ?? ""; }
        })();
        return (
          <MonitorHealthWidget
            items={itemsMH}
            host={hostMH}
            onClose={() => setMonitorHealthWidgetOpen(false)}
          />
        );
      })()}

      {/* ── Tenant Widget ─────────────────────────────────────── */}
      {tenantWidgetOpen && (() => {
        const rawTN: any = resp?.raw ?? {};
        const payloadTN: any = rawTN?.result?.payload ?? rawTN?.payload ?? {};
        const tenantsTN: any[] = Array.isArray(payloadTN?.tenant) ? payloadTN.tenant : [];
        return (
          <TenantWidget
            tenants={tenantsTN}
            onClose={() => setTenantWidgetOpen(false)}
          />
        );
      })()}

      {/* ── EPG Widget ────────────────────────────────────────── */}
      {epgWidgetOpen && (() => {
        const rawEP: any = resp?.raw ?? {};
        const outerEP: any = rawEP?.result?.payload ?? rawEP?.payload ?? {};
        // tier2 server wraps its return in {status, payload} —
        // unwrap one extra level if present.
        const payloadEP: any = outerEP?.payload ?? outerEP;
        const tenantsEP: any[] = Array.isArray(payloadEP?.tenants) ? payloadEP.tenants : [];
        return (
          <EpgWidget
            tenants={tenantsEP}
            onClose={() => setEpgWidgetOpen(false)}
          />
        );
      })()}

    </>
  );
}
