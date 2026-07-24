import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getPublicDiagramPreview,
  writePublicDiagramPreview,
} from "~/server/storage/artifact-store";
import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";

// The value is only ever compared against a stored ISO timestamp, so anything
// longer than one cannot match and has no reason to reach storage.
const MAX_LAST_SUCCESSFUL_AT_LENGTH = 64;

const previewQuerySchema = z.object({
  username: githubUsernameSchema,
  repo: githubRepoSchema,
  lastSuccessfulAt: z
    .string()
    .trim()
    .max(MAX_LAST_SUCCESSFUL_AT_LENGTH)
    .optional(),
});

export async function GET(request: NextRequest) {
  const parsed = previewQuerySchema.safeParse({
    username: request.nextUrl.searchParams.get("username") ?? undefined,
    repo: request.nextUrl.searchParams.get("repo") ?? undefined,
    lastSuccessfulAt:
      request.nextUrl.searchParams.get("lastSuccessfulAt") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid username or repo." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const {
    username,
    repo,
    lastSuccessfulAt: expectedLastSuccessfulAt,
  } = parsed.data;

  let preview: Awaited<ReturnType<typeof getPublicDiagramPreview>>;
  try {
    preview = await getPublicDiagramPreview({
      username,
      repo,
      expectedLastSuccessfulAt,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "diagram_preview.read_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return NextResponse.json(
      { error: "Preview is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!preview?.diagram) {
    return NextResponse.json(
      { error: "Preview unavailable." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const servedPreview = preview;
  if (
    servedPreview.source === "artifact" &&
    expectedLastSuccessfulAt === servedPreview.lastSuccessfulAt
  ) {
    after(async () => {
      try {
        await writePublicDiagramPreview({
          username,
          repo,
          diagram: servedPreview.diagram,
          lastSuccessfulAt: servedPreview.lastSuccessfulAt,
        });
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "diagram_preview.sidecar_backfill_failed",
            username,
            repo,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      }
    });
  }

  return NextResponse.json(
    {
      diagram: servedPreview.diagram,
      lastSuccessfulAt: servedPreview.lastSuccessfulAt,
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
