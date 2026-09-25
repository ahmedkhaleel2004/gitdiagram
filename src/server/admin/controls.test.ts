import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
        "videoNetworkDailyLimit",
        "3",
      ]),
    ).toEqual({
      videoAudience: "everyone",
      videosPaused: true,
      videoDailyLimit: 200,
      videoNetworkDailyLimit: 3,
    });
  });

  it("ignores values it does not understand", () => {
    expect(
      parseControls(["videoAudience", "martians", "videoDailyLimit", "-4"]),
    ).toEqual(DEFAULT_CONTROLS);
  });
});
