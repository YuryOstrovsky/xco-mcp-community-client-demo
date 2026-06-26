// SimpleToolResultWidgetMount — generic mount for tool-result widgets
// that follow the canonical (items, summary, switchIp, onClose) shape.
//
// Most per-switch tool-result widgets follow an identical pattern:
//   {open && (() => {
//     const { items, summary, switchIp } = unwrapWidgetPayload(resp);
//     return <SomeWidget items={items} summary={summary}
//                        switchIp={switchIp} onClose={onClose} />;
//   })()}
//
// Several widgets share this exact shape (PortStats, Media, IpIface,
// LldpNeigh, ArpTable, VlanBrief, VrfSummary). Plus MaintenanceRate via
// extraProps for its `warnings` field. Routing them through this helper
// gives one canonical "simple unwrap → render" path.
//
// Widgets with custom unwrap logic keep their own dedicated mount
// blocks in App.tsx:
//   - Clock (fetchUptime async callback + cached uptime state)
//   - Firmware (singular `item` instead of `items[]`)
//   - AlarmDetails / FabricHealth (double-unwrap)
//   - Tenant + EPG + FabricsHealth (custom payload paths)
//
// Convention: if your widget needs more than (items, summary,
// switchIp, onClose), inline it instead of this helper. If it needs
// 1-2 extra simple-shape props, use extraProps.
//
// Living in its own .tsx file because widgetResp.ts is pure type
// transforms; JSX support means a .tsx extension.

import { unwrapWidgetPayload } from "./widgetResp";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function SimpleToolResultWidgetMount({
  open, resp, Widget, onClose, extraProps,
}: {
  open: boolean;
  resp: any;
  Widget: React.ComponentType<any>;
  onClose: () => void;
  extraProps?: Record<string, any>;
}) {
  if (!open) return null;
  const { items, summary, switchIp } = unwrapWidgetPayload(resp);
  return (
    <Widget
      items={items}
      summary={summary}
      switchIp={switchIp}
      onClose={onClose}
      {...(extraProps || {})}
    />
  );
}
