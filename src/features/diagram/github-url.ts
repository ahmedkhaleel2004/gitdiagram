export interface ParsedGitHubRepo {
  username: string;
  repo: string;
}

const GITHUB_URL_PATTERN =
  /^https?:\/\/github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/?$/i;
const GITHUB_REPO_SHORTHAND_PATTERN = /^([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)$/;

const GIT_SUFFIX = ".git";

function stripGitSuffix(repo: string): string {
  if (repo.endsWith(GIT_SUFFIX) && repo.length > GIT_SUFFIX.length) {
    return repo.slice(0, -GIT_SUFFIX.length);
  }

  return repo;
}

function normalizeGitHubRepoUrl(input: string): string {
  const trimmedInput = input.trim();

  if (GITHUB_REPO_SHORTHAND_PATTERN.test(trimmedInput)) {
    return `https://github.com/${trimmedInput}`;
  }

  return trimmedInput;
}

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepo | null {
  const match = GITHUB_URL_PATTERN.exec(normalizeGitHubRepoUrl(url));
  if (!match) return null;

  const [, username, repo] = match;
  if (!username || !repo) return null;

  return { username, repo: stripGitSuffix(repo) };
}
