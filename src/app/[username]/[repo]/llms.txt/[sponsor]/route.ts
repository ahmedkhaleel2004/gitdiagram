import { repositoryMarkdownResponse } from "~/server/repository-markdown";

// The repository page as Markdown with one sponsor's line: where the proxy
// sends a Markdown request while that campaign has the placement, so each
// sponsor's copy is cached on its own. Any other ID is a 404.

// Keep equal to REPOSITORY_MARKDOWN_REVALIDATE (Next reads a literal).
export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ username: string; repo: string; sponsor: string }> },
) {
  const { username, repo, sponsor } = await params;
  return repositoryMarkdownResponse({ username, repo, sponsorId: sponsor });
}
