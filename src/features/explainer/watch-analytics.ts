import type { VideoArtifact } from "./types";
import { captureAnalyticsEvent } from "~/lib/analytics-client";

type Properties = Record<string, boolean | number | string | null>;

// Shares of the film actually played. 100 allows for the last frame or two a
// loop can miss before the end.
const MILESTONES = [25, 50, 75, 100] as const;
const COMPLETE_SHARE = 0.97;
// A bigger step between two frames is left out: a seek racing a restart, or
// a background tab. That can only undercount, never inflate, what was watched.
const MAX_STEP_SECONDS = 1;

/** What every video event carries, so films and prompt versions compare. */
function videoProperties(artifact: VideoArtifact): Properties {
  return {
    video_repo: artifact.repository,
    video_created_at: artifact.createdAt,
    video_model: artifact.stats.model,
    video_duration: Math.round(artifact.timing.DURATION),
  };
}

/** Reports a video event; never throws into the player it is called from. */
export function captureVideoEvent(
  name: string,
  artifact: VideoArtifact,
  extra?: Properties,
) {
  try {
    captureAnalyticsEvent(name, { ...videoProperties(artifact), ...extra });
  } catch (error) {
    console.error("Video analytics failed", error);
  }
}

/**
 * Counts the seconds of a film actually played and reports the first play and
 * each share watched, once per player load. A seek calls `pause` first (then
 * `play` from the new time), so the jump is not counted.
 */
export class WatchTracker {
  private watched = 0;
  private last: number | null = null;
  private started = false;
  private reached = 0;

  constructor(
    private readonly duration: number,
    private readonly report: (event: string, extra?: Properties) => void,
  ) {}

  /** Playback started (or resumed) at `time`. */
  play(time: number) {
    this.last = time;
    if (this.started) return;
    this.started = true;
    this.report("video_started");
  }

  /** Playback stopped; the next frame is not a continuation. */
  pause() {
    this.last = null;
  }

  /** A playing frame at `time` on the film's clock. */
  frame(time: number) {
    if (this.last !== null) {
      const step = time - this.last;
      if (step > 0 && step <= MAX_STEP_SECONDS) this.watched += step;
    }
    this.last = time;
    const share = this.duration > 0 ? this.watched / this.duration : 0;
    for (const milestone of MILESTONES) {
      if (milestone <= this.reached) continue;
      const needed = milestone === 100 ? COMPLETE_SHARE : milestone / 100;
      if (share < needed) break;
      this.reached = milestone;
      this.report("video_progress", { percent: milestone });
    }
  }
}
