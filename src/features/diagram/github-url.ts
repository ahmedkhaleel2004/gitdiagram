export interface ParsedGitHubRepo {
  username: string;
  repo: string;
}

// Accepts any page under the repository (tree/blob/issues/pulls/...) plus
// query strings and fragments, so pasted deep links resolve to the repo.
const GITHUB_URL_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)(?:[/?#].*)?$/i;
const GITHUB_SSH_PATTERN =
  /^(?:ssh:\/\/)?git@github\.com[:/]([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/?$/i;
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

function matchRepoSegments(input: string): [string, string] | null {
  const httpsMatch = GITHUB_URL_PATTERN.exec(input);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return [httpsMatch[1], httpsMatch[2]];
  }

  const sshMatch = GITHUB_SSH_PATTERN.exec(input);
  if (sshMatch?.[1] && sshMatch[2]) {
    return [sshMatch[1], sshMatch[2]];
  }

  return null;
}

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepo | null {
  const segments = matchRepoSegments(normalizeGitHubRepoUrl(url));
  if (!segments) return null;

  const [username, repo] = segments;
  return { username, repo: stripGitSuffix(repo) };
}
