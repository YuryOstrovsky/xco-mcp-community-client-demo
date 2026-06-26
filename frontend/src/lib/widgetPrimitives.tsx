// lib/widgetPrimitives.tsx — small reusable React primitives for the
// "readiness-style" inline result widgets (RoCE QoS, RoCE Path, future
// xco_health detail, etc.).
//
// 2026-06-05: created in response to user gut-check that the recent
// RoCE widgets had drifted into a "traffic light / student grade" look
// — bright #86efac / #fca5a5 / #fde68a chips, hand-rolled tables,
// fullscreen modal wrappers. The reference style was the Inventory
// viz block (rendered via <Panel>) plus FabricHealthSummary /
// FleetInventory: muted tokens, FG.* design-system colors, inline
// rendering in the AI Console.
//
// What this file provides — all using design-system tokens from
// figmaStyles, never raw hex / Tailwind-300 / ad-hoc rgba:
//
//   tonePalette(tone)     — { fg, bg, border } from FG.* tokens
//   <Chip>                — pill: status + label + optional tooltip
//   <ReadinessBanner>     — top-line good/bad verdict line
//   <FindingRow>          — name + value + icon + tone, one checklist row
//   <SectionCard>         — collapsible card (title + subtitle + tone)
//   <CopyableCommand>     — `cli command` chip with click-to-copy
//   <ActionList>          — numbered list with backtick→CopyableCommand
//   tableStyles           — th/td/table styles matching Panel inline table
//   sectionLabel          — small uppercase muted label above sub-blocks
//
// Anti-goals (do not add here):
//   - Domain logic ("classify a RoCE finding by name"). Belongs in the
//     widget — the primitive takes a `tone` already classified.
//   - Modal wrappers. Result widgets render inline via <Panel>; modals
//     are tier-3 ops with their own (different) chrome.
//   - State that isn't pure UI (open/copied). Widget state lives in
//     the parent.
//
// When to use vs roll your own:
//   - New readiness widget? Use these. Doing anything else is a smell.
//   - Existing widget with a custom Chip/Section? Migrate over time —
//     don't rewrite all at once. Match the design-system colors first
//     (replace #86efac with tonePalette('good').fg), then swap to these
//     components.

import { useState, type CSSProperties, type ReactNode } from "react";
import { FG } from "./figmaStyles";

export type ToneKey = "good" | "bad" | "warn" | "neut" | "info";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tonal palette — sole source of color for readiness widgets. Every
 *  field maps to a `FG.*` token so the same Chip renders correctly in
 *  light AND dark theme without per-tone overrides.
 *
 *  DO NOT inline tone colors elsewhere. If you need a new tone (e.g.
 *  "pending"), add it here, not in the widget. */
export function tonePalette(tone: ToneKey): { fg: string; bg: string; border: string } {
  switch (tone) {
    case "good": return { fg: FG.successGreen,  bg: FG.successBg, border: FG.successBorder };
    case "bad":  return { fg: FG.errorRed,      bg: FG.errorBg,   border: FG.errorBorder };
    case "warn": return { fg: FG.warningYellow, bg: FG.warningBg, border: FG.warningBorder };
    case "info": return { fg: FG.infoBlue,      bg: FG.infoBg,    border: FG.infoBorder };
    case "neut":
    default:     return { fg: FG.dimColor,      bg: FG.subtleBg,  border: FG.subtleBorder };
  }
}

/** Pill / chip — neutral surface with a small colored dot indicating
 *  tone, plus the label text. Mirrors the FabricHealthSummary KPI-card
 *  pattern (small 6px dot + plain text on a neutral bg), NOT the
 *  high-saturation traffic-light Tailwind 300s the RoCE widgets used
 *  before #168/#170. The dot carries the status; the surface stays
 *  visually restrained so a row of chips reads as data, not as a
 *  dashboard light show.
 *
 *  Example: <Chip tone="good" label="MTU" help="≥9000 on all endpoints" /> */
export function Chip({ label, tone, help, dot = true }: {
  label: ReactNode;
  tone: ToneKey;
  help?: string;
  /** Show the leading status dot. Default true. Set false when the
   *  label already encodes status (e.g. literal "✓ READY"). */
  dot?: boolean;
}) {
  const p = tonePalette(tone);
  return (
    <span title={help} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 6,
      fontSize: 12, fontWeight: 500,
      background: "var(--inner-card-bg)",
      border: `1px solid ${FG.containerBorder}`,
      color: FG.bodyColor,
      cursor: help ? "help" : "default",
      transition: FG.transition,
    }}>
      {dot && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: p.fg, flexShrink: 0,
        }} />
      )}
      {label}
    </span>
  );
}

/** Top-line verdict — KPI-card-style block (neutral surface, small
 *  status dot, primary text + optional secondary hint). Matches the
 *  FabricHealthSummary "Fabric Health" headline card; deliberately NOT
 *  a colored box. */
export function ReadinessBanner({ ok, okText, badText, hint }: {
  ok: boolean;
  okText: ReactNode;
  badText: ReactNode;
  hint?: ReactNode;
}) {
  const tone: ToneKey = ok ? "good" : "bad";
  const p = tonePalette(tone);
  return (
    <div style={{
      padding: "16px 20px", borderRadius: 8,
      background: "var(--inner-card-bg)",
      border: `1px solid ${FG.containerBorder}`,
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: "50%",
        background: p.fg, flexShrink: 0,
      }} />
      <div>
        <div style={{ color: FG.bodyColor, fontSize: 14, fontWeight: 500 }}>
          {ok ? okText : badText}
        </div>
        {hint && (
          <div style={{ marginTop: 4, color: FG.mutedColor, fontSize: 12 }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

/** Checklist row — icon + name + value chip. The widget classifies its
 *  tone (good if value matches expected, bad if mismatch, neut for
 *  informational counters, etc.). Each row sits in a list/table with
 *  matching dividers via `FG.divider`. */
export function FindingRow({ name, value, tone, monospace = true }: {
  name: string;
  value: ReactNode;
  tone: ToneKey;
  /** Render the name in monospace (default true — most findings are
   *  raw symbol names like `qos_trust_dscp`). Set false for
   *  human-readable labels. */
  monospace?: boolean;
}) {
  const p = tonePalette(tone);
  const icon =
    tone === "good" ? "✓" :
    tone === "bad"  ? "✗" :
    tone === "warn" ? "⚠" :
    tone === "info" ? "•" : "·";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "20px 1fr auto",
      alignItems: "center", gap: 12,
      padding: "8px 14px", fontSize: 13,
      borderBottom: `1px solid ${FG.divider}`,
      color: FG.bodyColor,
    }}>
      <span style={{ color: p.fg, textAlign: "center", fontWeight: 600 }}>{icon}</span>
      <span style={{ fontFamily: monospace ? "monospace" : "inherit", color: FG.bodyColor }}>
        {name}
      </span>
      {/* Value: plain dim text — no colored pill. The icon already
          carries the tone; doubling it up with a colored pill reads
          as "traffic light." */}
      <span style={{ color: FG.mutedColor, fontSize: 12, fontFamily: "monospace" }}>
        {value}
      </span>
    </div>
  );
}

/** Collapsible section card — title + subtitle in header, body slot
 *  below. Visual matches `stepCard()` (border + padding from
 *  figmaStyles) but with an interactive header. */
export function SectionCard({
  title, subtitle, tone, defaultOpen = false, rightSlot, children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  tone?: ToneKey;
  defaultOpen?: boolean;
  /** Optional content rendered on the right side of the header
   *  (e.g. a count or a small status chip). */
  rightSlot?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const p = tone ? tonePalette(tone) : null;
  return (
    <div style={{
      border: `1px solid ${p ? p.border : FG.containerBorder}`,
      borderRadius: 8, marginBottom: 12, overflow: "hidden",
      background: FG.subtleBg,
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", padding: "12px 16px", background: "transparent",
          border: "none", cursor: "pointer", textAlign: "left",
          display: "flex", alignItems: "center", gap: 12,
          color: FG.bodyColor,
        }}
      >
        <span style={{ color: FG.dimColor, fontSize: 12, width: 12 }}>
          {open ? "▾" : "▸"}
        </span>
        {p && (
          <span style={{
            width: 8, height: 8, borderRadius: "50%", background: p.fg, flexShrink: 0,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: FG.headingColor, fontSize: 14, fontWeight: 500 }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ color: FG.mutedColor, fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        {rightSlot && <div style={{ marginLeft: "auto" }}>{rightSlot}</div>}
      </button>
      {open && (
        <div style={{
          padding: "12px 16px 16px",
          borderTop: `1px solid ${FG.divider}`,
          background: FG.containerBg,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Click-to-copy command chip. Operator clicks → text copies to
 *  clipboard, ✓ flashes for 1.5s. Fails silently if Clipboard API is
 *  unavailable (insecure context). Used inside ActionList. */
export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; fail silently
    }
  }
  return (
    <code
      onClick={copy}
      title="Click to copy"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: FG.infoBg, border: `1px solid ${FG.infoBorder}`,
        color: FG.infoBlue, borderRadius: 4, padding: "1px 6px",
        fontFamily: "monospace", fontSize: 12, cursor: "pointer",
        marginInline: 2, transition: FG.transition,
      }}
    >
      {command}
      {copied && (
        <span style={{ color: FG.successGreen, fontWeight: 600, marginLeft: 4 }}>✓</span>
      )}
    </code>
  );
}

/** Numbered recommended-action list. Each action is a string that may
 *  embed `backtick commands` — those become CopyableCommand chips,
 *  text in between renders as plain prose. */
export function ActionList({ actions }: { actions: string[] }) {
  if (!actions.length) return null;
  return (
    <ol style={{ paddingLeft: 24, margin: 0 }}>
      {actions.map((action, i) => (
        <li key={i} style={{
          marginBottom: 8, lineHeight: 1.55,
          fontSize: 13, color: FG.bodyColor,
        }}>
          {action.split("`").map((part, j) =>
            j % 2 === 1
              ? <CopyableCommand key={j} command={part} />
              : <span key={j}>{part}</span>,
          )}
        </li>
      ))}
    </ol>
  );
}

/** Table style primitives — matches the inline table pattern used by
 *  the Inventory viz block (Panel + table at App.tsx ~15881). Apply as
 *  inline styles: <table style={tableStyles.table}>, <th style={tableStyles.th}>, etc. */
export const tableStyles: {
  table: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
} = {
  table: {
    width: "100%", borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: `1px solid ${FG.divider}`,
    color: FG.mutedColor, fontWeight: 500,
    textTransform: "uppercase", letterSpacing: "0.05em",
    fontSize: 11,
  },
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${FG.divider}`,
    color: FG.bodyColor,
  },
};

/** Small uppercase label used above sub-blocks (tables, lists, KPI
 *  rows). Pairs with FG.mutedColor + letter-spacing — matches Plan
 *  Detail's "STEP N" + Inventory viz subtitle visual. */
export const sectionLabel: CSSProperties = {
  color: FG.mutedColor, fontSize: 11, fontWeight: 500,
  textTransform: "uppercase", letterSpacing: "0.06em",
  marginBottom: 8,
};
