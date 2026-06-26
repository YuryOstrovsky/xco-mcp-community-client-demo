// CopyButton unit tests — clipboard write + 'Copied!' confirmation flash.
//
// Two tricky bits jsdom forces us around:
//   1. navigator.clipboard isn't available by default — stub it via
//      Object.defineProperty so the writeText() branch can run.
//   2. The original handler uses Promise.then() callbacks, so we can't
//      synchronously assert the post-click state. Use waitFor() with the
//      default 1s window.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  it("renders the default label", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("renders a custom label when provided", () => {
    render(<CopyButton text="hello" label="Copy URL" />);
    expect(screen.getByText("Copy URL")).toBeInTheDocument();
  });

  it("calls clipboard.writeText with the provided text on click", async () => {
    render(<CopyButton text="copy this exact text" />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("copy this exact text");
    });
  });

  it("flashes 'Copied!' after a successful copy", async () => {
    render(<CopyButton text="x" />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });
});
