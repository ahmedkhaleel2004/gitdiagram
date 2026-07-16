import { after, type NextRequest, NextResponse } from "next/server";

import {
  getPublicDiagramPreview,
  writePublicDiagramPreview,
} from "~/server/storage/artifact-store";

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")?.trim();
  const repo = request.nextUrl.searchParams.get("repo")?.trim();
  const expectedLastSuccessfulAt = request.nextUrl.searchParams
    .get("lastSuccessfulAt")
    ?.trim();

  if (!username || !repo) {
    return NextResponse.json(
      { error: "Missing username or repo." },
      { status: 400 },
    );
  }

  const preview = await getPublicDiagramPreview({
    username,
    repo,
    expectedLastSuccessfulAt,
  });
  if (!preview?.diagram) {
    return NextResponse.json(
      { error: "Preview unavailable." },
      { status: 404 },
    );
  }

  if (
    preview.source === "artifact" &&
    expectedLastSuccessfulAt === preview.lastSuccessfulAt
  ) {
    after(async () => {
      try {
        await writePublicDiagramPreview({
          username,
          repo,
          diagram: preview.diagram,
          lastSuccessfulAt: preview.lastSuccessfulAt,
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
    { diagram: preview.diagram, lastSuccessfulAt: preview.lastSuccessfulAt },
    {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
