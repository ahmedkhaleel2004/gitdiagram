import { notFound, permanentRedirect } from "next/navigation";

import { isFullCommitSha } from "~/features/diagram/commit";
import { createRepoSocialImage } from "~/server/og/cards";
import { createDiagramPicture } from "~/server/og/diagram-picture";
import { getDiagramPictureData } from "~/server/og/diagram-picture-data";
import { getCommitPagePath } from "~/server/storage/repo-page-cache";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 86400;

/**
 * The README picture of one commit's diagram. Only a full SHA names a stored
 * diagram; a new generation of the commit revalidates this path.
 */
export async function GET(
  _request: Request,
  context: {
    params: Promise<{ username: string; repo: string; sha: string }>;
  },
) {
  const { username, repo, sha } = await context.params;
  if (
    username !== username.toLowerCase() ||
    repo !== repo.toLowerCase() ||
    sha !== sha.toLowerCase()
  ) {
    permanentRedirect(`${getCommitPagePath(username, repo, sha)}/diagram.png`);
  }
  if (!isFullCommitSha(sha)) notFound();

  const data = await getDiagramPictureData(username, repo, sha);
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
