// Small "Copy to clipboard" button with a brief "Copied!" confirmation.
// Falls back to the legacy textarea+execCommand path when navigator.clipboard
// isn't available (non-HTTPS contexts).
//
// `darkContext` pins colours to dark-theme values for buttons that live on a
// dark surface (terminal output, JSON viewer) — the global --text token would
// otherwise resolve to near-black in light theme and disappear.
//
// Extracted from App.tsx — pure utility, no closure dependencies.

import { useState } from "react";

export function CopyButton({ text, label = "Copy", className = "", darkContext = false }: { text: string; label?: string; className?: string; darkContext?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* ignore */ }
    }
  };
  const borderCol = darkContext ? "rgba(255,255,255,0.18)" : "var(--border)";
  const textCol   = copied ? "#4ade80" : (darkContext ? "#e6edf3" : "var(--text)");
  return (
    <button
      className={className}
      style={{ background: "transparent", border: `1px solid ${borderCol}`, color: textCol, borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", transition: "color 0.15s" }}
      onClick={handleCopy}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
