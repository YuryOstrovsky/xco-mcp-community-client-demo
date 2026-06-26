// Vite config (production build + dev server). Vitest config lives in
// the sibling file `vitest.config.ts` — splitting was needed because
// Vitest 4.x's `defineConfig` overlap with Vite's caused `tsc -b` to
// pick the wrong overload in CI (local builds resolved fine, CI didn't).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Manual chunk routing — keeps heavy vendor deps in their own files so
// they cache independently of app code. The previous single bundle was
// ~1.8MB; splitting reactflow + recharts + react gets the app chunk to
// ~1.1MB and lets browsers reuse the vendor chunks across deploys when
// only app code changes.
//
// Rule of thumb: anything you import from a node_modules dep with a
// chunky on-disk footprint (>50KB minified) deserves its own chunk.
// Don't manually-chunk things that share helpers — Vite's tree-shaker
// can fail if vendor1 and vendor2 both import from the same util.
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  // reactflow brings its own d3-* tree (~300KB). Worth isolating.
  if (id.includes("/reactflow/") || id.includes("/@reactflow/")) return "vendor-reactflow";
  // recharts pulls d3 too — keeps it from being double-bundled with the
  // (smaller) reactflow d3 surface, but a single shared d3 chunk also
  // works. We isolate per-lib for predictable cache invalidation.
  if (id.includes("/recharts/") || id.includes("/d3-")) return "vendor-recharts";
  // react + react-dom are stable across most app changes. Splitting
  // them out means a CSS-only change doesn't bust the React cache.
  if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Raise the chunk-size warning threshold to 1000KB — without it,
    // we'd still see noise for the (intentionally) ~1MB app chunk.
    // Don't silence individual vendor warnings; just let them be loud
    // if they get worse.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
