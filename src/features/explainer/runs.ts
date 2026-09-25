import { useSyncExternalStore } from "react";
import {
  fetchExplainerVideo,
  streamExplainerVideo,
  VideoStreamEndedError,
} from "./api";
import type {
  VideoArtifact,
  VideoGenerationProgress,
  VideoGenerationStage,
} from "./types";

/**
 * A video generation this tab started, kept outside any component: the server
 * finishes a run it has begun whatever the page does, so closing the video
 * panel (or the toolbar hiding it) must not drop the stream. Reopening the
 * panel picks the run up where it is.
 */
export type VideoRun =
  | {
      kind: "generating";
      stage: VideoGenerationStage;
      startedAt: number;
      progress: VideoGenerationProgress;
    }
  /** The stream dropped while the server was still at work; watch for the result. */
  | { kind: "waiting" }
  | { kind: "ready"; video: VideoArtifact }
  | {
      kind: "error";
      message: string;
      canGenerate: boolean;
      /** The stored video a failed regeneration left in place. */
      previous?: VideoArtifact;
    };

const runs = new Map<string, VideoRun>();
const listeners = new Set<() => void>();

const runKey = (username: string, repo: string) =>
  `${username}/${repo}`.toLowerCase();

function update(key: string, run: VideoRun | undefined) {
  if (run) runs.set(key, run);
  else runs.delete(key);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** This tab's latest run for a repository, if any. */
export function useVideoRun(username: string, repo: string) {
  const key = runKey(username, repo);
  return useSyncExternalStore(
    subscribe,
    () => runs.get(key),
    () => undefined,
  );
}

/** Whether a run for this repository is still streaming. */
function isVideoRunActive(username: string, repo: string) {
  return runs.get(runKey(username, repo))?.kind === "generating";
}

/** Forget this tab's run for a repository (a finished one, or one handed off). */
export function clearVideoRun(username: string, repo: string) {
  const key = runKey(username, repo);
  if (runs.has(key)) update(key, undefined);
}

/** Forget a finished run once nothing shows it; a live one keeps going. */
export function releaseVideoRun(username: string, repo: string) {
  const run = runs.get(runKey(username, repo));
  if (run && run.kind !== "generating" && run.kind !== "waiting")
    clearVideoRun(username, repo);
}

/**
 * Start making a repository's video. `previous` is the stored video a failed
 * regeneration should leave one click away.
 */
export function startVideoRun(
  username: string,
  repo: string,
  previous?: VideoArtifact,
) {
  const key = runKey(username, repo);
  if (isVideoRunActive(username, repo)) return;
  const startedAt = Date.now();
  let progress: VideoGenerationProgress = {};
  const fail = (message: string, canGenerate = true) =>
    update(key, { kind: "error", message, canGenerate, previous });
  update(key, { kind: "generating", stage: "reading", startedAt, progress });
  streamExplainerVideo(username, repo, (event) => {
    if (event.status === "complete")
      update(key, { kind: "ready", video: event.artifact });
    else if (event.status === "error")
      fail(event.error, event.retryable !== false);
    else {
      progress = { ...progress, ...event.progress };
      update(key, {
        kind: "generating",
        stage: event.status,
        startedAt,
        progress,
      });
    }
  }).catch(async (error: unknown) => {
    if (!(error instanceof VideoStreamEndedError)) {
      fail(error instanceof Error ? error.message : "Video generation failed.");
      return;
    }
    // The connection closed before the result arrived. The server may have
    // saved the video anyway, or still be making it: ask what it has.
    try {
      const state = await fetchExplainerVideo(username, repo);
      if (state.video && state.video.createdAt !== previous?.createdAt)
        update(key, { kind: "ready", video: state.video });
      else if (state.generating) update(key, { kind: "waiting" });
      else fail("The connection dropped before the video was finished.");
    } catch {
      fail("The connection dropped before the video was finished.");
    }
  });
}
