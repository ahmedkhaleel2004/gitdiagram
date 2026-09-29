import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { isPlaceholderRepo } from "~/lib/placeholder-repo";
import { JsonLd } from "~/components/json-ld";
import { RepositoryReadout } from "~/components/generation/repository-readout";
import { diagramReadout } from "~/features/diagram/readout";
import {
  repositoryJsonLd,
  repositoryMarkdownPath,
  repositoryPageDescription,
  repositoryPageTitle,
} from "~/features/seo/repository-page";
import { SITE_URL } from "~/lib/site";
import { readPublicDiagramState } from "~/server/storage/public-diagram-state";
import { getRepoPagePath } from "~/server/storage/repo-page-cache";
import { PlaceholderRepo, placeholderRepoMetadata } from "./placeholder-repo";
import RepoPageClient from "./repo-page-client";

type RepoPageProps = {
  params: Promise<{ username: string; repo: string }>;
};

// Successful generations invalidate the page and data tag on demand. Keep
// unchanged diagrams warm; this interval is only the fallback refresh.
// Matches PUBLIC_DIAGRAM_STATE_REVALIDATE_SECONDS (public-diagram-state.ts).
export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: RepoPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  if (isPlaceholderRepo(username, repo)) return placeholderRepoMetadata;
  const repositoryPath = getRepoPagePath(username, repo);
  // The same cached read the page makes (deduplicated per request).
  const { state, failed } = await readPublicDiagramState(username, repo);
  const readout = state ? diagramReadout(state, username, repo) : null;
  const image = {
    url: `${SITE_URL}${repositoryPath}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: `${username}/${repo} architecture diagram`,
  };
  const title = repositoryPageTitle(username, repo);
  const description = repositoryPageDescription(username, repo, readout);

  return {
    title,
    description,
    alternates: {
      canonical: repositoryPath,
      types: { "text/markdown": repositoryMarkdownPath(username, repo) },
    },
    // Nothing to read until a diagram is stored (a failed read says nothing,
    // so it never takes a page out of the index).
    ...(!state && !failed ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${repositoryPath}`,
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

export default async function Repo({ params }: RepoPageProps) {
  const { username, repo } = await params;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase()) {
    permanentRedirect(getRepoPagePath(username, repo));
  }
  // A copied example address (/user/repo): explain it, read nothing.
  if (isPlaceholderRepo(username, repo)) {
    return <PlaceholderRepo username={username} repo={repo} />;
  }
  // Without a stored state (none yet, or R2 failed) the client loads the
  // diagram itself, as it does for a new repo.
  const { state } = await readPublicDiagramState(username, repo);
  const readout = state ? diagramReadout(state, username, repo) : null;

  return (
    <>
      <JsonLd
        data={repositoryJsonLd({
          owner: username,
          repo,
          description: repositoryPageDescription(username, repo, readout),
          readout,
        })}
      />
      <RepoPageClient
        key={`${username.toLowerCase()}/${repo.toLowerCase()}`}
        username={username}
        repo={repo}
        initialState={state}
        initialStateIsAuthoritative={Boolean(state)}
        readout={
          readout ? (
            <RepositoryReadout
              repository={`${username}/${repo}`}
              readout={readout}
              markdownPath={repositoryMarkdownPath(username, repo)}
            />
          ) : undefined
        }
      />
    </>
  );
}
