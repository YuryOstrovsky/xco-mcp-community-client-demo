// useFleetInventory — parallel-fetches inventory_getswitches + the new
// inventory_get_chassis_info_bulk tool and joins by ip_address. Returns
// switch rows enriched with serial_number + part_number (the actual
// orderable SKU, distinct from chassis_name which is the marketing model).
//
// Why a hook (vs the NL→resp pipeline the chassis widget was using):
//   • Two tool calls needed, and we want them in parallel.
//   • The join logic lives in one place.
//   • Per the server team's handoff: cache chassis-bulk for ~30s per
//     session — XCO refreshes its inventory cache every ~60s, so 30s
//     client TTL is safe. (Caching deferred — single-call cost is ~125ms
//     for the bulk-export call, so the operator hit is negligible.)

import { useCallback, useState } from "react";
import { postJSON } from "./api";
import type { FleetInventoryRow } from "../components/FleetInventoryWidget";

interface ChassisInfoRow {
  hostname?: string;
  ip_address?: string;
  site_name?: string;
  os_version?: string;
  serial_number?: string;
  part_number?: string;
}

export function useFleetInventory() {
  const [items, setItems] = useState<FleetInventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const refresh = useCallback(async (site?: string) => {
    setLoading(true);
    setErr("");
    // Clear items so the operator never sees stale data from a previous
    // site while the new fetch is in flight. Without this, switching
    // lab-b → lab-a would briefly show lab-b's rows.
    setItems([]);
    // Multi-site routing — every /invoke gets `site` in inputs when set.
    // Mirrors the siteInputs() helper in App.tsx; we accept the site as
    // a parameter rather than calling currentSiteId() (which is a
    // component-local function), so the hook stays portable.
    const siteWire = site ? { site } : {};
    try {
      // Parallel fetch — both calls are cheap (~125ms each for the bulk
      // export, slightly more for the switch list). Promise.all means
      // total wait = max of the two, not sum.
      const [swResp, chResp] = await Promise.all([
        postJSON<any>("/api/invoke", {
          tool: "inventory_getswitches",
          inputs: { ...siteWire },
        }),
        postJSON<any>("/api/invoke", {
          tool: "inventory_get_chassis_info_bulk",
          inputs: { ...siteWire },
        }).catch((e: any) => {  // eslint-disable-line — catch-error idiom
          // Tolerate failure: older MCP servers don't have this tool yet.
          // The switch list still works; Serial column just stays "—".
          return { _err: String(e?.message || e).slice(0, 200) };
        }),
      ]);

      // Switch list
      const swPayload = swResp?.result?.payload ?? swResp?.payload ?? swResp;
      const switches: FleetInventoryRow[] = Array.isArray(swPayload)
        ? swPayload
        : Array.isArray(swPayload?.items)    ? swPayload.items
        : Array.isArray(swPayload?.switches) ? swPayload.switches
        : [];

      // Chassis bulk — index by ip_address for the join.
      const chassisByIp = new Map<string, ChassisInfoRow>();
      if (!(chResp as any)?._err) {
        const chPayload = chResp?.result?.payload ?? chResp?.payload ?? chResp;
        const chassis: ChassisInfoRow[] = Array.isArray(chPayload?.items)
          ? chPayload.items
          : Array.isArray(chPayload) ? chPayload : [];
        for (const c of chassis) {
          if (c?.ip_address) chassisByIp.set(c.ip_address, c);
        }
      } else {
        // Surface the bulk-export failure but DON'T abort — the switch
        // list is the primary data, chassis-info is enrichment.
        setErr(
          `Chassis-info enrichment failed (${(chResp as any)._err}). ` +
          "Serial / SKU columns will be empty. Older MCP servers may not " +
          "have inventory_get_chassis_info_bulk yet — see the handoff doc.",
        );
      }

      // Join — copy serial + part_number onto each switch row. Use distinct
      // field names from the existing chassis_name to avoid overwriting:
      //   • serial          ← serial_number from chassis_info
      //   • part_number_sku ← part_number from chassis_info (the orderable
      //                       SKU, distinct from chassis_name which is the
      //                       marketing model like "SLX9250-32C")
      const enriched: FleetInventoryRow[] = switches.map((sw) => {
        const ch = sw.ip_address ? chassisByIp.get(sw.ip_address) : undefined;
        return {
          ...sw,
          serial: ch?.serial_number || (sw.serial as string) || "",
          part_number_sku: ch?.part_number || "",
        };
      });
      setItems(enriched);
    } finally {
      setLoading(false);
    }
  }, []);

  return { items, loading, err, refresh };
}
