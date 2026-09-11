import "server-only";

import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { getStoredDiagramArtifact } from "~/server/storage/artifact-store";

export type RepoSocialMetadata = {
  defaultBranch: string | null;
  isPrivate: boolean | null;
  language: string | null;
  stargazerCount: number | null;
};

export async function getRepoSocialMetadata(
  username: string,
  repo: string,
): Promise<RepoSocialMetadata | null> {
  const parsedUsername = githubUsernameSchema.safeParse(username);
  const parsedRepo = githubRepoSchema.safeParse(repo);
  if (!parsedUsername.success || !parsedRepo.success) {
    return null;
  }

  try {
    const stored = await getStoredDiagramArtifact({
      username: parsedUsername.data,
      repo: parsedRepo.data,
    });
    if (!stored || stored.artifact.visibility !== "public") {
      return null;
    }

    return {
      defaultBranch: null,
      isPrivate: false,
      language: null,
      stargazerCount: stored.artifact.stargazerCount,
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "og.repo_metadata.fetch_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );

    return null;
  }
}
