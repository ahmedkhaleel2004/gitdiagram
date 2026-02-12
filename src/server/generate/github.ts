interface GitHubRepoResponse {
  default_branch?: string;
}

interface GitHubTreeItem {
  path: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeItem[];
}

interface GitHubReadmeResponse {
  content?: string;
  encoding?: string;
}

export interface GithubData {
  defaultBranch: string;
  fileTree: string;
  readme: string;
}

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

function createHeaders(githubPat?: string): HeadersInit {
  const token = githubPat?.trim();

  if (!token) {
    return {
      Accept: "application/vnd.github+json",
    };
  }

  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
  };
}

async function fetchJson<T>(
  url: string,
  headers: HeadersInit,
  notFoundMessage: string,
): Promise<T> {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
  });

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

async function getDefaultBranch(
  username: string,
  repo: string,
  headers: HeadersInit,
): Promise<string> {
  const data = await fetchJson<GitHubRepoResponse>(
    `https://api.github.com/repos/${username}/${repo}`,
    headers,
    "Repository not found.",
  );

  return data.default_branch || "main";
}

async function getFileTree(
  username: string,
  repo: string,
  branch: string,
  headers: HeadersInit,
): Promise<string> {
  const data = await fetchJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${username}/${repo}/git/trees/${branch}?recursive=1`,
    headers,
    "Could not fetch repository file tree.",
  );

  const paths = (data.tree ?? [])
    .map((item) => item.path)
    .filter((path): path is string => Boolean(path))
    .filter(shouldIncludeFile);

  if (!paths.length) {
    throw new Error(
      "Could not fetch repository file tree. Repository might be empty or inaccessible.",
    );
  }

  return paths.join("\n");
}

async function getReadme(
  username: string,
  repo: string,
  headers: HeadersInit,
): Promise<string> {
  const data = await fetchJson<GitHubReadmeResponse>(
    `https://api.github.com/repos/${username}/${repo}/readme`,
    headers,
    "No README found for the specified repository.",
  );

  if (!data.content) {
    throw new Error("No README found for the specified repository.");
  }

  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  return data.content;
}

export async function getGithubData(
  username: string,
  repo: string,
  githubPat?: string,
): Promise<GithubData> {
  const headers = createHeaders(githubPat);
  const defaultBranch = await getDefaultBranch(username, repo, headers);
  const [fileTree, readme] = await Promise.all([
    getFileTree(username, repo, defaultBranch, headers),
    getReadme(username, repo, headers),
  ]);

  return {
    defaultBranch,
    fileTree,
    readme,
  };
}
