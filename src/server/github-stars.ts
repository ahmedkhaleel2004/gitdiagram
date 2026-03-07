import "server-only";

interface GitHubRepoResponse {
  stargazers_count: number;
}

const GITHUB_REPO_URL =
  "https://api.github.com/repos/ahmedkhaleel2004/gitdiagram";
const GITHUB_API_VERSION = "2022-11-28";
const STAR_COUNT_REVALIDATE_SECONDS = 60 * 30;

function createHeaders(): HeadersInit {
  const githubPat = process.env.GITHUB_PAT?.trim();

  if (!githubPat) {
    return {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    };
  }

  return {
    Authorization: `Bearer ${githubPat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

export async function getStarCount() {
  try {
    const response = await fetch(GITHUB_REPO_URL, {
      cache: "force-cache",
      headers: createHeaders(),
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
