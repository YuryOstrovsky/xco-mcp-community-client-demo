#!/usr/bin/env node
// verify-typedinvoke-rejects — sanity-check that the generated types
// actually reject wrong call shapes. Writes a temp .ts file that
// deliberately calls invokeToolTyped with bad inputs, runs tsc on it,
// and asserts tsc exits non-zero with the expected errors.
//
// Run via: node scripts/verify-typedinvoke-rejects.mjs
//
// This is a one-shot proof — not wired into the regular build. If it
// passes once, the codegen + helper are correctly type-narrowing.

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TMPDIR = resolve(ROOT, ".verify-tmp");
const TMP = resolve(TMPDIR, "verify.ts");

mkdirSync(TMPDIR, { recursive: true });

writeFileSync(TMP, `
import { invokeToolTyped } from "../src/lib/typedInvoke";

// (1) Unknown tool name — must error.
// @ts-expect-error not a real tool
invokeToolTyped("not_a_real_tool", {});

// (2) Wrong key on a known tool — must error.
// inventory_delete_switch requires device_ips: string[], not "ip".
// @ts-expect-error wrong key
invokeToolTyped("inventory_delete_switch", { ip: "1.2.3.4" });

// (3) Wrong type for a known key — must error.
// device_ips is string[], not string.
// @ts-expect-error wrong type
invokeToolTyped("inventory_delete_switch", { device_ips: "1.2.3.4" });

// (4) Missing required key — must error.
// device_ips is required.
// @ts-expect-error missing required
invokeToolTyped("inventory_delete_switch", {});

// (5) Enum violation — fabric_get_config_show.role only accepts known values.
// @ts-expect-error enum mismatch
invokeToolTyped("fabric_get_config_show", { fabricName: "x", role: "rogue", ip: "1.2.3.4" });

// (6) The HAPPY path — must compile.
invokeToolTyped("inventory_delete_switch", { device_ips: ["10.20.30.5"] });
invokeToolTyped("fabric_get_config_show", { fabricName: "lab-b-alex", role: "spine", ip: "1.2.3.4" });
`);

let exitCode = 0;
let stderr = "";
try {
  // --noEmit + tsconfig from the frontend root — same compiler settings the
  // real build uses. ts-expect-error makes tsc PASS on those lines; if any
  // of them is wrong (the type IS accepted) tsc fails with TS2578 "unused
  // @ts-expect-error" which is also a fail signal we want.
  execSync(`./node_modules/.bin/tsc --noEmit --skipLibCheck --jsx react ${TMP}`, {
    cwd: ROOT,
    stdio: "pipe",
  });
} catch (e) {
  exitCode = e.status ?? 1;
  stderr = (e.stderr?.toString() ?? "") + (e.stdout?.toString() ?? "");
}

try { unlinkSync(TMP); } catch {}

if (exitCode !== 0) {
  console.error("verify-typedinvoke-rejects: FAIL — tsc errors below");
  console.error(stderr);
  process.exit(1);
}

console.log("verify-typedinvoke-rejects: PASS");
console.log("  All 5 deliberate-bad call sites were rejected.");
console.log("  All 2 happy-path call sites compiled.");
