import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { isPlaceholderRepo } from "~/lib/placeholder-repo";
import { readPublicDiagramState } from "~/server/storage/public-diagram-state";
import { getRepoPagePath } from "~/server/storage/repo-page-cache";
import { PlaceholderRepo, placeholderRepoMetadata } from "../../placeholder-repo";
import RepoPageClient from "../../repo-page-client";
import { SITE_URL } from "~/lib/site";

type BranchPageProps = {
  params: Promise<{ username: string; repo: string; branch: string[] }>;
};

export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: BranchPageProps): Promise<Metadata> {
  const { username, repo, branch } = await params;
  const branchName = Array.isArray(branch) ? branch.join("/") : branch;
  if (isPlaceholderRepo(username, repo)) return placeholderRepoMetadata;
  const repositoryPath = getRepoPagePath(username, repo, branchName);
  const { state, failed } = await readPublicDiagramState(
    username,
    repo,
    branchName,
  );
  const image = {
    url: `${SITE_URL}${getRepoPagePath(username, repo)}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: `${username}/${repo} (${branchName}) architecture diagram`,
  };
  const title = `${username}/${repo} (${branchName}) Architecture Diagram | GitDiagram`;
  const description = `Interactive system architecture diagram for ${username}/${repo} on branch ${branchName}.`;

  return {
    title,
    description,
    alternates: {
      canonical: repositoryPath,
    },
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

export default async function BranchRepoPage({ params }: BranchPageProps) {
  const { username, repo, branch } = await params;
  const branchName = Array.isArray(branch) ? branch.join("/") : branch;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase()) {
    permanentRedirect(getRepoPagePath(username, repo, branchName));
  }
  if (isPlaceholderRepo(username, repo)) {
    return <PlaceholderRepo username={username} repo={repo} />;
  }

  const { state } = await readPublicDiagramState(username, repo, branchName);

  return (
    <RepoPageClient
      key={`${username.toLowerCase()}/${repo.toLowerCase()}/tree/${branchName}`}
      username={username}
      repo={repo}
      branch={branchName}
      initialState={state}
      initialStateIsAuthoritative={Boolean(state)}
    />
  );
}
