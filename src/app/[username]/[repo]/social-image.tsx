import { notFound } from "next/navigation";

import { createRepoSocialImage } from "~/server/og/cards";
import { getRepoSocialMetadata } from "~/server/og/repo-metadata";

type RepoImageProps = {
  params: Promise<{ username: string; repo: string }>;
};

export async function renderRepoSocialImage({ params }: RepoImageProps) {
  const { username, repo } = await params;
  const metadata = await getRepoSocialMetadata(username, repo);
  if (!metadata) {
    notFound();
  }

  return createRepoSocialImage({
    username,
    repo,
    defaultBranch: metadata.defaultBranch,
    language: metadata.language,
    stargazerCount: metadata.stargazerCount,
    isPrivate: metadata.isPrivate,
  });
}
