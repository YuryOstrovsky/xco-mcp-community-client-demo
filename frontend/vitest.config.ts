// Vitest config — separate from vite.config.ts because Vitest 4.x's
// `defineConfig` from `vitest/config` overlap with Vite's own
// `defineConfig` type, causing `tsc -b` to choose the wrong overload
// in some environments (CI specifically — local builds resolved fine).
//
// Splitting into its own file is the canonical Vitest solution: Vitest
// picks up `vitest.config.ts` before falling back to `vite.config.ts`.
// vite.config.ts no longer carries a `test` key, so its type-check is
// the standard Vite UserConfig path.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: false,  // skip CSS parsing — components use inline styles
  },
});
