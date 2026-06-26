// Panel — generic titled container used to group dashboard content.

import { FG, btnClose, hoverClose, widgetContainer, widgetContent, widgetHeader } from "../lib/figmaStyles";
export function Panel({ title, subtitle, onClose, children, allowOverflow }: {
  title: string; subtitle?: string; onClose?: () => void; children: any;
  /** Allow children to render outside the panel's bounds (for popovers/dropdowns
   *  that would otherwise be clipped by the panel's `overflow: hidden`). */
  allowOverflow?: boolean;
}) {
  return (
    <div style={{ ...widgetContainer(), ...(allowOverflow ? { overflow: "visible" } : {}) }}>
      {/* Header */}
      <div style={widgetHeader()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{
              color: FG.titleColor, fontSize: 20, fontWeight: 500,
              letterSpacing: "-0.025em", margin: 0,
            }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{ color: FG.mutedColor, fontSize: 14, margin: "4px 0 0 0" }}>
                {subtitle}
              </p>
            )}
          </div>
          {onClose && (
            <button onClick={onClose} style={btnClose()} {...hoverClose()} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {/* Content */}
      <div style={widgetContent()}>
        {children}
      </div>
    </div>
  );
}

