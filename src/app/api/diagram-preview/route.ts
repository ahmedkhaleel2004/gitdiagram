import { type NextRequest, NextResponse } from "next/server";

import { getPublicDiagramPreview } from "~/server/storage/artifact-store";

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")?.trim();
  const repo = request.nextUrl.searchParams.get("repo")?.trim();

  if (!username || !repo) {
    return NextResponse.json(
      { error: "Missing username or repo." },
      { status: 400 },
    );
  }

  const preview = await getPublicDiagramPreview({ username, repo });
  if (!preview?.diagram) {
    return NextResponse.json(
      { error: "Preview unavailable." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { diagram: preview.diagram, lastSuccessfulAt: preview.lastSuccessfulAt },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
