export interface ParsedGitHubRepo {
  username: string;
  repo: string;
  /**
   * The commit a pasted commit URL names, exactly as written (it is not
   * validated here; see `parseCommitSha`). Absent for every other input.
   */
  commit?: string;
}

// Accepts any page under the repository (tree/blob/issues/pulls/...) plus
// query strings and fragments, so pasted deep links resolve to the repo. The
// third group is whatever follows the repository name.
const GITHUB_URL_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)((?:[/?#].*)?)$/i;
// github.com/{owner}/{repo}/commit/{sha}, with an optional trailing path,
// query string or fragment.
const GITHUB_COMMIT_PATH_PATTERN = /^\/commit\/([^/?#]+)(?:[/?#].*)?$/i;
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

function matchRepoSegments(
  input: string,
): [string, string, string | undefined] | null {
  const httpsMatch = GITHUB_URL_PATTERN.exec(input);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    const commit = GITHUB_COMMIT_PATH_PATTERN.exec(httpsMatch[3] ?? "")?.[1];
    return [httpsMatch[1], httpsMatch[2], commit];
  }

  const sshMatch = GITHUB_SSH_PATTERN.exec(input);
  if (sshMatch?.[1] && sshMatch[2]) {
    return [sshMatch[1], sshMatch[2], undefined];
  }

  return null;
}

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepo | null {
  const segments = matchRepoSegments(normalizeGitHubRepoUrl(url));
  if (!segments) return null;

  const [username, repo, commit] = segments;
  return {
    username,
    repo: stripGitSuffix(repo),
    ...(commit ? { commit } : {}),
  };
}
