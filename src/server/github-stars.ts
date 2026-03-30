import "server-only";

import { getGitHubApiHeaders } from "./github-auth";

interface GitHubRepoResponse {
  stargazers_count: number;
}

const GITHUB_REPO_URL =
  "https://api.github.com/repos/ahmedkhaleel2004/gitdiagram";
const STAR_COUNT_REVALIDATE_SECONDS = 60 * 30;

export async function getStarCount() {
  try {
    const response = await fetch(GITHUB_REPO_URL, {
      cache: "force-cache",
      headers: await getGitHubApiHeaders({ allowGitHubAppAuth: false }),
      next: {
        revalidate: STAR_COUNT_REVALIDATE_SECONDS,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch star count (${response.status})`);
    }

    const data = (await response.json()) as GitHubRepoResponse;
    return data.stargazers_count;
  } catch (error) {
    console.error("Error fetching GitHub star count:", error);
    return null;
  }
}
