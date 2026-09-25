import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { upstashCommand, upstashEval } = vi.hoisted(() => ({
  upstashCommand: vi.fn(),
  upstashEval: vi.fn(),
}));
vi.mock("~/server/storage/upstash", () => ({ upstashCommand, upstashEval }));

import { DEFAULT_CONTROLS, parseControls } from "./controls";

describe("live controls", () => {
  it("falls back to the defaults when nothing is set", () => {
    expect(parseControls(null)).toEqual(DEFAULT_CONTROLS);
    expect(parseControls([])).toEqual(DEFAULT_CONTROLS);
  });

  it("reads Redis's flat field list", () => {
    expect(
      parseControls([
        "videoAudience",
        "everyone",
        "videosPaused",
        "1",
        "videoDailyLimit",
        "200",
        "videoPersonDailyLimit",
        "2",
        "videoNetworkDailyLimit",
        "3",
        "priorityPlaces",
        "countries",
        "videoPriorityPersonDailyLimit",
        "4",
        "limitedCountryAccess",
        "blocked",
        "limitedCountryShare",
        "25",
      ]),
    ).toEqual({
      videoAudience: "everyone",
      priorityPlaces: "countries",
      limitedCountryAccess: "blocked",
      limitedCountryShare: 25,
      videosPaused: true,
      videoDailyLimit: 200,
      videoPersonDailyLimit: 2,
      videoPriorityPersonDailyLimit: 4,
      videoNetworkDailyLimit: 3,
    });
  });

  it("ignores values it does not understand", () => {
    expect(
      parseControls([
        "videoAudience",
        "martians",
        "priorityPlaces",
        "moon",
        "videoDailyLimit",
        "-4",
        "limitedCountryAccess",
        "everyone",
        "limitedCountryShare",
        "101",
      ]),
    ).toEqual(DEFAULT_CONTROLS);
  });
});

describe("reading controls while Redis is down", () => {
  // Each test gets a fresh module, so no cached read carries over.
  const load = () => import("./controls");

  beforeEach(() => {
    vi.resetModules();
    upstashCommand.mockReset();
    upstashEval.mockReset();
    upstashEval.mockResolvedValue(1);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("refuses to admit new work on guessed settings", async () => {
    const { readAdmissionControls, readControls } = await load();
    upstashCommand.mockRejectedValue(new Error("down"));
    await expect(readAdmissionControls()).rejects.toThrow("down");
    // Display still answers, with the defaults when nothing was ever read.
    await expect(readControls()).resolves.toEqual(DEFAULT_CONTROLS);
  });

  it("says when what it shows could not be read", async () => {
    const { readControlsForDisplay } = await load();
    upstashCommand.mockRejectedValueOnce(new Error("down"));
    await expect(readControlsForDisplay({ fresh: true })).resolves.toEqual({
      controls: DEFAULT_CONTROLS,
      unreadable: true,
    });
    upstashCommand.mockResolvedValueOnce(["videosPaused", "1"]);
    await expect(readControlsForDisplay({ fresh: true })).resolves.toEqual({
      controls: { ...DEFAULT_CONTROLS, videosPaused: true },
      unreadable: false,
    });
    upstashCommand.mockRejectedValueOnce(new Error("down"));
    await expect(readControlsForDisplay({ fresh: true })).resolves.toEqual({
      controls: { ...DEFAULT_CONTROLS, videosPaused: true },
      unreadable: true,
    });
  });

  it("shows the last controls read, not the defaults", async () => {
    const { readControls } = await load();
    upstashCommand.mockResolvedValueOnce(["videosPaused", "1"]);
    expect((await readControls({ fresh: true })).videosPaused).toBe(true);
    upstashCommand.mockRejectedValue(new Error("down"));
    expect((await readControls({ fresh: true })).videosPaused).toBe(true);
  });

  it("does not report defaults after a save it cannot read back", async () => {
    const { readControls, writeControls, ControlsUnconfirmedError } =
      await load();
    upstashCommand.mockRejectedValue(new Error("down"));
    await expect(writeControls({ videosPaused: true })).rejects.toBeInstanceOf(
      ControlsUnconfirmedError,
    );

    upstashCommand.mockResolvedValueOnce(["videoDailyLimit", "40"]);
    await readControls({ fresh: true });
    await expect(writeControls({ videosPaused: true })).resolves.toEqual({
      ...DEFAULT_CONTROLS,
      videoDailyLimit: 40,
      videosPaused: true,
    });
  });

  it("saves a change as one script: fields to set, then fields to clear", async () => {
    const { writeControls, WRITE_CONTROLS_SCRIPT } = await load();
    upstashCommand.mockResolvedValue([]);
    await writeControls({
      videosPaused: true,
      videoDailyLimit: 12,
      videoNetworkDailyLimit: null,
    });
    expect(upstashEval).toHaveBeenCalledTimes(1);
    expect(upstashEval).toHaveBeenCalledWith({
      script: WRITE_CONTROLS_SCRIPT,
      keys: ["admin:v1:controls"],
      args: [
        4,
        "videosPaused",
        "1",
        "videoDailyLimit",
        12,
        "videoNetworkDailyLimit",
      ],
    });
    // A failed save is reported as such, with nothing half-written.
    upstashEval.mockRejectedValueOnce(new Error("down"));
    await expect(writeControls({ videosPaused: false })).rejects.toThrow(
      "down",
    );
  });
});
