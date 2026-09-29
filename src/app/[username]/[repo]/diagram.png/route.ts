import { notFound, permanentRedirect } from "next/navigation";

import { createRepoSocialImage } from "~/server/og/cards";
import { createDiagramPicture } from "~/server/og/diagram-picture";
import { getDiagramPictureData } from "~/server/og/diagram-picture-data";
import { getRepoPagePath } from "~/server/storage/repo-page-cache";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * The README picture of a repository's current diagram. A new diagram
 * revalidates this path (see generation-persistence.ts), so the one URL in a
 * README always shows the latest diagram.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ username: string; repo: string }> },
) {
  const { username, repo } = await context.params;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase()) {
    permanentRedirect(`${getRepoPagePath(username, repo)}/diagram.png`);
  }

  const data = await getDiagramPictureData(username, repo);
  if (!data) notFound();

  if (data.kind === "card") {
    return createRepoSocialImage({
      username,
      repo,
      defaultBranch: null,
      language: null,
      stargazerCount: data.stargazerCount,
      isPrivate: false,
    });
  }
  return createDiagramPicture({ username, repo, graph: data.graph });
}
