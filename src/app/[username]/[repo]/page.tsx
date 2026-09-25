import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { permanentRedirect } from "next/navigation";
import { SITE_URL } from "~/lib/site";
import { errorText, logEvent } from "~/server/log";
import { getStoredDiagramState } from "~/server/storage/artifact-store";
import {
  getPublicDiagramStateCacheTag,
  getRepoPagePath,
} from "~/server/storage/repo-page-cache";
import RepoPageClient from "./repo-page-client";

type RepoPageProps = {
  params: Promise<{ username: string; repo: string }>;
};

// Successful generations invalidate the page and data tag on demand. Keep
// unchanged diagrams warm; this interval is only the fallback refresh.
export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

async function getCachedPublicDiagramState(username: string, repo: string) {
  const getCachedState = unstable_cache(
    async () =>
      getStoredDiagramState({
        username,
        repo,
      }),
    ["public-diagram-state", username.toLowerCase(), repo.toLowerCase()],
    {
      revalidate,
      tags: [getPublicDiagramStateCacheTag(username, repo)],
    },
  );

  return getCachedState();
}

// How long a page rendered after a failed storage read stays cached.
const STORAGE_FAILURE_REVALIDATE_SECONDS = 60;

// A route's ISR lifetime is the shortest revalidate used while rendering it,
// so reading this short-lived entry caches the page for a minute, not 6 h.
// Rethrowing instead would keep the last good page on a revalidation, but on
// a first render (nothing cached yet) Next answers 500, error.tsx or not; and
// connection()/unstable_noStore() fail an ISR render the same way ("Page
// changed from static to dynamic at runtime"). A failed read during a
// time-based revalidation never gets here: unstable_cache then serves its
// stale entry. It does after an on-demand revalidation, which expires it.
const shortenPageLifetime = unstable_cache(
  async () => true,
  ["repo-page-storage-failure"],
  { revalidate: STORAGE_FAILURE_REVALIDATE_SECONDS },
);

export async function generateMetadata({
  params,
}: RepoPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  const repositoryPath = getRepoPagePath(username, repo);
  const image = {
    url: `${SITE_URL}${repositoryPath}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: "GitDiagram repository preview",
  };
  const title = `${username}/${repo} Diagram | GitDiagram`;
  const description = `Interactive architecture diagram for ${username}/${repo}.`;

  return {
    title,
    description,
    alternates: {
      canonical: repositoryPath,
    },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${repositoryPath}`,
      siteName: "GitDiagram",
      type: "website",
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

export default async function Repo({ params }: RepoPageProps) {
  const { username, repo } = await params;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase()) {
    permanentRedirect(getRepoPagePath(username, repo));
  }
  // A slow or failing R2 must not turn the page into a 500: without a stored
  // state the client loads the diagram itself, as it does for a new repo.
  // Caught outside the cache, so a failed read is never cached as "none",
  // and the page without it is only cached briefly.
  const initialState = await getCachedPublicDiagramState(username, repo).catch(
    async (error: unknown) => {
      logEvent("error", "repo_page.stored_state_failed", {
        repository: `${username}/${repo}`,
        error: errorText(error),
      });
      await shortenPageLifetime().catch(() => undefined);
      return null;
    },
  );

  return (
    <RepoPageClient
      key={`${username.toLowerCase()}/${repo.toLowerCase()}`}
      username={username}
      repo={repo}
      initialState={initialState?.diagram ? initialState : null}
      initialStateIsAuthoritative={Boolean(initialState?.diagram)}
    />
  );
}
