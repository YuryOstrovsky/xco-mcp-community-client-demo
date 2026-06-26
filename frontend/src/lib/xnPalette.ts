// XN design tokens — matches --accent (#8981E5) + muted complement.
// Used by traffic widgets (PortStats, MaintRate) for the per-port tiles and
// progress bars. Extracted from App.tsx so the widget files can import it.
export const XN = {
  accent:   "#8981E5",   // XN purple (ingress / mid-traffic)
  accentSoft: "#A8A2EE", // softer purple for Total-In value
  teal:     "#5BBFAA",   // muted sage teal — NOT bright green (egress / low-traffic)
  orange:   "#E8924A",   // warm orange — high traffic
  // port tile fills
  tileDnBg: "#22233A",   // down — very dark, near bg1
  tileDnBd: "#363752",   // down border — just slightly lighter
  tileLoBg: "#1C4840",   // low traffic — dark teal
  tileLoBd: "#5BBFAA",
  tileMiBg: "#38367A",   // mid traffic — dark purple
  tileMiBd: "#8981E5",
  tileHiBg: "#4D2E0A",   // high traffic — dark orange
  tileHiBd: "#E8924A",
  barTrack: "#353649",   // bar background track
} as const;
