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
    limitedCountryAccess: "some",
    limitedCountryShare: null,
    videosPaused: false,
    videoDailyLimit: 20,
    videoPersonDailyLimit: 2,
    videoPriorityPersonDailyLimit: null,
    videoNetworkDailyLimit: null,
  },
  controlsUnreadable: false,
  video: { videos: budget, renders: budget },
  voicePausedUntil: null,
  voiceCreditUsd: null,
  claudeCredit: { setUsd: 50, setAt: 0, spentUsd: 5 },
  diagramQuota: null,
  presence: null,
  deployment: { commit: null, region: null },
};

afterEach(cleanup);

function renderControls(
  change = vi.fn(async (): Promise<string | null> => null),
) {
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

  it("blocks the limited countries straight away, and asks before opening them", async () => {
    const change = renderControls();
    const group = screen.getByRole("radiogroup", { name: "Limited countries" });
    expect(
      within(group).getByRole("radio", { name: /10% a day/ }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(group).getByRole("radio", { name: /Blocked/ }));
    expect(change).toHaveBeenCalledWith({ limitedCountryAccess: "blocked" });
    change.mockClear();
    fireEvent.click(within(group).getByRole("radio", { name: /Open/ }));
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Yes, open them" })),
    );
    expect(change).toHaveBeenCalledWith({ limitedCountryAccess: "open" });
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

  it("caps a limit where the server does, and shows why a save failed", async () => {
    const change = vi.fn(async () => "The change did not save. Try again.");
    renderControls(change);
    const input = screen.getByRole("textbox", { name: "Per person per day" });
    const set = screen.getByRole("button", { name: "Set per person per day" });
    fireEvent.change(input, { target: { value: "1001" } });
    expect(set).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("At most 1,000");
    fireEvent.change(input, { target: { value: "1000" } });
    await act(async () => fireEvent.click(set));
    expect(change).toHaveBeenCalledWith({ videoPersonDailyLimit: 1000 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The change did not save. Try again.",
    );
  });

  it("describes who gets which model the way videos are made", () => {
    renderControls();
    expect(
      screen.getByText(
        /Opus writes the script and GPT-6 Sol designs the scenes/,
      ),
    ).toBeInTheDocument();
  });
});

describe("the Claude balance tile", () => {
  const tiles = (claudeCredit: AdminState["claudeCredit"]) =>
    render(
      <BudgetTiles
        state={{ ...state, claudeCredit }}
        onChanged={() => undefined}
        onCredit={() => undefined}
      />,
    );
  const update = () =>
    screen.queryByRole("button", { name: "Update the Claude balance" });

  it("says a key is missing, and offers nothing to update", () => {
    tiles("no-key");
    expect(screen.getByText("Needs ANTHROPIC_ADMIN_KEY.")).toBeInTheDocument();
    expect(update()).toBeNull();
  });

  it("tells a failed read apart, and still lets the balance be entered", () => {
    tiles("unreadable");
    expect(screen.getByText(/could not be read just now/)).toBeInTheDocument();
    expect(update()).not.toBeNull();
  });

  it("shows a saved balance at once", async () => {
    const onCredit = vi.fn();
    const credit = { setUsd: 30, setAt: 7, spentUsd: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, credit }))),
    );
    render(
      <BudgetTiles
        state={state}
        onChanged={() => undefined}
        onCredit={onCredit}
      />,
    );
    fireEvent.click(update()!);
    fireEvent.change(screen.getByLabelText(/Balance in the Console/), {
      target: { value: "30" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save balance" })),
    );
    expect(onCredit).toHaveBeenCalledWith(credit);
    vi.unstubAllGlobals();
  });
});

describe("the voice balance tile", () => {
  it("makes no per-video estimate it cannot back up", () => {
    render(
      <BudgetTiles
        state={{ ...state, voiceCreditUsd: 4 }}
        onChanged={() => undefined}
        onCredit={() => undefined}
      />,
    );
    expect(screen.getByText("$4.00")).toBeInTheDocument();
    expect(screen.queryByText(/videos at/)).toBeNull();
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
        <BudgetTiles
          state={state}
          onChanged={() => undefined}
          onCredit={() => undefined}
        />
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
