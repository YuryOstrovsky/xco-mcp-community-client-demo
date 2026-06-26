// Card unit tests — minimal title + value renderer.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders title and value", () => {
    render(<Card title="Active Switches" value="42" />);
    expect(screen.getByText("Active Switches")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders an empty-string value without breaking", () => {
    render(<Card title="Empty" value="" />);
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });
});
