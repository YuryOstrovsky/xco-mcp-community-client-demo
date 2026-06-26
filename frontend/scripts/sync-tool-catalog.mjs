#!/usr/bin/env node
// sync-tool-catalog — refresh the checked-in tool snapshot from a
// running backend. NOT part of the regular build — run manually when
// tools are added / removed / their schemas change.
//
// Usage:
//   BASE_URL=http://127.0.0.1:5174 TOKEN=<bearer> node scripts/sync-tool-catalog.mjs
//
// Defaults: BASE_URL=http://127.0.0.1:5174. TOKEN is required (mint
// via the backend's `core.auth.token_cache` or login flow). The
// snapshot is rewritten in-place and the change should be committed.
//
// After running this, run `npm run gen-tools` (or the next build) to
// regenerate tools.gen.ts from the new snapshot.

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(__dirname, "../src/lib/generated/toolCatalog.snapshot.json");

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5174";
const TOKEN = process.env.TOKEN ?? "";

if (!TOKEN) {
  console.error("sync-tool-catalog: TOKEN env var is required (bearer token)");
  console.error("  Mint one in a backend shell:");
  console.error("    .venv/bin/python -c \"import asyncio; from core.auth import token_cache; print(asyncio.run(token_cache.get()))\"");
  process.exit(2);
}

async function main() {
  const r = await fetch(`${BASE_URL}/api/tools`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) {
    console.error(`sync-tool-catalog: HTTP ${r.status} ${r.statusText}`);
    console.error(await r.text());
    process.exit(1);
  }
  const tools = await r.json();
  if (!Array.isArray(tools) || tools.length === 0) {
    console.error("sync-tool-catalog: empty / non-array response — refusing to overwrite");
    process.exit(1);
  }
  // Slim to just what codegen needs — keeps the diff readable.
  const slim = tools
    .filter((t) => t && typeof t.name === "string")
    .map((t) => ({
      name: t.name,
      description: typeof t.description === "string" ? t.description.slice(0, 300) : "",
      input_schema: t.input_schema ?? {},
    }));
  const out = {
    generated_at: new Date().toISOString(),
    count: slim.length,
    tools: slim,
  };
  writeFileSync(SNAPSHOT, JSON.stringify(out, null, 2), "utf-8");
  console.log(`sync-tool-catalog: wrote ${slim.length} tools → ${SNAPSHOT}`);
  console.log("  next: run `npm run gen-tools` (or rebuild) to regenerate tools.gen.ts");
}

main().catch((e) => {
  console.error("sync-tool-catalog: failed:", e?.message ?? e);
  process.exit(1);
});
