import { describe, expect, it } from "vitest";

import { describeEvent, movesCounters } from "./events";
import { since, tally } from "./format";

const event = (kind: string, details: Record<string, unknown> = {}) => ({
  id: 1,
  at: 0,
  kind,
  ...details,
});

describe("the live feed's words", () => {
  it("describes generations with where, how long and what they cost", () => {
    expect(
      describeEvent(
        event("diagram.started", {
          city: "Paris",
          region: "IDF",
          country: "FR",
          ownKey: true,
        }),
      ),
    ).toMatchObject({
      title: "Diagram started",
      detail: "🇫🇷 Paris, IDF, FR · own key",
    });
    expect(
      describeEvent(
        event("diagram.finished", {
          outcome: "complete",
          ms: 12_345,
          costUsd: 0.0123,
        }),
      ),
    ).toMatchObject({ title: "Diagram made", detail: "12.3s · $0.012" });
    expect(
      describeEvent(
        event("render.finished", { outcome: "error", format: "vertical" }),
      ),
    ).toMatchObject({ title: "MP4 failed", detail: "vertical" });
  });

  it("says why a video was held back", () => {
    expect(
      describeEvent(event("video.gated", { reason: "person", step: "start" }))
        .detail,
    ).toBe("They already made today's video · after pressing Make the video");
  });

  it("reports a reset as how many had been used today", () => {
    expect(
      describeEvent(event("limits.reset", { target: "renders", cleared: 4 }))
        .detail,
    ).toBe("Today's MP4s started over. 4 were used today before the reset.");
  });

  it("falls back to the kind for events it does not know", () => {
    expect(describeEvent(event("new.kind", { note: "hi" }))).toEqual({
      title: "new.kind",
      tone: "",
      detail: "hi",
    });
  });

  it("re-reads counters only for events that move them", () => {
    expect(movesCounters("video.finished")).toBe(true);
    expect(movesCounters("diagram.finished")).toBe(true);
    expect(movesCounters("limits.reset")).toBe(true);
    expect(movesCounters("diagram.started")).toBe(false);
    expect(movesCounters("admin.signed_in")).toBe(false);
  });
});

describe("formatting", () => {
  it("counts time since", () => {
    expect(since(0, 42_000)).toBe("42s");
    expect(since(0, 303_000)).toBe("5m 3s");
    expect(since(0, 8_040_000)).toBe("2h 14m");
    expect(since(10_000, 0)).toBe("0s");
  });

  it("tallies the largest first and folds the rest into Other", () => {
    expect(tally(["a", "b", "a", "c", "a", "b"], (x) => x, 2)).toEqual([
      ["a", 3],
      ["b", 2],
      ["Other", 1],
    ]);
  });
});
