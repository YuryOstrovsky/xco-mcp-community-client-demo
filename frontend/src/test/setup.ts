// Vitest global setup — runs once before each test file's tests.
//
// Imports jest-dom matchers (toBeInTheDocument, toHaveTextContent,
// etc.) and attaches them to Vitest's expect.
//
// Loaded via vite.config.ts `test.setupFiles`. See task #89.

import "@testing-library/jest-dom/vitest";
