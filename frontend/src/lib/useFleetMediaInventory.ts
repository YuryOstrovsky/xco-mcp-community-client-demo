// useFleetMediaInventory — orchestrates a fleet-wide media (transceiver)
// inventory poll. Calls inventory_getswitches once, then fans out
// restconf_get_media_detail in parallel for every switch, flattens the
// per-switch responses into one big array tagged with switch context.
//
// Why client-side fan-out: the MCP server doesn't yet expose a composite
// "all media across fleet" tool. We have restconf_get_media_detail
// per-switch (proven by the single-switch MediaWidget) — this hook just
// iterates. If/when the server team ships a fleet-wide variant we'll
// swap the orchestration body without touching the widget.
//
// Parallel rather than sequential: each call is ~5s. Sequential = 5s × N
// switches; parallel = ~5s total for the whole fleet. We accept the
// "thundering herd" risk because the calls hit different switches, not
// the same backend.
//
// Per-switch failures are surfaced via `errors` (with switch context)
// rather than aborting the whole load. Operator sees a banner + the
// healthy switches' media still populates.

import { useCallback, useState } from "react";
import { postJSON } from "./api";
import type { FleetMediaRow } from "../components/FleetMediaInventoryWidget";

interface SwitchInfo {
  name?: string;
  ip_address?: string;
  fabric?: string | { fabric_name?: string };
}

export interface FleetMediaError {
  switch_name?: string;
  switch_ip: string;
  error: string;
}

export function useFleetMediaInventory() {
  const [items, setItems] = useState<FleetMediaRow[]>([]);
  const [errors, setErrors] = useState<FleetMediaError[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const refresh = useCallback(async (site?: string) => {
    setLoading(true);
    setErrors([]);
    setItems([]);
    setProgress("Fetching switch list…");
    // Multi-site routing — every /invoke gets `site` in inputs when
    // we're in multi-site mode. The hook stays portable by accepting
    // the resolved site as an argument rather than reading App-local
    // state. App.tsx passes `currentSiteId()` on refresh().
    const siteWire = site ? { site } : {};
    try {
      // Step 1 — fleet list
      const swResp = await postJSON<any>("/api/invoke", {
        tool: "inventory_getswitches",
        inputs: { ...siteWire },
      });
      const swPayload = swResp?.result?.payload ?? swResp?.payload ?? swResp;
      const switches: SwitchInfo[] = Array.isArray(swPayload)
        ? swPayload
        : Array.isArray(swPayload?.items)    ? swPayload.items
        : Array.isArray(swPayload?.switches) ? swPayload.switches
        : [];
      if (switches.length === 0) {
        setProgress("");
        setLoading(false);
        return;
      }

      // Step 2 — parallel per-switch media polls.
      // Use Promise.allSettled so one bad switch doesn't abort the rest.
      // Track progress with a counter incremented as each promise settles.
      let done = 0;
      setProgress(`Polling 0 of ${switches.length} switches…`);

      const polls = switches.map(async (sw): Promise<{
        sw: SwitchInfo; items: FleetMediaRow[]; error?: string;
      }> => {
        const ip = (sw.ip_address || "").trim();
        if (!ip) return { sw, items: [], error: "no ip_address on switch record" };
        try {
          const mResp = await postJSON<any>("/api/invoke", {
            tool: "restconf_get_media_detail",
            inputs: { switch_ip: ip, ...siteWire },
          });
          const mPayload = mResp?.result?.payload ?? mResp?.payload ?? {};
          const mItems: any[] = Array.isArray(mPayload?.items) ? mPayload.items : [];
          // Tag each row with the switch's identity so the table can render
          // and sort across switches.
          const fabricStr = typeof sw.fabric === "string"
            ? sw.fabric
            : (sw.fabric?.fabric_name || "");
          const tagged: FleetMediaRow[] = mItems.map(it => ({
            ...it,
            switch_name: sw.name || ip,
            switch_ip: ip,
            fabric: fabricStr,
          }));
          return { sw, items: tagged };
        } catch (e: any) {  // eslint-disable-line — catch-error idiom
          return { sw, items: [], error: String(e?.message || e).slice(0, 200) };
        } finally {
          done += 1;
          setProgress(`Polling ${done} of ${switches.length} switches…`);
        }
      });

      const settled = await Promise.allSettled(polls);
      const allItems: FleetMediaRow[] = [];
      const allErrors: FleetMediaError[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled") {
          allItems.push(...r.value.items);
          if (r.value.error) {
            allErrors.push({
              switch_name: r.value.sw.name,
              switch_ip:   r.value.sw.ip_address || "",
              error:       r.value.error,
            });
          } else if (r.value.items.length === 0) {
            // Switch responded but had no transceivers — likely a small/lab
            // switch or one with no plugged optics. Not really an error, but
            // worth surfacing so operators understand the count.
            allErrors.push({
              switch_name: r.value.sw.name,
              switch_ip:   r.value.sw.ip_address || "",
              error:       "no media items returned (no transceivers plugged?)",
            });
          }
        } else {
          allErrors.push({ switch_ip: "(unknown)", error: String(r.reason).slice(0, 200) });
        }
      }
      setItems(allItems);
      setErrors(allErrors);
      setProgress("");
    } finally {
      setLoading(false);
    }
  }, []);

  return { items, errors, loading, progress, refresh };
}
