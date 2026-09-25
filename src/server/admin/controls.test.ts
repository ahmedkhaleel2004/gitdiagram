import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { upstashCommand } = vi.hoisted(() => ({ upstashCommand: vi.fn() }));
vi.mock("~/server/storage/upstash", () => ({ upstashCommand }));

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
      ]),
    ).toEqual({
      videoAudience: "everyone",
      priorityPlaces: "countries",
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
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("refuses to admit new work on guessed settings", async () => {
    const { readAdmissionControls, readControls } = await load();
    upstashCommand.mockRejectedValue(new Error("down"));
    await expect(readAdmissionControls()).rejects.toThrow("down");
    // Display still answers, with the defaults when nothing was ever read.
    await expect(readControls()).resolves.toEqual(DEFAULT_CONTROLS);
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
    upstashCommand.mockImplementation(async (command: unknown[]) => {
      if (command[0] === "HGETALL") throw new Error("down");
      return 1;
    });
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
    expect(upstashCommand).toHaveBeenCalledWith([
      "HSET",
      "admin:v1:controls",
      "videosPaused",
      "1",
    ]);
  });
});
