// frontend/src/components/Spinner.tsx
//
// Small reusable loading spinner — a rotating ring. For "waiting" states
// (analyze probe in flight, plan submitting, dry-run preview reading) so the
// operator sees motion, not a static line of text. Replaces the ad-hoc inline
// `animate-spin` markup duplicated across modals.

import type { CSSProperties } from "react";
import { FG } from "../lib/figmaStyles";

export interface SpinnerProps {
  /** Diameter in px. Default 14. */
  size?: number;
  /** Optional label rendered to the right of the spinner. */
  label?: string;
  /** Extra styles on the wrapper (e.g. margin / padding). */
  style?: CSSProperties;
  /** Label color override (defaults to a muted token). */
  labelColor?: string;
}

export function Spinner({ size = 14, label, style, labelColor }: SpinnerProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      <span
        className="animate-spin"
        role="status"
        aria-label="loading"
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.18)",
          borderTopColor: "rgba(255,255,255,0.85)",
          flexShrink: 0,
        }}
      />
      {label && <span style={{ fontSize: 12, color: labelColor ?? FG.mutedColor }}>{label}</span>}
    </span>
  );
}
