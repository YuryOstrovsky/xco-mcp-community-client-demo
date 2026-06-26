// FreshnessHint unit tests — age computation + stale threshold + interval cleanup.
//
// Uses vi.useFakeTimers() so we can control Date.now() without sleeping.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { FreshnessHint } from "./FreshnessHint";

describe("FreshnessHint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin "now" so we can compute ages deterministically.
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders 'just now' for a fresh proposal", () => {
    // Emitted 10 seconds ago → 0 minutes.
    render(<FreshnessHint emittedAt="2026-05-25T11:59:50.000Z" />);
    expect(screen.getByText(/just now/)).toBeInTheDocument();
  });

  it("renders 'N min ago' for a non-stale proposal", () => {
    // Emitted 5 min ago.
    render(<FreshnessHint emittedAt="2026-05-25T11:55:00.000Z" />);
    expect(screen.getByText(/5 min ago/)).toBeInTheDocument();
    // Not stale → no 'expired' badge.
    expect(screen.queryByText(/expired/)).toBeNull();
  });

  it("renders 'expired' once past the stale threshold", () => {
    // Emitted 20 min ago, default threshold 15 min → stale.
    render(<FreshnessHint emittedAt="2026-05-25T11:40:00.000Z" />);
    expect(screen.getByText(/20 min ago/)).toBeInTheDocument();
    expect(screen.getByText(/expired/)).toBeInTheDocument();
  });

  it("respects a custom staleAfterMin threshold", () => {
    // 10 min old, threshold 5 → stale.
    render(<FreshnessHint emittedAt="2026-05-25T11:50:00.000Z" staleAfterMin={5} />);
    expect(screen.getByText(/expired/)).toBeInTheDocument();
  });

  it("re-renders after the 30s tick — age advances", () => {
    // Start: emitted 1 min ago.
    render(<FreshnessHint emittedAt="2026-05-25T11:59:00.000Z" />);
    expect(screen.getByText(/1 min ago/)).toBeInTheDocument();

    // Advance system time by 5 min AND run the setInterval (30s).
    act(() => {
      vi.setSystemTime(new Date("2026-05-25T12:05:00.000Z"));
      vi.advanceTimersByTime(30_000);
    });

    // Now should read 6 min ago.
    expect(screen.getByText(/6 min ago/)).toBeInTheDocument();
  });
});
