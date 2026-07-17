import "server-only";

import { getGitHubApiHeaders } from "~/server/github-auth";

type RepoMetadataResponse = {
  default_branch?: string;
  private?: boolean;
  stargazers_count?: number;
  language?: string | null;
};

export type RepoSocialMetadata = {
  defaultBranch: string | null;
  isPrivate: boolean | null;
  language: string | null;
  stargazerCount: number | null;
};

const REVALIDATE_SECONDS = 60 * 30;
const EMPTY_REPO_SOCIAL_METADATA: RepoSocialMetadata = {
  defaultBranch: null,
  isPrivate: null,
  language: null,
  stargazerCount: null,
};

export async function getRepoSocialMetadata(
  username: string,
  repo: string,
): Promise<RepoSocialMetadata> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`,
      {
        headers: await getGitHubApiHeaders(),
        next: {
          revalidate: REVALIDATE_SECONDS,
        },
      },
    );

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(
          JSON.stringify({
            event: "og.repo_metadata.fetch_failed",
            status: response.status,
          }),
        );
      }
      return EMPTY_REPO_SOCIAL_METADATA;
    }

    const data = (await response.json()) as RepoMetadataResponse;

    return {
      defaultBranch:
        typeof data.default_branch === "string" ? data.default_branch : null,
      isPrivate: typeof data.private === "boolean" ? data.private : null,
      language: typeof data.language === "string" ? data.language : null,
      stargazerCount:
        typeof data.stargazers_count === "number"
          ? data.stargazers_count
          : null,
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "og.repo_metadata.fetch_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );

    return EMPTY_REPO_SOCIAL_METADATA;
  }
}
