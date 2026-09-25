import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminState } from "~/features/admin/types";
import { BudgetTiles } from "./budget-tiles";
import { ControlsPanel } from "./controls-panel";

const budget = {
  used: 2,
  limit: 10,
  personLimit: 1,
  priorityPersonLimit: 3,
  networkLimit: 10,
};
const state: AdminState = {
  now: 0,
  controls: {
    videoAudience: "priority",
    priorityPlaces: "cities",
    videosPaused: false,
    videoDailyLimit: 20,
    videoPersonDailyLimit: 2,
    videoPriorityPersonDailyLimit: null,
    videoNetworkDailyLimit: null,
  },
  video: { videos: budget, renders: budget },
  voicePausedUntil: null,
  voiceCreditUsd: null,
  claudeCredit: { setUsd: 50, setAt: 0, spentUsd: 5 },
  diagramQuota: null,
  presence: null,
  deployment: { commit: null, region: null },
};

afterEach(cleanup);

function renderControls(change = vi.fn(async () => null)) {
  render(
    <ControlsPanel
      state={state}
      saving={false}
      saveError={null}
      change={change}
    />,
  );
  return change;
}

describe("video making controls", () => {
  it("asks before opening video making to everyone", async () => {
    const change = renderControls();
    fireEvent.click(screen.getByRole("radio", { name: /Everyone/ }));
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Yes, open to everyone" }),
      ),
    );
    expect(change).toHaveBeenCalledWith({ videoAudience: "everyone" });
  });

  it("changes a smaller audience straight away", () => {
    const change = renderControls();
    fireEvent.click(screen.getByRole("radio", { name: /All desktops/ }));
    expect(change).toHaveBeenCalledWith({ videoAudience: "desktop" });
  });

  it("moves between choices with the arrow keys without picking", () => {
    const change = renderControls();
    const radios = within(
      screen.getByRole("radiogroup", { name: "Who can make new videos" }),
    ).getAllByRole("radio");
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1]!, { key: "End" });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(radios[2]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[0]);
    expect(change).not.toHaveBeenCalled();
  });

  it("switches the priority places straight away", () => {
    const change = renderControls();
    fireEvent.click(screen.getByRole("radio", { name: /US, Canada & UK/ }));
    expect(change).toHaveBeenCalledWith({ priorityPlaces: "countries" });
  });

  it("asks before dropping a limit override", async () => {
    const change = renderControls();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset new videos per day to the default",
      }),
    );
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Yes, use the default" }),
      ),
    );
    expect(change).toHaveBeenCalledWith({ videoDailyLimit: null });
  });

  it("locks limit buttons while a change saves", () => {
    render(
      <ControlsPanel
        state={state}
        saving
        saveError={null}
        change={vi.fn(async () => null)}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Set per person per day" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Reset per person per day to the default",
      }),
    ).toBeDisabled();
  });
});

describe("accessible names", () => {
  it("gives every dashboard button its own name", () => {
    render(
      <>
        <ControlsPanel
          state={state}
          saving={false}
          saveError={null}
          change={vi.fn(async () => null)}
        />
        <BudgetTiles state={state} onChanged={() => undefined} />
      </>,
    );
    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Reset today's video count");
    expect(names).toContain("Reset today's MP4 count");
  });
});
