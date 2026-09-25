import { useEffect, useSyncExternalStore } from "react";
import { fetchExplainerVideo, type ExplainerVideoState } from "./api";
import type { VideoArtifact } from "./types";

/**
 * Lookups of a repository's stored video, shared by everything on the page
 * that asks (the Video panel, its polling, the Info panel's model line), so
 * lookups made at the same time are one request. Only the model each video
 * was made with is kept: the artifact itself stays with whoever shows it.
 */
const models = new Map<string, string | null>();
const pending = new Map<string, Promise<ExplainerVideoState>>();
const listeners = new Set<() => void>();

const videoKey = (username: string, repo: string) =>
  `${username}/${repo}`.toLowerCase();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Note the video a repository has now (a lookup found it, or a run made it). */
export function rememberStoredVideo(
  username: string,
  repo: string,
  video: VideoArtifact | null,
) {
  const key = videoKey(username, repo);
  const model = video?.stats.model || null;
  if (models.get(key) === model) return;
  models.set(key, model);
  for (const listener of listeners) listener();
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

/**
 * What the server has for a repository now. A lookup already under way is
 * joined rather than repeated; `signal` only stops this caller waiting.
 */
export function lookUpStoredVideo(
  username: string,
  repo: string,
  signal?: AbortSignal,
): Promise<ExplainerVideoState> {
  const key = videoKey(username, repo);
  let lookup = pending.get(key);
  if (!lookup) {
    lookup = fetchExplainerVideo(username, repo)
      .then((state) => {
        rememberStoredVideo(username, repo, state.video);
        return state;
      })
      .finally(() => pending.delete(key));
    pending.set(key, lookup);
  }
  return abortable(lookup, signal);
}

/**
 * The model a repository's stored video was made with: `null` when it has
 * none, `undefined` until known. "No video" is looked up again on each mount,
 * since one may have been made since.
 */
export function useStoredVideoModel(
  username: string,
  repo: string,
): string | null | undefined {
  const key = videoKey(username, repo);
  const model = useSyncExternalStore(
    subscribe,
    () => models.get(key),
    () => undefined,
  );
  useEffect(() => {
    if (models.get(key)) return;
    // A failed lookup leaves the line out; the next mount asks again.
    lookUpStoredVideo(username, repo).catch(() => undefined);
  }, [key, username, repo]);
  return model;
}
