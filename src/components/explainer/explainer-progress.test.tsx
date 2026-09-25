import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GenerationRows,
  ScriptPreview,
} from "~/components/explainer/explainer-progress";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GenerationRows", () => {
  it("counts designed scenes but not the narration, which is one take", () => {
    render(
      <GenerationRows
        stage="designing"
        progress={{ scenes: 5, words: 150, designed: 2, voiced: 0 }}
      />,
    );
    const row = (label: string) => screen.getByText(label).closest("li")!;
    expect(within(row("Design the scenes")).getByText("2/5")).toBeTruthy();
    expect(row("Record the narration")).toHaveAttribute(
      "data-state",
      "running",
    );
    expect(row("Record the narration").textContent).toBe(
      "Record the narration",
    );
  });

  it("checks the narration off once it is recorded", () => {
    render(
      <GenerationRows
        stage="designing"
        progress={{ scenes: 5, words: 150, designed: 2, voiced: 5 }}
      />,
    );
    expect(
      screen.getByText("Record the narration").closest("li"),
    ).toHaveAttribute("data-state", "done");
  });
});

describe("ScriptPreview", () => {
  it("stops its typing timer once the whole script is shown", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(<ScriptPreview lines={["Hello there,", "world."]} />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(28 * 10));
    expect(
      screen.getByText("Hello there, world.", {
        selector: "span[aria-hidden]",
      }),
    ).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
