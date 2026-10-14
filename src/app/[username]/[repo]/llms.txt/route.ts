import { repositoryMarkdownResponse } from "~/server/repository-markdown";

// The repository page as Markdown, for agents. src/proxy.ts rewrites
// /{owner}/{repo}.md and `Accept: text/markdown` requests for the page here
// (or to ./[sponsor] while a sponsor has the Markdown placement).

// Keep equal to REPOSITORY_MARKDOWN_REVALIDATE (Next reads a literal).
export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string; repo: string }> },
) {
  return repositoryMarkdownResponse(await params);
}
