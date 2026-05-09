import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import type { DiagramStateResponse } from "~/features/diagram/types";
import { getStoredDiagramState } from "~/server/storage/artifact-store";
import RepoPageClient from "./repo-page-client";

type RepoPageProps = {
  params: Promise<{ username: string; repo: string }>;
};

export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

const getCachedPublicDiagramState = unstable_cache(
  async (username: string, repo: string) =>
    getStoredDiagramState({
      username,
      repo,
    }),
  ["public-diagram-state"],
  {
    revalidate,
  },
);

export async function generateMetadata({
  params,
}: RepoPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  const title = `${username}/${repo} Diagram | GitDiagram`;
  const description = `Interactive architecture diagram for ${username}/${repo}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/${username}/${repo}`,
    },
    openGraph: {
      title,
      description,
      url: `https://gitdiagram.com/${username}/${repo}`,
      siteName: "GitDiagram",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: "@ahmedkhaleel2004",
    },
  };
}

export default async function Repo({ params }: RepoPageProps) {
  const { username, repo } = await params;
  const initialState = (await getCachedPublicDiagramState(
    username,
    repo,
  )) as DiagramStateResponse | null;

  return (
    <RepoPageClient
      username={username}
      repo={repo}
      initialState={initialState?.diagram ? initialState : null}
    />
  );
}
