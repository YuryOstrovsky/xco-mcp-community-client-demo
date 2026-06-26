// Admin sidebar section — foldable list of admin-only quick-action
// buttons (e.g. Activity Log, Server Settings). The button list is
// supplied by the parent via `items`; each button highlights when its
// modal is open.
//
// Pure presentational: parent owns the per-item open flags and
// callbacks, and the visible-to-admin gate.

import type { Dispatch, SetStateAction } from "react";

export interface AdminSidebarItem {
  label: string;
  isOpen: boolean;
  onOpen: () => void;
  /** Optional small badge text shown to the right of the label
   *  (e.g. "2 ⚠" for the Agent Activity entry when skills are
   *  projected to exceed their cap). Plain text — escape-rendered
   *  to avoid any HTML injection from upstream sources. */
  badge?: string;
  /** Tone for the badge background — "warn" maps to honey, "error"
   *  to clay, "info" to neutral. Defaults to "info" if omitted. */
  badgeTone?: "info" | "warn" | "error";
  /** Tooltip text (HTML title attribute) shown on hover. Useful for
   *  explaining the badge without taking extra row height. */
  title?: string;
}

export interface AdminSidebarProps {
  /** RBAC gate — pass false to hide the whole section. */
  visible: boolean;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  items: AdminSidebarItem[];
}

export function AdminSidebar({ visible, collapsed, setCollapsed, items }: AdminSidebarProps) {
  if (!visible) return null;
  return (
    <div style={{ borderTop: "1px solid var(--subtle-border)", marginTop: 12, paddingTop: 12 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", marginBottom: collapsed ? 0 : 8 }}
        onClick={() => setCollapsed((p) => !p)}
      >
        <span style={{ opacity: 0.45, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, fontSize: 12 }}>Admin</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ opacity: 0.4, transition: "transform 0.15s ease", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      {!collapsed && (
        <>
          {items.map((it) => {
            const badgeBg =
              it.badgeTone === "error" ? "rgba(176,116,116,0.25)"
              : it.badgeTone === "warn" ? "rgba(181,154,95,0.28)"
              : "rgba(148,163,184,0.25)";
            const badgeColor =
              it.badgeTone === "error" ? "#e89494"
              : it.badgeTone === "warn" ? "#dab970"
              : "#cbd5e1";
            const badgeBorder =
              it.badgeTone === "error" ? "rgba(176,116,116,0.55)"
              : it.badgeTone === "warn" ? "rgba(181,154,95,0.55)"
              : "rgba(148,163,184,0.45)";
            return (
              <button
                key={it.label}
                className="w-full rounded-md px-3 py-2 mb-2"
                style={{
                  background: it.isOpen ? "var(--accent)" : "transparent",
                  border: "1px solid var(--subtle-border)",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                }}
                onClick={it.onOpen}
                title={it.title}
              >
                <span>{it.label}</span>
                {it.badge && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                    background: badgeBg, color: badgeColor,
                    border: `1px solid ${badgeBorder}`,
                    padding: "1px 6px", borderRadius: 4,
                    flexShrink: 0,
                  }}>
                    {it.badge}
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
