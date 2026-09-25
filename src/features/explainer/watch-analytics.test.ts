import { describe, expect, it, vi } from "vitest";

import { WatchTracker } from "./watch-analytics";

const track = (duration = 60) => {
  const report = vi.fn();
  return { tracker: new WatchTracker(duration, report), report };
};

/** Plays from `from` to `to` in 1/60 s frames. */
function playThrough(tracker: WatchTracker, from: number, to: number) {
  tracker.play(from);
  for (let time = from; time <= to; time += 1 / 60) tracker.frame(time);
  tracker.frame(to);
}

describe("WatchTracker", () => {
  it("reports the first play once and each share of the film watched", () => {
    const { tracker, report } = track();
    playThrough(tracker, 0, 20);
    tracker.pause();
    playThrough(tracker, 20, 60);
    expect(report.mock.calls).toEqual([
      ["video_started"],
      ["video_progress", { percent: 25 }],
      ["video_progress", { percent: 50 }],
      ["video_progress", { percent: 75 }],
      ["video_progress", { percent: 100 }],
    ]);
  });

  it("never counts a seek as watching", () => {
    const { tracker, report } = track();
    playThrough(tracker, 0, 5);
    // A seek pauses the count, then plays on from the new place.
    tracker.pause();
    playThrough(tracker, 55, 60);
    // A jump that races the restart is left out too.
    tracker.frame(30);
    tracker.frame(59);
    expect(report.mock.calls).toEqual([["video_started"]]);
  });

  it("counts a replay toward the same milestones only once", () => {
    const { tracker, report } = track(10);
    playThrough(tracker, 0, 10);
    tracker.pause();
    playThrough(tracker, 0, 10);
    expect(
      report.mock.calls.filter(([event]) => event === "video_progress"),
    ).toHaveLength(4);
  });
});
