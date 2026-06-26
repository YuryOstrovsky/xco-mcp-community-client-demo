// Tools tab view — browseable catalog of all MCP tools with category
// filter, search, and a per-tool detail panel that can fire the tool
// against the AI Console.
//
// Pure presentational: parent owns the tool catalog and the action
// callbacks. No closures over App scope.
//
// Extracted from App.tsx.

import { useState, useEffect, useMemo } from "react";
import type { ToolDef } from "../../lib/coreTypes";
import { postJSON } from "../../lib/api";

function buildInputsFromSchema(schema: any, depth = 0): any {
  if (!schema || typeof schema !== "object") return {};
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  const t = schema.type;

  if (t === "string") return "";
  if (t === "number" || t === "integer") return 0;
  if (t === "boolean") return false;

  // Arrays: keep empty by default (avoids huge/incorrect payloads)
  if (t === "array") return [];

  // Objects: include required fields (and any fields with defaults)
  if (t === "object" || schema.properties) {
    if (depth >= 4) return {};
    const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    const req: string[] = Array.isArray(schema.required) ? schema.required : [];
    const out: Record<string, any> = {};

    // required first
    for (const k of req) {
      out[k] = buildInputsFromSchema(props[k], depth + 1);
    }

    // then defaults (non-required)
    for (const [k, v] of Object.entries(props)) {
      if (out[k] !== undefined) continue;
      if (v && typeof v === "object" && (v as any).default !== undefined) {
        out[k] = (v as any).default;
      }
    }

    return out;
  }

  // Fallback
  return {};
}

function safeJsonParse(s: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export function ToolsView(props: {
  tools: ToolDef[];
  toolQuery: string;
  setToolQuery: (v: string) => void;
  toolCategory: string;
  setToolCategory: (v: string) => void;
  selectedTool: ToolDef | null;
  setSelectedTool: (t: ToolDef | null) => void;
  setActiveTab: (v: "dashboard" | "console" | "tools") => void;
  runNLWithText: (
    t: string,
    extra?: { force_tool?: string; force_inputs?: any; include_raw?: boolean }
  ) => Promise<void>;
  setIncludeRaw: (v: boolean) => void;
  setViewMode: (v: "summary" | "explain" | "raw") => void;
  setForcedTool: (v: string | null) => void;
  setForcedInputs: (v: any) => void;
}) {
  const {
    tools,
    toolQuery,
    setToolQuery,
    toolCategory,
    setToolCategory,
    selectedTool,
    setSelectedTool,
    setActiveTab,
    runNLWithText,
    setIncludeRaw,
    setViewMode,
    setForcedTool,
    setForcedInputs,
  } = props;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of tools) if (t.category) set.add(t.category);
    return ["All", ...Array.from(set).sort()];
  }, [tools]);

  const filtered = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    return tools.filter((t) => {
      if (toolCategory !== "All" && (t.category ?? "") !== toolCategory) return false;
      if (!q) return true;
      const hay = `${t.name} ${t.category ?? ""} ${t.method ?? ""} ${t.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tools, toolQuery, toolCategory]);

  // Run-tool panel state
  const [inputsText, setInputsText] = useState<string>("{}");
  const [toolIncludeRaw, setToolIncludeRaw] = useState<boolean>(false);
  const [invokeResp, setInvokeResp] = useState<any>(null);
  const [invokeErr, setInvokeErr] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);

  // When selection changes, pre-fill inputs from schema (required fields)
  useEffect(() => {
    setInvokeResp(null);
    setInvokeErr("");
    if (!selectedTool) {
      setInputsText("{}");
      setToolIncludeRaw(false);
      return;
    }
    const tmpl = buildInputsFromSchema(selectedTool.input_schema ?? {}, 0);
    setInputsText(JSON.stringify(tmpl ?? {}, null, 2));
    setToolIncludeRaw(false);
  }, [selectedTool?.name]);

  async function runTool() {
    if (!selectedTool) return;
    setInvokeErr("");
    setInvokeResp(null);

    const parsed = safeJsonParse(inputsText || "{}");
    if (!parsed.ok) {
      setInvokeErr(`Invalid JSON: ${parsed.error}`);
      return;
    }
    if (parsed.value === null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      setInvokeErr("Inputs must be a JSON object, e.g. {\"tenant_name\":\"DC-East\"}.");
      return;
    }

    const inputs = { ...(parsed.value as Record<string, any>) };
    if (toolIncludeRaw && inputs.include_raw === undefined) inputs.include_raw = true;

    setRunning(true);
    try {
      const r = await postJSON<any>("/api/invoke", {
        tool: selectedTool.name,
        inputs,
      });
      setInvokeResp(r);
    } catch (e: any) {
      setInvokeErr(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Explorer */}
        <div className="col-span-12 lg:col-span-4">
          <div
            className="rounded-lg p-4"
            style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}
          >
            <div className="text-base mb-3" style={{ fontWeight: 600 }}>
              Tool Explorer
            </div>

            <div className="flex gap-2 mb-3">
              <input
                className="flex-1 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--bg0)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
                placeholder="Search tools (name, category, description)…"
                value={toolQuery}
                onChange={(e) => setToolQuery(e.target.value)}
              />
            </div>

            <div className="flex gap-2 mb-3">
              <select
                className="flex-1 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--bg0)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
                value={toolCategory}
                onChange={(e) => setToolCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="text-sm opacity-80 self-center whitespace-nowrap">
                {filtered.length}/{tools.length}
              </div>
            </div>

            <div
              className="rounded-md"
              style={{
                border: "1px solid var(--border)",
                maxHeight: 560,
                overflow: "auto",
              }}
            >
              {filtered.map((t) => {
                const isSel = selectedTool?.name === t.name;
                return (
                  <div
                    key={t.name}
                    className="px-3 py-2 cursor-pointer"
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: isSel ? "rgba(137,129,229,0.18)" : "transparent",
                    }}
                    onClick={() => setSelectedTool(t)}
                  >
                    <div className="text-sm" style={{ fontWeight: 600 }}>
                      {t.name}
                    </div>
                    <div className="text-xs opacity-80">
                      {t.category ?? "—"} · {t.method ?? "—"} · {t.endpoint?.path ?? "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Details + Run */}
        <div className="col-span-12 lg:col-span-8">
          <div
            className="rounded-lg p-4"
            style={{ background: "var(--bg1)", border: "1px solid var(--border)" }}
          >
            <div className="text-base mb-3" style={{ fontWeight: 600 }}>
              Tool Details
            </div>

            {!selectedTool ? (
              <div className="opacity-80 text-sm">Select a tool from the list.</div>
            ) : (
              <>
                <div className="text-lg" style={{ fontWeight: 600 }}>
                  {selectedTool.name}
                </div>
                <div className="text-sm opacity-80 mb-3">{selectedTool.description ?? "—"}</div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="text-sm">
                    <div className="opacity-80">Category</div>
                    <div style={{ fontWeight: 600 }}>{selectedTool.category ?? "—"}</div>
                  </div>
                  <div className="text-sm">
                    <div className="opacity-80">Endpoint</div>
                    <div style={{ fontWeight: 600 }}>
                      {selectedTool.method ?? "—"} {selectedTool.endpoint?.path ?? "—"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Parameters table */}
                  <div>
                    <div className="text-sm opacity-80 mb-2">Parameters</div>
                    {(() => {
                      const schema = selectedTool.input_schema ?? {};
                      const props: Record<string, any> = schema.properties ?? {};
                      const required: string[] = Array.isArray(schema.required) ? schema.required : [];
                      const entries = Object.entries(props);
                      if (!entries.length) {
                        return (
                          <div
                            className="text-xs rounded-md p-3"
                            style={{
                              background: "var(--bg0)",
                              border: "1px solid var(--border)",
                              opacity: 0.6,
                            }}
                          >
                            No parameters
                          </div>
                        );
                      }
                      return (
                        <div
                          className="rounded-md overflow-auto"
                          style={{ border: "1px solid var(--border)", maxHeight: 260 }}
                        >
                          {entries.map(([key, val]) => {
                            const isReq = required.includes(key);
                            const type: string = (val as any)?.type ?? ((val as any)?.enum ? "enum" : "any");
                            const desc: string | undefined = (val as any)?.description;
                            const def = (val as any)?.default;
                            const enumVals: any[] | undefined = (val as any)?.enum;
                            return (
                              <div
                                key={key}
                                className="px-3 py-2 text-xs"
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                  background: "var(--bg0)",
                                }}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <code style={{ fontWeight: 600 }}>{key}</code>
                                  <span
                                    className="rounded px-1"
                                    style={{
                                      fontSize: 10,
                                      background: isReq
                                        ? "rgba(239,68,68,0.15)"
                                        : "rgba(34,197,94,0.15)",
                                      color: isReq ? "#fca5a5" : "#86efac",
                                      border: `1px solid ${
                                        isReq
                                          ? "rgba(239,68,68,0.3)"
                                          : "rgba(34,197,94,0.3)"
                                      }`,
                                    }}
                                  >
                                    {isReq ? "required" : "optional"}
                                  </span>
                                  <span className="opacity-60">{type}</span>
                                </div>
                                {desc && (
                                  <div className="opacity-70 mt-1">{desc}</div>
                                )}
                                {enumVals && (
                                  <div className="opacity-60 mt-1">
                                    Options:{" "}
                                    {enumVals.map((v: any) => `"${v}"`).join(", ")}
                                  </div>
                                )}
                                {def !== undefined && (
                                  <div className="opacity-60 mt-1">
                                    Default: {JSON.stringify(def)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Inputs */}
                  <div>
                    <div className="text-sm opacity-80 mb-2">Inputs (JSON)</div>
                    <textarea
                      className="w-full rounded-md p-3 text-xs font-mono"
                      style={{
                        background: "var(--bg0)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        minHeight: 260,
                      }}
                      value={inputsText}
                      onChange={(e) => setInputsText(e.target.value)}
                      spellCheck={false}
                    />

                    <div className="flex items-center justify-between mt-2">
                      <label className="flex items-center gap-2 text-sm opacity-80">
                        <input
                          type="checkbox"
                          checked={toolIncludeRaw}
                          onChange={(e) => setToolIncludeRaw(e.target.checked)}
                        />
                        include_raw (if supported)
                      </label>

                      <button
                        className="rounded-md px-3 py-2 text-sm"
                        style={{
                          background: running ? "transparent" : "var(--accent)",
                          border: running ? "1px solid var(--border)" : "none",
                          color: "var(--text)",
                          opacity: running ? 0.8 : 1,
                        }}
                        disabled={running}
                        onClick={runTool}
                      >
                        {running ? "Running..." : "Run Tool"}
                      </button>
                    </div>
                  </div>
                </div>

                {invokeErr && (
                  <div className="mt-3 text-sm" style={{ color: "#ffb4b4" }}>
                    {invokeErr}
                  </div>
                )}

                <div className="mt-4">
                  <div className="text-sm opacity-80 mb-2">Result</div>
                  <pre
                    className="text-xs rounded-md p-3 overflow-auto"
                    style={{
                      background: "var(--bg0)",
                      border: "1px solid var(--border)",
                      maxHeight: 320,
                    }}
                  >
{JSON.stringify(invokeResp ?? {}, null, 2)}
                  </pre>
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    className="rounded-md px-3 py-2 text-sm"
                    style={{ background: "var(--accent)" }}
                    onClick={async () => {
                      const demo = `Run ${selectedTool.name}.`;

                      // Jump to Console and "lock" the chosen tool so the Console Run button
                      // won't re-pick something else.
                      setActiveTab("console");
                      setForcedTool(selectedTool.name);
                      setForcedInputs({});

                      // Make it demo-friendly: turn on raw + show the Raw tab immediately.
                      setIncludeRaw(true);
                      setViewMode("raw");

                      await runNLWithText(demo, {
                        force_tool: selectedTool.name,
                        force_inputs: {},
                        include_raw: true,
                      });
                    }}
                  >
                    Use in Console
                  </button>

                  <button
                    className="rounded-md px-3 py-2 text-sm"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                    onClick={() => {
                      const tmpl = buildInputsFromSchema(selectedTool.input_schema ?? {}, 0);
                      setInputsText(JSON.stringify(tmpl ?? {}, null, 2));
                      setInvokeResp(null);
                      setInvokeErr("");
                    }}
                  >
                    Reset Inputs
                  </button>

                  <button
                    className="rounded-md px-3 py-2 text-sm"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                    onClick={() => setSelectedTool(null)}
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
