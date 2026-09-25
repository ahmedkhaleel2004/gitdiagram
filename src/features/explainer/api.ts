import { readSSEStream } from "~/features/diagram/sse";
import { videoFileUrl, type VideoFileFormat } from "./file-url";
import type {
  VideoArtifact,
  VideoGenerationEvent,
  VideoRenderEvent,
} from "./types";

/** Why a visitor cannot start a video: early access, device, or today's budget. */
export type VideoPausedReason = "audience" | "device" | "limit";

export interface ExplainerVideoState {
  video: VideoArtifact | null;
  canGenerate: boolean;
  paused: VideoPausedReason | null;
  /** This visitor may make videos from any device, tablets included. */
  anyDevice: boolean;
  /** No video yet, but one is being made for this repo right now. */
  generating: boolean;
}

export type RenderFormat = "landscape" | "vertical";

/**
 * Why the server turned a video down, when it says: another run holds the
 * repository's lock, or the repository already has a video.
 */
export type VideoRequestReason = "generating" | "exists";

/** A video request the server turned down before any stream started. */
export class VideoRequestError extends Error {
  readonly status: number;
  /** The video was replaced after this page loaded it. */
  readonly stale: boolean;
  readonly reason: VideoRequestReason | null;

  constructor(
    message: string,
    status: number,
    stale = false,
    reason: VideoRequestReason | null = null,
  ) {
    super(message);
    this.name = "VideoRequestError";
    this.status = status;
    this.stale = stale;
    this.reason = reason;
  }
}

/** The stream closed before saying how the work ended; it may still have finished. */
export class VideoStreamEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoStreamEndedError";
  }
}

export async function fetchExplainerVideo(
  username: string,
  repo: string,
  signal?: AbortSignal,
): Promise<ExplainerVideoState> {
  const params = new URLSearchParams({ username, repo });
  const response = await fetch(`/api/video?${params.toString()}`, { signal });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    video?: VideoArtifact | null;
    canGenerate?: boolean;
    paused?: VideoPausedReason | null;
    anyDevice?: boolean;
    generating?: boolean;
    error?: string;
  };
  if (!response.ok || !body.ok)
    throw new Error(body.error ?? "Could not load the explainer video.");
  const video = body.video ?? null;
  return {
    video,
    canGenerate: Boolean(body.canGenerate),
    paused: body.paused ?? null,
    anyDevice: Boolean(body.anyDevice),
    generating: !video && body.generating === true,
  };
}

/**
 * POST a JSON body and relay each server-sent event from the response. A
 * stream must end with a `complete` or `error` event: one that closes without
 * either rejects with {@link VideoStreamEndedError}.
 */
async function streamEvents<T extends { status: string }>(
  url: string,
  payload: unknown,
  onEvent: (event: T) => void,
  fallbackError: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      stale?: boolean;
      reason?: string;
    };
    throw new VideoRequestError(
      body.error ?? fallbackError,
      response.status,
      body.stale === true,
      body.reason === "generating" || body.reason === "exists"
        ? body.reason
        : null,
    );
  }
  let finished = false;
  await readSSEStream<T>(response.body, (event) => {
    onEvent(event);
    finished = event.status === "complete" || event.status === "error";
    // Nothing follows the final event.
    return !finished;
  });
  if (!finished) throw new VideoStreamEndedError(fallbackError);
}

/** Start generation and relay each server-sent progress event. */
export function streamExplainerVideo(
  username: string,
  repo: string,
  onEvent: (event: VideoGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamEvents(
    "/api/video/generate",
    { username, repo },
    onEvent,
    "Could not start video generation.",
    signal,
  );
}

/**
 * Make (or reuse) the MP4 of the video on screen and relay render progress.
 * `version` is that video's `createdAt`; if the video has been replaced since,
 * the server refuses with a stale {@link VideoRequestError}.
 */
export function streamExplainerRender(
  username: string,
  repo: string,
  format: RenderFormat,
  version: string,
  onEvent: (event: VideoRenderEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamEvents(
    "/api/video/render",
    { username, repo, format, v: version },
    onEvent,
    "Could not make the MP4.",
    signal,
  );
}

/**
 * Where a stored render downloads from; the version pins the exact file.
 * `posterAt` (when the poster was made) stamps poster and still URLs.
 */
export function renderFileUrl(
  video: VideoArtifact,
  format: VideoFileFormat,
  posterAt?: number | null,
): string {
  return videoFileUrl(
    {
      owner: video.meta.owner,
      repo: video.meta.repo,
      createdAt: video.createdAt,
      posterAt,
    },
    format,
  );
}

/** The shareable watch page for a repository's video. */
export function watchPath(username: string, repo: string): string {
  return `/${username.toLowerCase()}/${repo.toLowerCase()}/video`;
}
