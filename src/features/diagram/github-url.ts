export interface ParsedGitHubRepo {
  username: string;
  repo: string;
}

const GITHUB_URL_PATTERN =
  /^https?:\/\/github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/?$/;

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepo | null {
  const match = GITHUB_URL_PATTERN.exec(url.trim());
  if (!match) return null;

  const [, username, repo] = match;
  if (!username || !repo) return null;

  return { username, repo };
}
