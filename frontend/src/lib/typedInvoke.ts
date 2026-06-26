// typedInvoke — compile-time-checked /api/invoke wrapper.
//
// Wraps postJSON("/api/invoke", { tool, inputs }) with strict types
// generated from the live tool catalog (see scripts/gen-tool-types.mjs).
// The runtime is identical to a raw postJSON; the difference is that
// `tool` is constrained to ToolName and `inputs` is checked against
// the tool's projected input shape.
//
// Usage:
//   import { invokeToolTyped, type ToolName, type ToolInputs } from "./typedInvoke";
//   const r = await invokeToolTyped("inventory_getswitches", { "fabric-name": "lab-b" });
//   // ^ "device-ip" misspelled? TypeScript catches it.
//
// Migrating existing `postJSON("/api/invoke", { tool, inputs })` call
// sites is opt-in — the raw postJSON still works for code paths that
// build `tool` from a runtime string (NL routing, agent skill loops,
// etc.) where compile-time checking is impossible.
//
// What this does NOT do:
//   - Type the RESPONSE. Tool responses are too varied; cast at the
//     call site after inspecting the shape.
//   - Validate nested object inputs. Object fields are typed as
//     Record<string, unknown> (see gen-tool-types.mjs for rationale).

import { postJSON } from "./api";
import type { ToolName, ToolInputs } from "./generated/tools.gen";

export type { ToolName, ToolInputs, ToolInputsMap } from "./generated/tools.gen";
export { TOOL_NAMES } from "./generated/tools.gen";

/** Compile-time-checked /api/invoke call. */
export async function invokeToolTyped<N extends ToolName>(
  tool: N,
  inputs: ToolInputs<N>,
): Promise<any> {
  return postJSON<any>("/api/invoke", { tool, inputs });
}
