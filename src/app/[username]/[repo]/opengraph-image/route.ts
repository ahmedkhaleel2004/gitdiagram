import { permanentRedirect } from "next/navigation";
import { getRepoPagePath } from "~/server/storage/repo-page-cache";
import { renderRepoSocialImage } from "../social-image";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 86400;

export async function GET(
  _request: Request,
  context: { params: Promise<{ username: string; repo: string }> },
) {
  const { username, repo } = await context.params;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase()) {
    permanentRedirect(`${getRepoPagePath(username, repo)}/opengraph-image`);
  }

  return renderRepoSocialImage(context);
}
