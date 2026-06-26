// frontend/src/features/help/HelpWidget.test.tsx

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpWidget } from "./HelpWidget";

const props = {
  open: true,
  expandedCats: new Set<string>(),
  setExpandedCats: vi.fn(),
  exampleNames: { fab: "lab-b", tenant: "Tenant-A", leaf: (i: number) => `Leaf-${i + 1}`, spine: (i: number) => `Spine-${i + 1}` },
  onClose: vi.fn(),
  onPick: vi.fn(),
};

describe("HelpWidget search", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<HelpWidget {...props} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has a search box and filters to matches", () => {
    render(<HelpWidget {...props} />);
    const box = screen.getByPlaceholderText(/Search examples/i);
    fireEvent.change(box, { target: { value: "tenant" } });
    // Match-count summary shows; no empty-state.
    expect(screen.getByText(/match(es)? across/i)).toBeInTheDocument();
    expect(screen.queryByText(/No examples match/i)).not.toBeInTheDocument();
    // A tenant command surfaces (search auto-expands matching categories).
    expect(screen.getAllByText(/tenant/i).length).toBeGreaterThan(0);
  });

  it("shows an empty state when nothing matches", () => {
    render(<HelpWidget {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/Search examples/i), { target: { value: "zzzznotacommand" } });
    expect(screen.getByText(/No examples match/i)).toBeInTheDocument();
  });

  it("clears the query with the × button", () => {
    render(<HelpWidget {...props} />);
    const box = screen.getByPlaceholderText(/Search examples/i) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "tenant" } });
    expect(box.value).toBe("tenant");
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(box.value).toBe("");
  });
});
