// Vitest global setup — runs once before each test file's tests.
//
// Imports jest-dom matchers (toBeInTheDocument, toHaveTextContent,
// etc.) and attaches them to Vitest's expect.
//
// Loaded via vite.config.ts `test.setupFiles`.

import "@testing-library/jest-dom/vitest";
