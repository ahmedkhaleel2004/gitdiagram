import type {
  VideoArtifact,
  VideoGenerationEvent,
  VideoRenderEvent,
} from "./types";

export interface ExplainerVideoState {
  video: VideoArtifact | null;
  canGenerate: boolean;
  /** Why a visitor cannot start a video: early access, or today's budget. */
  paused: "audience" | "limit" | null;
}

export type RenderFormat = "landscape" | "vertical";

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
    paused?: "audience" | "limit" | null;
    error?: string;
  };
  if (!response.ok || !body.ok)
    throw new Error(body.error ?? "Could not load the explainer video.");
  return {
    video: body.video ?? null,
    canGenerate: Boolean(body.canGenerate),
    paused: body.paused ?? null,
  };
}

/** POST a JSON body and relay each server-sent event from the response. */
async function streamEvents<T>(
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
    };
    throw new Error(body.error ?? fallbackError);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)) as T);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
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

/** Make (or reuse) a video's MP4 and relay render progress. */
export function streamExplainerRender(
  username: string,
  repo: string,
  format: RenderFormat,
  onEvent: (event: VideoRenderEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamEvents(
    "/api/video/render",
    { username, repo, format },
    onEvent,
    "Could not make the MP4.",
    signal,
  );
}

/** Where a stored render downloads from; the version pins the exact file. */
export function renderFileUrl(
  video: VideoArtifact,
  format: RenderFormat | "poster" | "still",
): string {
  const params = new URLSearchParams({
    username: video.meta.owner,
    repo: video.meta.repo,
    format,
    v: video.createdAt,
  });
  return `/api/video/file?${params.toString()}`;
}

/** The shareable watch page for a repository's video. */
export function watchPath(username: string, repo: string): string {
  return `/${username.toLowerCase()}/${repo.toLowerCase()}/video`;
}
