import { useCallback, useSyncExternalStore } from "react";
import { streamExplainerVideo, VideoRequestError } from "./api";
import { lookUpStoredVideo, rememberStoredVideo } from "./stored-video";
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
  /** The server is (or may still be) at work on it; watch for the result. */
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
// How many mounted components show each repository's run.
const watchers = new Map<string, number>();

const runKey = (username: string, repo: string) =>
  `${username}/${repo}`.toLowerCase();

const DROPPED = "The connection dropped before the video was finished.";

/** A finished run: it holds a whole artifact (or an error) and nothing more happens to it. */
function isSettled(run: VideoRun | undefined) {
  return run?.kind === "ready" || run?.kind === "error";
}

function update(key: string, run: VideoRun | undefined) {
  // A run that finishes while nothing shows it is not kept: its video is
  // stored, and the next panel to open looks it up.
  if (isSettled(run) && !watchers.get(key)) run = undefined;
  if (run) runs.set(key, run);
  else if (!runs.delete(key)) return;
  for (const listener of listeners) listener();
}

function watch(key: string, listener: () => void) {
  listeners.add(listener);
  watchers.set(key, (watchers.get(key) ?? 0) + 1);
  return () => {
    listeners.delete(listener);
    const left = (watchers.get(key) ?? 1) - 1;
    if (left > 0) {
      watchers.set(key, left);
      return;
    }
    watchers.delete(key);
    // Checked once React is done re-subscribing (a key change, Strict Mode).
    queueMicrotask(() => {
      if (!watchers.get(key) && isSettled(runs.get(key))) runs.delete(key);
    });
  };
}

/** This tab's latest run for a repository, if any. */
export function useVideoRun(username: string, repo: string) {
  const key = runKey(username, repo);
  const subscribe = useCallback(
    (listener: () => void) => watch(key, listener),
    [key],
  );
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
  update(runKey(username, repo), undefined);
}

/** Forget a finished run once nothing shows it; a live one keeps going. */
export function releaseVideoRun(username: string, repo: string) {
  if (isSettled(runs.get(runKey(username, repo))))
    clearVideoRun(username, repo);
}

// Refusals that trying again cannot fix today: early access (403), the daily
// budget (429), paused or unavailable (503), videos turned off (404).
const DEAD_ENDS = new Set([403, 404, 429, 503]);

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
  const ready = (video: VideoArtifact) => {
    rememberStoredVideo(username, repo, video);
    update(key, { kind: "ready", video });
  };

  /**
   * Ask the server what it has once this tab lost sight of the run. `taken`
   * means it refused because the video exists or is being made, so any
   * stored video (even `previous`) is the answer.
   */
  const recover = async (taken: boolean, otherwise: () => void) => {
    try {
      const state = await lookUpStoredVideo(username, repo);
      if (
        state.video &&
        (taken || state.video.createdAt !== previous?.createdAt)
      )
        ready(state.video);
      else if (state.generating) update(key, { kind: "waiting" });
      else otherwise();
    } catch {
      // Still offline: watch for the result (the panel polls until it lands).
      update(key, { kind: "waiting" });
    }
  };

  update(key, { kind: "generating", stage: "reading", startedAt, progress });
  streamExplainerVideo(username, repo, (event) => {
    if (event.status === "complete") ready(event.artifact);
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
    if (error instanceof VideoRequestError) {
      // Turned down before any work started.
      if (error.status === 409) {
        // Another run holds this repository, or its video already exists.
        if (error.reason === "generating") update(key, { kind: "waiting" });
        else await recover(true, () => fail(error.message));
      } else fail(error.message, !DEAD_ENDS.has(error.status));
      return;
    }
    // The stream closed before the result, or the connection dropped (fetch
    // and body reads throw a TypeError). The server keeps working on a run it
    // has started, and may have saved the video anyway: ask what it has.
    await recover(false, () => fail(DROPPED));
  });
}
