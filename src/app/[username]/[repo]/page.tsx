import type { Metadata } from "next";
import type { DiagramStateResponse } from "~/features/diagram/types";
import { getStoredDiagramState } from "~/server/storage/artifact-store";
import RepoPageClient from "./repo-page-client";

type RepoPageProps = {
  params: Promise<{ username: string; repo: string }>;
};

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
  const initialState = (await getStoredDiagramState({
    username,
    repo,
  })) as DiagramStateResponse | null;

  return (
    <RepoPageClient
      username={username}
      repo={repo}
      initialState={initialState?.diagram ? initialState : null}
    />
  );
}
