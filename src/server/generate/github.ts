import { getGitHubApiHeaders } from "../github-auth";

interface GitHubRepoResponse {
  default_branch?: string;
  private?: boolean;
  stargazers_count?: number;
}

interface GitHubTreeItem {
  path?: unknown;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeItem[];
  truncated?: boolean;
}

interface GitHubReadmeResponse {
  content?: unknown;
  encoding?: unknown;
  size?: unknown;
}

export interface GithubData {
  defaultBranch: string;
  fileTree: string;
  readme: string;
  isPrivate: boolean;
  stargazerCount: number | null;
}

export const REPOSITORY_TOO_LARGE_ERROR =
  "Repository is too large (>195k tokens) for analysis. Try a smaller repo.";
export const MAX_INCLUDED_FILE_TREE_CHARACTERS = 780_000;
export const MAX_README_BYTES = 750_000;
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

const EXCLUDED_PATTERNS = [
  "node_modules/",
  "vendor/",
  "venv/",
  ".min.",
  ".pyc",
  ".pyo",
  ".pyd",
  ".so",
  ".dll",
  ".class",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".ico",
  ".svg",
  ".ttf",
  ".woff",
  ".webp",
  "__pycache__/",
  ".cache/",
  ".tmp/",
  "yarn.lock",
  "poetry.lock",
  "*.log",
  ".vscode/",
  ".idea/",
];

function shouldIncludeFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return !EXCLUDED_PATTERNS.some((pattern) => lowerPath.includes(pattern));
}

async function fetchJson<T>(
  url: string,
  headers: HeadersInit,
  notFoundMessage: string,
  signal?: AbortSignal,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
  } catch (error) {
    if (timeoutSignal.aborted && !signal?.aborted) {
      throw new Error("GitHub request timed out. Please retry.");
    }
    throw error;
  }

  if (response.status === 404) {
    throw new Error(notFoundMessage);
  }

  if (!response.ok) {
    throw new Error(
      `GitHub request failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

async function getRepoMetadata(
  username: string,
  repo: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<{
  defaultBranch: string;
  isPrivate: boolean;
  stargazerCount: number | null;
}> {
  const data = await fetchJson<GitHubRepoResponse>(
    `https://api.github.com/repos/${username}/${repo}`,
    headers,
    "Repository not found.",
    signal,
  );

  return {
    defaultBranch: data.default_branch || "main",
    isPrivate: Boolean(data.private),
    stargazerCount:
      typeof data.stargazers_count === "number" ? data.stargazers_count : null,
  };
}

async function getFileTree(
  username: string,
  repo: string,
  branch: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<string> {
  const data = await fetchJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${username}/${repo}/git/trees/${branch}?recursive=1`,
    headers,
    "Could not fetch repository file tree.",
    signal,
  );

  if (data.truncated === true) {
    throw new Error(REPOSITORY_TOO_LARGE_ERROR);
  }

  const paths = (data.tree ?? [])
    .map((item) => item.path)
    .filter((path): path is string => typeof path === "string")
    .filter(shouldIncludeFile);

  if (!paths.length) {
    throw new Error(
      "Could not fetch repository file tree. Repository might be empty or inaccessible.",
    );
  }

  const fileTree = paths.join("\n");
  if (fileTree.length > MAX_INCLUDED_FILE_TREE_CHARACTERS) {
    throw new Error(REPOSITORY_TOO_LARGE_ERROR);
  }

  return fileTree;
}

async function getReadme(
  username: string,
  repo: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<string> {
  const data = await fetchJson<GitHubReadmeResponse>(
    `https://api.github.com/repos/${username}/${repo}/readme`,
    headers,
    "No README found for the specified repository.",
    signal,
  );

  if (typeof data.size === "number" && data.size > MAX_README_BYTES) {
    throw new Error(REPOSITORY_TOO_LARGE_ERROR);
  }

  if (typeof data.content !== "string" || !data.content) {
    throw new Error("No README found for the specified repository.");
  }

  // GitHub's contents API returns base64 with line breaks. Bound the encoded
  // payload too, so malformed metadata cannot bypass the decoded byte limit.
  if (data.content.length > MAX_README_BYTES * 2) {
    throw new Error(REPOSITORY_TOO_LARGE_ERROR);
  }

  let readme: string;
  if (data.encoding === "base64") {
    readme = Buffer.from(data.content, "base64").toString("utf-8");
  } else {
    readme = data.content;
  }

  if (Buffer.byteLength(readme, "utf-8") > MAX_README_BYTES) {
    throw new Error(REPOSITORY_TOO_LARGE_ERROR);
  }

  return readme;
}

export async function getGithubData(
  username: string,
  repo: string,
  githubPat?: string,
  signal?: AbortSignal,
): Promise<GithubData> {
  const headers = await getGitHubApiHeaders({ githubPat });
  const readmeResultPromise = getReadme(username, repo, headers, signal).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const { defaultBranch, isPrivate, stargazerCount } = await getRepoMetadata(
    username,
    repo,
    headers,
    signal,
  );
  const [fileTree, readmeResult] = await Promise.all([
    getFileTree(username, repo, defaultBranch, headers, signal),
    readmeResultPromise,
  ]);
  if (!readmeResult.ok) {
    throw readmeResult.error;
  }

  return {
    defaultBranch,
    fileTree,
    readme: readmeResult.value,
    isPrivate,
    stargazerCount,
  };
}
