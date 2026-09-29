import { unstable_cache } from "next/cache";
import { diagramReadout } from "~/features/diagram/readout";
import {
  missingDiagramMarkdown,
  repositoryMarkdown,
} from "~/features/diagram/markdown";
import { SITE_URL } from "~/lib/site";
import { videoSummaryTag } from "~/server/explainer/cache";
import { isVideoExplainerEnabled } from "~/server/explainer/config";
import { hasIndexedVideo } from "~/server/explainer/video-index";
import { readPublicDiagramState } from "~/server/storage/public-diagram-state";
import { getRepoPagePath } from "~/server/storage/repo-page-cache";

// The repository page as Markdown, for agents. src/proxy.ts rewrites
// /{owner}/{repo}.md and `Accept: text/markdown` requests for the page here.
// It reads the same cached public artifact as the page, so the page's tag
// (revalidated after every new diagram) refreshes this answer too; only
// public diagrams are ever read.

export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

const OWNER = /^[a-z0-9-]{1,39}$/i;
const REPO = /^(?!\.{1,2}$)[a-z0-9._-]{1,100}$/i;

/** Whether the repository has a video: one Redis read, refreshed with it. */
function hasVideo(owner: string, repo: string): Promise<boolean> {
  if (!isVideoExplainerEnabled()) return Promise.resolve(false);
  return unstable_cache(
    () => hasIndexedVideo(owner, repo),
    ["repository-markdown-video", owner, repo],
    { revalidate, tags: [videoSummaryTag(owner, repo)] },
  )().catch(() => false);
}

function markdownResponse(body: string, status: number, canonical: string) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The HTML page is the one to index; this is its plain-text twin.
      Link: `<${canonical}>; rel="canonical"`,
      // The page URL answers Markdown or HTML by the Accept header.
      Vary: "Accept",
      ...(status === 200 ? {} : { "X-Robots-Tag": "noindex" }),
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string; repo: string }> },
) {
  const { username, repo } = await params;
  if (!OWNER.test(username) || !REPO.test(repo)) {
    return new Response("Not a GitHub repository name.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const owner = username.toLowerCase();
  const name = repo.toLowerCase();
  const canonical = `${SITE_URL}${getRepoPagePath(owner, name)}`;
  if (owner !== username || name !== repo) {
    return Response.redirect(`${canonical}.md`, 308);
  }

  const [{ state, failed }, video] = await Promise.all([
    readPublicDiagramState(owner, name),
    hasVideo(owner, name),
  ]);
  if (failed) {
    // Cached for a minute at most (see readPublicDiagramState).
    return markdownResponse(
      `# ${owner}/${name} architecture\n\nGitDiagram could not read its stored diagram just now. Try again in a minute, or open ${canonical}.\n`,
      503,
      canonical,
    );
  }
  const readout = state ? diagramReadout(state, owner, name) : null;
  if (!state?.diagram || !readout) {
    return markdownResponse(
      missingDiagramMarkdown(owner, name),
      404,
      canonical,
    );
  }
  return markdownResponse(
    repositoryMarkdown({
      owner,
      repo: name,
      diagram: state.diagram,
      readout,
      videoUrl: video ? `${canonical}/video` : null,
    }),
    200,
    canonical,
  );
}
