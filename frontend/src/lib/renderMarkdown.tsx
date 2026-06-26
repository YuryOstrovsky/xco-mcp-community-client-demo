// Tiny inline Markdown renderer — handles a useful subset for agent
// investigation reports: headings, bold, italics, inline code,
// unordered/ordered lists, paragraphs, and pipe tables (with
// PASS/FAIL/ADVISORY/SKIP cell colouring). No heavy dep; ~180 lines is
// easier to maintain than pulling in react-markdown.

import type { ReactNode } from "react";

export function renderMarkdownInline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0; let m: RegExpExecArray | null; let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) tokens.push(<strong key={`b${key++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) tokens.push(<code key={`c${key++}`} style={{ background: "rgba(99,102,241,0.15)", padding: "1px 6px", borderRadius: 4, fontSize: "0.9em", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{tok.slice(1, -1)}</code>);
    else tokens.push(<em key={`i${key++}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) tokens.push(text.slice(last));
  return tokens;
}

function _parseTableRow(ln: string): string[] {
  const trimmed = ln.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed.slice(1, -1).split("|").map((c) => c.trim());
}
function _isTableSeparator(ln: string): boolean {
  const cells = _parseTableRow(ln);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

export function renderMarkdown(raw: string): ReactNode {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let listBuf: { kind: "ul" | "ol"; items: ReactNode[][] } | null = null;
  let paraBuf: string[] = [];
  let tableBuf: { header: string[]; rows: string[][] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (paraBuf.length) {
      out.push(<p key={`p${key++}`} style={{ margin: "0 0 10px 0" }}>{renderMarkdownInline(paraBuf.join(" "))}</p>);
      paraBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf) {
      const Tag = listBuf.kind;
      out.push(<Tag key={`l${key++}`} style={{ margin: "4px 0 12px 0", paddingLeft: 22 }}>
        {listBuf.items.map((it, i) => <li key={i} style={{ margin: "2px 0" }}>{it}</li>)}
      </Tag>);
      listBuf = null;
    }
  };
  const flushTable = () => {
    if (tableBuf) {
      const { header, rows } = tableBuf;
      const cellStyle: React.CSSProperties = {
        padding: "6px 10px", borderBottom: "1px solid rgba(71,85,105,0.35)",
        fontSize: 12.5, verticalAlign: "top",
      };
      const colorize = (cell: string): React.CSSProperties => {
        const t = cell.trim().toUpperCase();
        if (t === "PASS") return { color: "#86efac", fontWeight: 600 };
        if (t === "FAIL") return { color: "#fca5a5", fontWeight: 600 };
        if (t === "ADVISORY") return { color: "#fbbf24", fontWeight: 600 };
        if (t === "SKIP") return { color: "var(--muted-color)", fontWeight: 500 };
        return {};
      };
      out.push(
        <div key={`t${key++}`} style={{ overflowX: "auto", margin: "10px 0 14px 0" }}>
          <table style={{
            borderCollapse: "collapse", width: "100%",
            background: "rgba(15,23,42,0.4)",
            border: "1px solid rgba(71,85,105,0.4)",
            borderRadius: 8, overflow: "hidden",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}>
            <thead>
              <tr style={{ background: "rgba(99,102,241,0.10)" }}>
                {header.map((h, i) => (
                  <th key={i} style={{
                    ...cellStyle,
                    textAlign: "left", fontWeight: 600,
                    color: "#a5b4fc", fontSize: 12,
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    borderBottom: "1px solid rgba(99,102,241,0.30)",
                  }}>{renderMarkdownInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} style={{ ...cellStyle, ...colorize(c) }}>{renderMarkdownInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableBuf = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) { flushPara(); flushList(); flushTable(); continue; }
    const h = /^(#{1,4})\s+(.+)$/.exec(ln);
    if (h) {
      flushPara(); flushList(); flushTable();
      const level = h[1].length;
      const Tag = (`h${Math.min(level + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6");
      const sizeMap: Record<string, string> = { h2: "1.05rem", h3: "0.98rem", h4: "0.92rem", h5: "0.88rem", h6: "0.85rem" };
      out.push(<Tag key={`h${key++}`} style={{
        margin: level === 2 ? "16px 0 8px 0" : "12px 0 6px 0",
        fontSize: sizeMap[Tag] || "1rem", fontWeight: 600,
        color: level === 2 ? "#a5b4fc" : undefined,
      }}>{renderMarkdownInline(h[2])}</Tag>);
      continue;
    }
    if (ln.trim().startsWith("|") && ln.trim().endsWith("|")) {
      const cells = _parseTableRow(ln);
      if (cells.length > 0) {
        const next = lines[i + 1] || "";
        if (!tableBuf && _isTableSeparator(next)) {
          flushPara(); flushList();
          tableBuf = { header: cells, rows: [] };
          i++;
          continue;
        }
        if (tableBuf) {
          tableBuf.rows.push(cells);
          continue;
        }
      }
    } else if (tableBuf) {
      flushTable();
    }
    const ul = /^[-*]\s+(.+)$/.exec(ln);
    const ol = /^\d+\.\s+(.+)$/.exec(ln);
    if (ul) {
      flushPara();
      if (!listBuf || listBuf.kind !== "ul") { flushList(); listBuf = { kind: "ul", items: [] }; }
      listBuf.items.push(renderMarkdownInline(ul[1]));
      continue;
    }
    if (ol) {
      flushPara();
      if (!listBuf || listBuf.kind !== "ol") { flushList(); listBuf = { kind: "ol", items: [] }; }
      listBuf.items.push(renderMarkdownInline(ol[1]));
      continue;
    }
    if (listBuf && /^\s{2,}/.test(ln)) {
      const cur = listBuf.items[listBuf.items.length - 1];
      if (Array.isArray(cur)) cur.push(" ", ...renderMarkdownInline(ln.trim()));
      continue;
    }
    flushList();
    paraBuf.push(ln);
  }
  flushPara(); flushList(); flushTable();
  return <>{out}</>;
}
