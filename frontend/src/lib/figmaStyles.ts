/**
 * Figma Design System — Shared tokens & style helpers
 *
 * Extracted from the Figma-generated "Remove Switches from Fabric" widget.
 * Every widget in the Console tab should use these instead of hardcoded
 * inline styles so the whole UI stays visually consistent.
 */
import type { CSSProperties, MouseEvent } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   1. COLOR TOKENS
   ═══════════════════════════════════════════════════════════════════════ */

export const FG = {
  // ── Container / Surface ────────────────────────────────────────────
  // Routed through CSS variables so the same Panel renders correctly in
  // both dark and light themes. The dark-mode hex (preserved) is the
  // var's default value; .theme-light overrides it.
  containerBg:      "var(--container-bg)",
  containerBorder:  "var(--container-border)",
  containerRadius:  12,
  containerShadow:  "0 20px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.15)",

  // ── Header ─────────────────────────────────────────────────────────
  headerBorderBottom: "1px solid rgba(129,140,248,0.2)",  // indigo-400/20

  // ── Text Hierarchy ─────────────────────────────────────────────────
  titleColor:    "var(--title-color)",
  headingColor:  "var(--heading-color)",
  bodyColor:     "var(--body-color)",
  subtitleColor: "var(--subtitle-color)",
  mutedColor:    "var(--muted-color)",
  dimColor:      "var(--dim-color)",

  // ── Buttons – Primary (Orange) ─────────────────────────────────────
  btnPrimaryBg:       "#ea580c",   // orange-600
  btnPrimaryHover:    "#c2410c",   // orange-700
  btnPrimaryBorder:   "#f97316",   // orange-500

  // ── Buttons – Secondary (Outline) ──────────────────────────────────
  btnSecondaryBorder: "var(--btn-secondary-border)",
  btnSecondaryColor:  "var(--btn-secondary-color)",
  btnSecondaryHover:  "var(--btn-secondary-hover)",

  // ── Buttons – Ghost / Close ────────────────────────────────────────
  btnGhostHoverBg: "var(--btn-ghost-hover-bg)",

  // ── Buttons – Disabled ─────────────────────────────────────────────
  btnDisabledBg:     "var(--btn-secondary-hover)",
  btnDisabledColor:  "var(--dim-color)",
  btnDisabledBorder: "var(--btn-secondary-border)",

  // ── Form Inputs ────────────────────────────────────────────────────
  inputBg:     "var(--bg0)",
  inputBorder: "var(--border)",
  inputColor:  "var(--text)",

  // ── Checkbox ───────────────────────────────────────────────────────
  checkboxSelectedBg:       "rgba(37,99,235,0.8)",   // blue-600/80
  checkboxSelectedBorder:   "rgba(37,99,235,0.8)",
  checkboxUnselectedBorder: "#64748b",

  // ── Row / List Item ────────────────────────────────────────────────
  rowSelectedBg:     "var(--row-selected-bg)",
  rowSelectedBorder: "var(--row-selected-border)",
  rowDefaultBorder:  "var(--row-default-border)",
  rowHoverBorder:    "var(--row-hover-border)",
  rowHoverBg:        "var(--row-hover-bg)",

  // ── Warning / Info Banner ──────────────────────────────────────────
  bannerBg:        "var(--banner-bg)",
  bannerBorder:    "var(--banner-border)",
  bannerIconColor: "var(--muted-color)",

  // ── Semantic Status Colors ─────────────────────────────────────────
  errorRed:      "#ef4444",
  successGreen:  "#22c55e",
  warningYellow: "#eab308",
  infoBlue:      "#3b82f6",
  accentPurple:  "#8b8fd8",

  // ── Status Backgrounds (badges / tinted buttons) ───────────────────
  errorBg:      "rgba(239,68,68,0.15)",
  errorBorder:  "rgba(239,68,68,0.3)",
  successBg:    "rgba(34,197,94,0.15)",
  successBorder:"rgba(34,197,94,0.3)",
  warningBg:    "rgba(234,179,8,0.15)",
  warningBorder:"rgba(234,179,8,0.3)",
  infoBg:       "rgba(59,130,246,0.15)",
  infoBorder:   "rgba(59,130,246,0.3)",
  accentBg:     "rgba(139,143,216,0.15)",
  accentBorder: "rgba(139,143,216,0.3)",

  // ── Subtle Surfaces / Dividers ─────────────────────────────────────
  subtleBg:      "var(--subtle-bg)",
  subtleBorder:  "var(--subtle-border)",
  divider:       "var(--divider)",

  // ── Transitions ────────────────────────────────────────────────────
  transition: "all 0.15s ease",
} as const;


/* ═══════════════════════════════════════════════════════════════════════
   2. ROLE BADGE COLORS (network device roles)
   ═══════════════════════════════════════════════════════════════════════ */

export const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  BorderLeaf: { bg: "rgba(59,7,100,0.5)",  text: "#d8b4fe", border: "rgba(107,33,168,0.5)" },
  Spine:      { bg: "rgba(23,37,84,0.5)",  text: "#93c5fd", border: "rgba(30,64,175,0.5)" },
  Leaf:       { bg: "rgba(2,44,34,0.5)",   text: "#6ee7b7", border: "rgba(6,95,70,0.5)" },
};


/* ═══════════════════════════════════════════════════════════════════════
   3. PLAN STATUS STYLES
   ═══════════════════════════════════════════════════════════════════════ */

export const PLAN_STATUS: Record<string, { bg: string; border: string; color: string; label: string; icon: string }> = {
  pending:   { bg: "rgba(234,179,8,0.15)",   border: "rgba(234,179,8,0.4)",   color: "#eab308", label: "PENDING",   icon: "\u25CF" },
  approved:  { bg: "rgba(59,130,246,0.15)",  border: "rgba(59,130,246,0.4)",  color: "#3b82f6", label: "APPROVED",  icon: "\u25CF" },
  executing: { bg: "rgba(139,143,216,0.15)", border: "rgba(139,143,216,0.4)", color: "#8b8fd8", label: "EXECUTING", icon: "\u29BE" },
  done:      { bg: "rgba(34,197,94,0.15)",   border: "rgba(34,197,94,0.4)",   color: "#22c55e", label: "DONE",      icon: "\u2713" },
  failed:    { bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.4)",   color: "#ef4444", label: "FAILED",    icon: "\u2717" },
  rejected:  { bg: "rgba(156,163,175,0.15)", border: "rgba(156,163,175,0.4)", color: "#9ca3af", label: "REJECTED",  icon: "\u2717" },
};

export function planStatusStyle(status: string) {
  return PLAN_STATUS[status] ?? {
    bg: "rgba(156,163,175,0.15)", border: "rgba(156,163,175,0.4)",
    color: "#9ca3af", label: status.toUpperCase(), icon: "\u25CB",
  };
}


/* ═══════════════════════════════════════════════════════════════════════
   4. STEP MODE COLORS
   ═══════════════════════════════════════════════════════════════════════ */

export const MODE_COLORS = {
  mutate: { color: "rgba(234,179,8,0.8)", bg: "rgba(234,179,8,0.12)" },
  read:   { color: "rgba(59,130,246,0.8)", bg: "rgba(59,130,246,0.12)" },
} as const;


/* ═══════════════════════════════════════════════════════════════════════
   5. STYLE HELPER FUNCTIONS   (all return CSSProperties)
   ═══════════════════════════════════════════════════════════════════════ */

// ── Container / Layout ───────────────────────────────────────────────

/** Figma-styled widget outer wrapper */
export function widgetContainer(): CSSProperties {
  return {
    width: "100%",
    background: FG.containerBg,
    borderRadius: FG.containerRadius,
    boxShadow: FG.containerShadow,
    overflow: "hidden",
    border: `1px solid ${FG.containerBorder}`,
  };
}

/** Widget header bar */
export function widgetHeader(): CSSProperties {
  return {
    background: FG.containerBg,
    padding: "20px 32px",
    position: "relative",
    borderBottom: FG.headerBorderBottom,
  };
}

/** Widget content area */
export function widgetContent(): CSSProperties {
  return { padding: 32 };
}


// ── Buttons ──────────────────────────────────────────────────────────

/** Primary action button (orange) */
export function btnPrimary(disabled = false): CSSProperties {
  return {
    padding: "8px 20px", fontSize: 14, fontWeight: 500, borderRadius: 8,
    display: "inline-flex", alignItems: "center", gap: 8,
    transition: FG.transition,
    cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? FG.btnDisabledBg : FG.btnPrimaryBg,
    color: disabled ? FG.btnDisabledColor : "#ffffff",
    border: disabled ? `1px solid ${FG.btnDisabledBorder}` : `1px solid ${FG.btnPrimaryBorder}`,
  };
}

/** Secondary outlined button */
export function btnSecondary(): CSSProperties {
  return {
    padding: "8px 20px", fontSize: 14, fontWeight: 500, color: FG.btnSecondaryColor,
    borderRadius: 8, border: `1px solid ${FG.btnSecondaryBorder}`,
    background: "transparent", cursor: "pointer", transition: FG.transition,
  };
}

/** Small inline action button (approve, reject, execute, delete, etc.) */
export function btnSmall(variant: "success" | "danger" | "warning" | "info" | "accent" | "neutral"): CSSProperties {
  const map = {
    success: { bg: FG.successBg, border: FG.successBorder, color: FG.successGreen },
    danger:  { bg: FG.errorBg,   border: FG.errorBorder,   color: FG.errorRed },
    warning: { bg: FG.warningBg, border: FG.warningBorder, color: FG.warningYellow },
    info:    { bg: FG.infoBg,    border: FG.infoBorder,    color: FG.infoBlue },
    accent:  { bg: FG.accentBg,  border: FG.accentBorder,  color: FG.accentPurple },
    neutral: { bg: "transparent", border: FG.containerBorder, color: FG.subtitleColor },
  };
  const v = map[variant];
  return {
    background: v.bg, border: `1px solid ${v.border}`, color: v.color,
    cursor: "pointer", borderRadius: 6, padding: "4px 10px", fontSize: 12,
    fontWeight: 500, transition: FG.transition,
  };
}

/** Solid colored button (Approve, Reject, Execute — Figma Plan Detail style) */
export function btnSolid(variant: "success" | "danger" | "warning" | "info" | "accent"): CSSProperties {
  const map = {
    success: { bg: "#059669", hover: "#047857", border: "#10b981", color: "#ffffff" }, // emerald-600/700/500
    danger:  { bg: "#dc2626", hover: "#b91c1c", border: "#ef4444", color: "#ffffff" }, // red-600/700/500
    warning: { bg: "#d97706", hover: "#b45309", border: "#f59e0b", color: "#ffffff" }, // amber-600/700/500
    info:    { bg: "#2563eb", hover: "#1d4ed8", border: "#3b82f6", color: "#ffffff" }, // blue-600/700/500
    accent:  { bg: "#7c3aed", hover: "#6d28d9", border: "#8b5cf6", color: "#ffffff" }, // violet-600/700/500
  };
  const v = map[variant];
  return {
    padding: "8px 20px", fontSize: 14, fontWeight: 500, borderRadius: 8,
    display: "inline-flex", alignItems: "center", gap: 8,
    cursor: "pointer", transition: FG.transition,
    background: v.bg, color: v.color, border: `1px solid ${v.border}`,
  };
}

/** Close / ghost button */
export function btnClose(): CSSProperties {
  return {
    color: FG.mutedColor, background: "transparent", border: "none", borderRadius: 8,
    padding: 8, cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", transition: FG.transition,
  };
}


// ── Form Inputs ──────────────────────────────────────────────────────

/** Consistent text input style */
export function inputStyle(): CSSProperties {
  return {
    background: FG.inputBg,
    border: `1px solid ${FG.inputBorder}`,
    color: FG.inputColor,
  };
}


// ── Badges / Pills ───────────────────────────────────────────────────

/** Plan status badge */
export function statusBadge(status: string): CSSProperties {
  const ps = planStatusStyle(status);
  return {
    background: ps.bg, border: `1px solid ${ps.border}`, color: ps.color,
    borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 700,
    display: "inline-flex", alignItems: "center", gap: 4,
  };
}

/** Network device role badge */
export function roleBadge(role: string): CSSProperties {
  const c = ROLE_COLORS[role] ?? ROLE_COLORS.Leaf;
  return {
    display: "inline-flex", alignItems: "center",
    padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 500,
    background: c.bg, color: c.text, border: `1px solid ${c.border}`,
  };
}

/** Step mode badge (mutate / read) — Figma style with border */
export function modeBadge(mode: string): CSSProperties {
  const mc = mode === "mutate" ? MODE_COLORS.mutate : MODE_COLORS.read;
  return {
    fontSize: 12, fontWeight: 500, color: mc.color, background: mc.bg,
    borderRadius: 4, padding: "2px 8px",
    display: "inline-flex", alignItems: "center",
    border: `1px solid ${mode === "mutate" ? "rgba(234,179,8,0.3)" : "rgba(59,130,246,0.3)"}`,
  };
}

/** Status badge with dot indicator — Figma "Plan Detail" style */
export function statusDotBadge(status: string): CSSProperties {
  const ps = planStatusStyle(status);
  return {
    display: "inline-flex", alignItems: "center", gap: 8,
    background: ps.bg, border: `1px solid ${ps.border}`,
    padding: "6px 12px", borderRadius: 6,
  };
}

/** The dot inside statusDotBadge */
export function statusDot(status: string): CSSProperties {
  const ps = planStatusStyle(status);
  return {
    width: 8, height: 8, borderRadius: "50%",
    background: ps.color, flexShrink: 0,
  };
}

/** The label inside statusDotBadge */
export function statusDotLabel(status: string): CSSProperties {
  const ps = planStatusStyle(status);
  return {
    color: ps.color, fontSize: 12, fontWeight: 500,
    textTransform: "uppercase" as const, letterSpacing: "0.05em",
  };
}


// ── Cards / Surfaces ─────────────────────────────────────────────────

/** Subtle card surface (step cards, form sections) */
export function subtleCard(): CSSProperties {
  return {
    background: FG.subtleBg, border: `1px solid ${FG.subtleBorder}`,
    borderRadius: 8, padding: "10px 14px",
  };
}

/** Step card for Plan Detail — Figma style with more padding */
export function stepCard(): CSSProperties {
  return {
    background: "rgba(30,41,59,0.5)", // slate-750 approx
    border: `1px solid ${FG.containerBorder}`,
    borderRadius: 8, padding: 16,
    transition: FG.transition,
  };
}

/** Warning / info banner */
export function warningBanner(): CSSProperties {
  return {
    background: FG.bannerBg, border: `1px solid ${FG.bannerBorder}`,
    padding: 16, borderRadius: 8,
  };
}

/** Bottom divider for list items */
export function dividerBottom(): CSSProperties {
  return { borderBottom: `1px solid ${FG.divider}` };
}

/** Error display box */
export function errorBox(): CSSProperties {
  return {
    color: FG.errorRed, fontSize: 13, padding: "8px 12px",
    background: "rgba(239,68,68,0.08)", borderRadius: 8,
    border: "1px solid rgba(239,68,68,0.15)",
  };
}

/** Success display box */
export function successBox(): CSSProperties {
  return {
    color: FG.successGreen, fontSize: 13, padding: "8px 12px",
    background: "rgba(34,197,94,0.08)", borderRadius: 8,
    border: "1px solid rgba(34,197,94,0.15)",
  };
}

/** Secret / warning highlight box */
export function secretBox(): CSSProperties {
  return {
    background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)",
    borderRadius: 8, padding: "10px 14px",
  };
}


// ── Progress Bar ─────────────────────────────────────────────────────

/** Progress bar track */
export function progressTrack(): CSSProperties {
  return {
    width: "100%", background: "#334155", borderRadius: 9999, height: 8,
    overflow: "hidden",
  };
}

/** Progress bar fill */
export function progressFill(pct: number, status: "running" | "done" | "failed"): CSSProperties {
  const color = status === "done" ? "#64748b" : status === "failed" ? FG.errorRed : FG.accentPurple;
  return {
    width: `${pct}%`, height: "100%",
    background: color, borderRadius: 9999,
    transition: "width 0.5s ease, background 0.3s ease",
  };
}


/* ═══════════════════════════════════════════════════════════════════════
   6. HOVER HELPERS   (return {onMouseEnter, onMouseLeave} props)
   ═══════════════════════════════════════════════════════════════════════ */

type HoverHandlers = {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave: (e: MouseEvent<HTMLElement>) => void;
};

/** Hover pair for ghost / outlined buttons */
export function hoverGhost(): HoverHandlers {
  return {
    onMouseEnter: (e) => { e.currentTarget.style.background = FG.btnSecondaryHover; },
    onMouseLeave: (e) => { e.currentTarget.style.background = "transparent"; },
  };
}

/** Hover pair for the close (X) button */
export function hoverClose(): HoverHandlers {
  return {
    onMouseEnter: (e) => { e.currentTarget.style.color = FG.headingColor; e.currentTarget.style.background = FG.btnGhostHoverBg; },
    onMouseLeave: (e) => { e.currentTarget.style.color = FG.mutedColor; e.currentTarget.style.background = "transparent"; },
  };
}

/** Hover pair for primary orange button */
export function hoverPrimary(enabled: boolean): HoverHandlers {
  return {
    onMouseEnter: (e) => { if (enabled) e.currentTarget.style.background = FG.btnPrimaryHover; },
    onMouseLeave: (e) => { if (enabled) e.currentTarget.style.background = FG.btnPrimaryBg; },
  };
}

/** Hover pair for solid colored buttons */
export function hoverSolid(variant: "success" | "danger" | "warning" | "info" | "accent"): HoverHandlers {
  const map = {
    success: { base: "#059669", hover: "#047857" },
    danger:  { base: "#dc2626", hover: "#b91c1c" },
    warning: { base: "#d97706", hover: "#b45309" },
    info:    { base: "#2563eb", hover: "#1d4ed8" },
    accent:  { base: "#7c3aed", hover: "#6d28d9" },
  };
  const v = map[variant];
  return {
    onMouseEnter: (e) => { e.currentTarget.style.background = v.hover; },
    onMouseLeave: (e) => { e.currentTarget.style.background = v.base; },
  };
}

/** Hover pair for step cards (border highlight) */
export function hoverStepCard(): HoverHandlers {
  return {
    onMouseEnter: (e) => { e.currentTarget.style.borderColor = "#475569"; }, // slate-600
    onMouseLeave: (e) => { e.currentTarget.style.borderColor = FG.containerBorder; },
  };
}
