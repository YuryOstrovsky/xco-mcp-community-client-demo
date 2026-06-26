// SwitchPickerModal unit tests — open gate + empty state + pick callback + cancel.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SwitchPickerModal } from "./SwitchPickerModal";

const SWITCHES = [
  { ip: "10.1.1.1", name: "leaf1" },
  { ip: "10.1.1.2", name: "leaf2" },
  { ip: "10.1.1.10" }, // no name — should render IP only
];

describe("SwitchPickerModal", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <SwitchPickerModal
        open={false}
        title="Pick switch"
        switches={SWITCHES}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the title in the header", () => {
    render(
      <SwitchPickerModal
        open={true}
        title="Pick a switch for clock query"
        switches={SWITCHES}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Pick a switch for clock query")).toBeInTheDocument();
  });

  it("shows the empty-state hint when switches list is empty", () => {
    render(
      <SwitchPickerModal
        open={true}
        title="Pick switch"
        switches={[]}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/No switches available/)).toBeInTheDocument();
  });

  it("renders every switch in the list", () => {
    render(
      <SwitchPickerModal
        open={true}
        title="Pick switch"
        switches={SWITCHES}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("leaf1")).toBeInTheDocument();
    expect(screen.getByText("leaf2")).toBeInTheDocument();
    // The third switch has no name → IP appears as the primary label.
    expect(screen.getByText("10.1.1.10")).toBeInTheDocument();
  });

  it("calls onPick with (ip, name) when a switch is clicked", async () => {
    const onPick = vi.fn();
    render(
      <SwitchPickerModal
        open={true}
        title="Pick switch"
        switches={SWITCHES}
        onPick={onPick}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByText("leaf1"));
    expect(onPick).toHaveBeenCalledWith("10.1.1.1", "leaf1");
  });

  it("calls onPick with empty-string name when switch has no name", async () => {
    const onPick = vi.fn();
    render(
      <SwitchPickerModal
        open={true}
        title="Pick switch"
        switches={SWITCHES}
        onPick={onPick}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByText("10.1.1.10"));
    expect(onPick).toHaveBeenCalledWith("10.1.1.10", "");
  });

  it("calls onClose when the X button is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <SwitchPickerModal
        open={true}
        title="Pick switch"
        switches={SWITCHES}
        onPick={() => {}}
        onClose={onClose}
      />,
    );
    // The close X has no label; it's the first button.
    const buttons = container.querySelectorAll("button");
    await userEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
