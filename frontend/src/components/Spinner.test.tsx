import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders a rotating status element", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el.className).toContain("animate-spin");
  });

  it("renders an optional label", () => {
    render(<Spinner label="Analyzing…" />);
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();
  });

  it("honors a custom size", () => {
    render(<Spinner size={20} />);
    expect(screen.getByRole("status")).toHaveStyle({ width: "20px", height: "20px" });
  });
});
