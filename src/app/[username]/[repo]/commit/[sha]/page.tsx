import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { parseCommitSha, shortCommitSha } from "~/features/diagram/commit";
import { isPlaceholderRepo } from "~/lib/placeholder-repo";
import { SITE_URL } from "~/lib/site";
import { readPublicDiagramState } from "~/server/storage/public-diagram-state";
import {
  getCommitPagePath,
  getRepoPagePath,
} from "~/server/storage/repo-page-cache";
import {
  PlaceholderRepo,
  placeholderRepoMetadata,
} from "../../placeholder-repo";
import RepoPageClient from "../../repo-page-client";

type CommitPageProps = {
  params: Promise<{ username: string; repo: string; sha: string }>;
};

// /{owner}/{repo}/commit/{sha} mirrors github.com/{owner}/{repo}/commit/{sha}
// and shows the diagram of that commit. A full SHA names one tree forever, so
// its stored diagram never changes; a generation still invalidates the page on
// demand (generation-persistence.ts), this interval is only the fallback.
// Matches PUBLIC_DIAGRAM_STATE_REVALIDATE_SECONDS (public-diagram-state.ts).
export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: CommitPageProps): Promise<Metadata> {
  const { username, repo, sha } = await params;
  if (isPlaceholderRepo(username, repo)) return placeholderRepoMetadata;
  const commitPath = getCommitPagePath(username, repo, sha);
  const shortSha = shortCommitSha(sha.toLowerCase());
  const title = `${username}/${repo} @ ${shortSha} architecture diagram | GitDiagram`;
  const description = `Interactive architecture diagram of ${username}/${repo} at commit ${shortSha}: its main components, how they connect, and links to the source at that commit on GitHub.`;
  const image = {
    url: `${SITE_URL}${getRepoPagePath(username, repo)}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: `${username}/${repo} architecture diagram`,
  };

  return {
    title,
    description,
    alternates: { canonical: commitPath },
    // One page per commit would be endless near-duplicates of the
    // repository's own page, which is the one worth indexing.
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${commitPath}`,
      siteName: "GitDiagram",
      type: "article",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: "@ahmedkhaleel2004",
      images: [image],
    },
  };
}

export default async function CommitRepo({ params }: CommitPageProps) {
  const { username, repo, sha } = await params;
  if (
    username !== username.toLowerCase() ||
    repo !== repo.toLowerCase() ||
    sha !== sha.toLowerCase()
  ) {
    permanentRedirect(getCommitPagePath(username, repo, sha));
  }
  // A copied example address (/user/repo/commit/sha): explain it, read nothing.
  if (isPlaceholderRepo(username, repo)) {
    return <PlaceholderRepo username={username} repo={repo} />;
  }
  // Only a full SHA is a storage key. A short SHA (resolved through GitHub by
  // /api/diagram-state) or a malformed one (answered with its own error there)
  // is left to the client: rendering a cached page must never wait on GitHub.
  const commit = parseCommitSha(sha);
  const { state } = commit?.full
    ? await readPublicDiagramState(username, repo, commit.sha)
    : { state: null };

  return (
    <RepoPageClient
      key={`${username}/${repo}/${sha}`}
      username={username}
      repo={repo}
      commit={commit?.sha ?? sha}
      initialState={state}
      initialStateIsAuthoritative={Boolean(state)}
    />
  );
}
