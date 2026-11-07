export interface ParsedGitHubRepo {
  username: string;
  repo: string;
  branch?: string;
}

const GITHUB_URL_WITH_TREE_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/tree\/(.+)$/i;
// Accepts any page under the repository (blob/issues/pulls/...) plus
// query strings and fragments, so pasted deep links resolve to the repo.
const GITHUB_URL_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)(?:[/?#].*)?$/i;
const GITHUB_SSH_PATTERN =
  /^(?:ssh:\/\/)?git@github\.com[:/]([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/?$/i;
const GITHUB_REPO_SHORTHAND_PATTERN = /^([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)$/;
const GITHUB_REPO_TREE_SHORTHAND_PATTERN =
  /^([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/tree\/(.+)$/;
const GITHUB_REPO_AT_SHORTHAND_PATTERN =
  /^([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)@([^?#]+)$/;

const GIT_SUFFIX = ".git";

function stripGitSuffix(repo: string): string {
  if (repo.endsWith(GIT_SUFFIX) && repo.length > GIT_SUFFIX.length) {
    return repo.slice(0, -GIT_SUFFIX.length);
  }

  return repo;
}

function cleanBranch(branch: string): string | undefined {
  const cleaned = branch.replace(/\/+$/, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function matchRepoSegments(
  input: string,
): [string, string, string | undefined] | null {
  const trimmed = input.trim();

  const atShorthandMatch = GITHUB_REPO_AT_SHORTHAND_PATTERN.exec(trimmed);
  if (atShorthandMatch?.[1] && atShorthandMatch[2] && atShorthandMatch[3]) {
    return [
      atShorthandMatch[1],
      atShorthandMatch[2],
      cleanBranch(atShorthandMatch[3]),
    ];
  }

  const treeShorthandMatch = GITHUB_REPO_TREE_SHORTHAND_PATTERN.exec(trimmed);
  if (
    treeShorthandMatch?.[1] &&
    treeShorthandMatch[2] &&
    treeShorthandMatch[3]
  ) {
    return [
      treeShorthandMatch[1],
      treeShorthandMatch[2],
      cleanBranch(treeShorthandMatch[3]),
    ];
  }

  const shorthandMatch = GITHUB_REPO_SHORTHAND_PATTERN.exec(trimmed);
  if (shorthandMatch?.[1] && shorthandMatch[2]) {
    return [shorthandMatch[1], shorthandMatch[2], undefined];
  }

  const urlWithoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const treeUrlMatch = GITHUB_URL_WITH_TREE_PATTERN.exec(urlWithoutQuery);
  if (treeUrlMatch?.[1] && treeUrlMatch[2] && treeUrlMatch[3]) {
    return [treeUrlMatch[1], treeUrlMatch[2], cleanBranch(treeUrlMatch[3])];
  }

  const httpsMatch = GITHUB_URL_PATTERN.exec(trimmed);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return [httpsMatch[1], httpsMatch[2], undefined];
  }

  const sshMatch = GITHUB_SSH_PATTERN.exec(trimmed);
  if (sshMatch?.[1] && sshMatch[2]) {
    return [sshMatch[1], sshMatch[2], undefined];
  }

  return null;
}

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepo | null {
  const segments = matchRepoSegments(url);
  if (!segments) return null;

  const [username, repo, branch] = segments;
  return {
    username,
    repo: stripGitSuffix(repo),
    ...(branch ? { branch } : {}),
  };
}
