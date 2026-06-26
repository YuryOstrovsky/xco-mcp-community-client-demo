// SkillSuggestionChip unit tests — keyword-tier + LLM-tier rendering.
//
// First-ever frontend Vitest tests in the project (task #89).
// Establishes the pattern: import the component, render with controlled
// props, assert on the visible output.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillSuggestionChip } from "./SkillSuggestionChip";

const FAKE_CONFIG = {
  buttonLabel: "Safe Fabric Cleanup",
  accent: "#fb7185",
  description: "Audits a fabric...",
};

describe("SkillSuggestionChip", () => {
  it("renders nothing when matchedConfig is null", () => {
    const { container } = render(
      <SkillSuggestionChip
        matchedConfig={null}
        matchedKey=""
        isLlmSuggestion={false}
        llmReason=""
        onRun={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the keyword-tier label when isLlmSuggestion is false", () => {
    render(
      <SkillSuggestionChip
        matchedConfig={FAKE_CONFIG}
        matchedKey="safeFabricCleanup"
        isLlmSuggestion={false}
        llmReason=""
        onRun={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/Looks like a job for an agent skill/)).toBeInTheDocument();
    expect(screen.getByText(/Run Safe Fabric Cleanup/)).toBeInTheDocument();
  });

  it("renders the LLM-tier label + reason when isLlmSuggestion is true", () => {
    render(
      <SkillSuggestionChip
        matchedConfig={FAKE_CONFIG}
        matchedKey="safeFabricCleanup"
        isLlmSuggestion={true}
        llmReason="The fabric mentioned is empty, perfect cleanup candidate."
        onRun={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/Agent suggests/)).toBeInTheDocument();
    // The italic reason — wrapped in parens.
    expect(screen.getByText(/perfect cleanup candidate/)).toBeInTheDocument();
  });

  it("calls onRun with the matchedKey when Run button is clicked", async () => {
    const onRun = vi.fn();
    render(
      <SkillSuggestionChip
        matchedConfig={FAKE_CONFIG}
        matchedKey="safeFabricCleanup"
        isLlmSuggestion={false}
        llmReason=""
        onRun={onRun}
        onDismiss={() => {}}
      />,
    );
    await userEvent.click(screen.getByText(/Run Safe Fabric Cleanup/));
    expect(onRun).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledWith("safeFabricCleanup");
  });

  it("calls onDismiss when the dismiss button is clicked", async () => {
    const onDismiss = vi.fn();
    render(
      <SkillSuggestionChip
        matchedConfig={FAKE_CONFIG}
        matchedKey="x"
        isLlmSuggestion={false}
        llmReason=""
        onRun={() => {}}
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(screen.getByText(/× dismiss/));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
