// Panel unit tests — title + optional subtitle + optional close button + children.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("renders title and children", () => {
    render(
      <Panel title="My Panel">
        <div>panel body content</div>
      </Panel>,
    );
    expect(screen.getByText("My Panel")).toBeInTheDocument();
    expect(screen.getByText("panel body content")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(
      <Panel title="Title" subtitle="explanatory text">
        <div>body</div>
      </Panel>,
    );
    expect(screen.getByText("explanatory text")).toBeInTheDocument();
  });

  it("does not render subtitle element when omitted", () => {
    const { container } = render(
      <Panel title="Title">
        <div>body</div>
      </Panel>,
    );
    // No <p> element should be inside the header when subtitle is absent.
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders the close button when onClose is provided", () => {
    render(
      <Panel title="Title" onClose={() => {}}>
        <div>body</div>
      </Panel>,
    );
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Panel title="Title" onClose={onClose}>
        <div>body</div>
      </Panel>,
    );
    await userEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("omits the close button when onClose is not provided", () => {
    render(
      <Panel title="Title">
        <div>body</div>
      </Panel>,
    );
    expect(screen.queryByLabelText("Close")).toBeNull();
  });
});
