import type { VideoArtifact, VideoGenerationEvent } from "./types";

export interface ExplainerVideoState {
  video: VideoArtifact | null;
  canGenerate: boolean;
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
    error?: string;
  };
  if (!response.ok || !body.ok)
    throw new Error(body.error ?? "Could not load the explainer video.");
  return { video: body.video ?? null, canGenerate: Boolean(body.canGenerate) };
}

/** Start generation and relay each server-sent progress event. */
export async function streamExplainerVideo(
  username: string,
  repo: string,
  onEvent: (event: VideoGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/video/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, repo }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Could not start video generation.");
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
        if (line.startsWith("data: "))
          onEvent(JSON.parse(line.slice(6)) as VideoGenerationEvent);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
