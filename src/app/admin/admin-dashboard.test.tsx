import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminState } from "~/features/admin/types";
import { AdminDashboard } from "./admin-dashboard";
import { priorityHint } from "./people-panel";

vi.mock("./use-live-site", async () => {
  const { EMPTY_SITE } = await import("~/features/admin/live-link");
  return {
    useLiveSite: () => ({ ...EMPTY_SITE, status: "offline", latency: null }),
  };
});

const adminState = (overrides: Partial<AdminState> = {}): AdminState => ({
  now: 0,
  controls: {
    videoAudience: "priority",
    priorityPlaces: "cities",
    videosPaused: false,
    videoDailyLimit: null,
    videoPersonDailyLimit: null,
    videoPriorityPersonDailyLimit: null,
    videoNetworkDailyLimit: null,
    limitedCountryAccess: "some",
    limitedCountryShare: null,
  },
  controlsUnreadable: false,
  video: null,
  voicePausedUntil: null,
  voiceCreditUsd: null,
  claudeCredit: "no-key",
  diagramQuota: null,
  presence: null,
  deployment: { commit: null, region: null },
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

let signOut: () => Promise<Response>;
let reload: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  reload = vi.fn<() => void>();
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    reload,
  });
  signOut = async () => json({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return signOut();
      return json(adminState());
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderDashboard() {
  await act(async () => void render(<AdminDashboard />));
}

const signOutEverywhere = () =>
  act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    ),
  );

describe("signing out everywhere", () => {
  it("stays signed in and offers a retry when the server could not do it", async () => {
    signOut = async () =>
      json({ error: "Could not sign out everywhere. Try again." }, 503);
    await renderDashboard();
    await signOutEverywhere();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not sign out everywhere. Try again.",
    );

    signOut = async () => json({ ok: true });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Try again" })),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    const deletes = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes.map(([path]) => path)).toEqual([
      "/api/admin/session?everywhere=1",
      "/api/admin/session?everywhere=1",
    ]);
  });

  it("says so when the connection failed", async () => {
    signOut = () => Promise.reject(new TypeError("Failed to fetch"));
    await renderDashboard();
    await signOutEverywhere();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Could not reach GitDiagram/,
    );
  });

  it("goes back to sign-in once it worked", async () => {
    await renderDashboard();
    await signOutEverywhere();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("the dashboard's warnings", () => {
  it("warns when the switches shown could not be read", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      json(adminState({ controlsUnreadable: true })),
    );
    await renderDashboard();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not be read from Redis/,
    );
  });

  it("explains priority places by the audience switch", () => {
    expect(priorityHint("priority")).toMatch(/^The only places/);
    expect(priorityHint("desktop")).toMatch(/elsewhere only desktops/);
    expect(priorityHint("everyone")).toMatch(/^Anyone anywhere/);
    expect(priorityHint(undefined)).toBe(
      "People here get more videos a day, the first with Claude Opus.",
    );
  });
});
