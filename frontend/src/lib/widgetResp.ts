// Helpers for unwrapping the "result.payload" envelope that wraps every
// MCP tool response. Lets the tiny widget shims collapse from ~8 lines
// of identical unwrapping boilerplate to a single destructuring call:
//
//   const { items, summary, switchIp } = unwrapWidgetPayload(resp);
//
// Some tools wrap one extra level (e.g. result.payload.payload from the
// tier-2 servers); `unwrapWidgetPayloadDouble` peels both.

export interface UnwrappedPayload {
  raw: any;
  payload: any;
  meta: any;
  summary: any;
  items: any[];
  warnings: any[];
  switchIp: string;
}

/**
 * Single-level unwrap — `resp.raw.result.payload` (or `resp.raw.payload`).
 * Used by the per-switch widgets (port stats, media, IP iface, LLDP,
 * ARP, VLAN, VRF, maintenance-rate, etc.).
 */
export function unwrapWidgetPayload(resp: any): UnwrappedPayload {
  const raw: any = resp?.raw ?? {};
  const payload: any = raw?.result?.payload ?? raw?.payload ?? {};
  const meta: any = payload?.meta ?? {};
  const summary: any = payload?.summary ?? {};
  const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
  const warnings: any[] = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const switchIp: string = meta?.switch_ip ?? "";
  return { raw, payload, meta, summary, items, warnings, switchIp };
}

/**
 * Double-level unwrap — tier-2 servers wrap their return in
 * `{ status, payload }` so the real data lives at
 * `resp.raw.result.payload.payload`. Falls back to the single-level
 * value if the inner `payload` field is absent.
 */
export function unwrapWidgetPayloadDouble(resp: any): { outer: any; inner: any } {
  const raw: any = resp?.raw ?? {};
  const outer: any = raw?.result?.payload ?? raw?.payload ?? {};
  const inner: any = outer?.payload ?? outer;
  return { outer, inner };
}

