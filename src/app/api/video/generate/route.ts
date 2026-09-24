import { z } from "zod";

import { REPOSITORY_TOO_LARGE_ERROR } from "~/server/generate/github";
import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import {
  jsonErrorResponse,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";
import {
  canGenerateVideos,
  isVideoExplainerEnabled,
} from "~/server/explainer/config";
import { generateExplainerVideo } from "~/server/explainer/generate";
import { VideoInputError } from "~/server/explainer/repository";
import type { VideoGenerationEvent } from "~/features/explainer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.strictObject({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
});

function publicMessage(error: unknown): string {
  if (error instanceof VideoInputError) return error.message;
  if (error instanceof Error && error.message === REPOSITORY_TOO_LARGE_ERROR)
    return error.message;
  return "The explainer video could not be generated. Try again.";
}

export async function POST(request: Request): Promise<Response> {
  if (!isVideoExplainerEnabled())
    return jsonErrorResponse("Explainer videos are not enabled.", 404);
  const parsed = await parseSameOriginJsonRequest(request, {
    schema: requestSchema,
    maxBytes: 1024,
    crossOriginError: "Video generation must come from GitDiagram.",
  });
  if (!parsed.success) return parsed.response;
  if (!canGenerateVideos())
    return jsonErrorResponse(
      "Explainer videos need ANTHROPIC_API_KEY and ELEVENLABS_API_KEY on the server.",
      503,
    );
  const { username, repo } = parsed.data;
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: VideoGenerationEvent) =>
        write(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      // Generation is not tied to this connection: a finished video is cached,
      // so a viewer who leaves early still gets it on their next visit.
      generateExplainerVideo({ username, repo, onEvent: send })
        .then((artifact) => send({ status: "complete", artifact }))
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "video.generation_failed",
              repository: `${username}/${repo}`,
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "unknown",
            }),
          );
          send({ status: "error", error: publicMessage(error) });
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
