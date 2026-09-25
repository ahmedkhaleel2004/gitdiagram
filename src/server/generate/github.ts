import { getGitHubApiHeaders } from "../github-auth";
import { GitHubRequestError } from "./github-errors";

interface GitHubRepoResponse {
  default_branch?: string;
  private?: boolean;
  stargazers_count?: number;
  description?: string | null;
  language?: string | null;
  topics?: unknown;
}

interface GitHubTreeItem {
  path?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
  mode?: unknown;
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

export interface SourceBlob {
  sha: string;
  size: number;
}

export interface GithubData {
  defaultBranch: string;
  fileTree: string;
  readme: string;
  isPrivate: boolean;
  /** Metadata/tree were authorized as public after a stale caller token failed. */
  usedPublicFallback?: boolean;
  stargazerCount: number | null;
  /** Display metadata from the same repository read; absent when unset. */
  description?: string;
  language?: string;
  topics?: string[];
  pathTypes: ReadonlyMap<string, RepositoryPathType>;
  sourceBlobs?: ReadonlyMap<string, SourceBlob>;
  /** GitHub listed only part of the tree (over 100,000 entries or 7 MB). */
  treeTruncated?: boolean;
}

export type RepositoryPathType = "blob" | "tree";

export const REPOSITORY_TOO_LARGE_ERROR =
  "Repository is too large for analysis. Try a smaller repo.";
// Messages this module authors itself. They describe the caller's own request
// and carry no upstream response text, so `normalizeGenerationError` is willing
// to show them verbatim.
const GITHUB_REQUEST_TIMEOUT_ERROR = "GitHub request timed out. Please retry.";
export const REPOSITORY_NOT_FOUND_ERROR = "Repository not found.";
const FILE_TREE_UNAVAILABLE_ERROR = "Could not fetch repository file tree.";
export const EMPTY_REPOSITORY_ERROR =
  "Could not fetch repository file tree. Repository might be empty or inaccessible.";
function buildGithubRequestFailedError(status: number): string {
  return `GitHub request failed (${status}). Please retry.`;
}
export const PRIVATE_REPOSITORY_AUTH_REQUIRED_ERROR =
  "A GitHub token is required to analyze a private repository.";
export const MAX_README_BYTES = 750_000;
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
const MAX_PUBLIC_TREE_CACHE_ENTRIES = 8;
const MAX_PUBLIC_TREE_CACHE_CHARACTERS = 4_000_000;
// A partial listing can leave whole top-level folders out. Each missing one
// costs a small non-recursive request, so only this many are filled in.
const MAX_MISSING_TOP_LEVEL_FETCHES = 8;
const GIT_SHA = /^[a-f0-9]{40,64}$/;

interface PublicTreeCacheEntry {
  etag: string;
  fileTree: string;
  pathTypes: ReadonlyMap<string, RepositoryPathType>;
  sourceBlobs?: ReadonlyMap<string, SourceBlob>;
  treeTruncated: boolean;
  characters: number;
}

type JsonFetchResult<T> =
  { notModified: true } | { notModified: false; value: T; etag: string | null };

// Fluid instances can reuse unchanged public trees without retaining private
// repository data. Every reuse is revalidated with GitHub, so repository
// changes remain visible immediately while 304 responses avoid the largest
// response body and JSON parse in the ingestion path.
const publicTreeCache = new Map<string, PublicTreeCacheEntry>();
let publicTreeCacheCharacters = 0;

function deletePublicTreeCacheEntry(key: string): void {
  const entry = publicTreeCache.get(key);
  if (entry && publicTreeCache.delete(key)) {
    publicTreeCacheCharacters -= entry.characters;
  }
}

// Directory segments are matched anywhere in the path.
const EXCLUDED_DIRECTORY_SEGMENTS = [
  "node_modules",
  "vendor",
  "venv",
  "__pycache__",
  ".cache",
  ".tmp",
  ".vscode",
  ".idea",
];

// Suffixes are matched against the end of the path only. Substring matching
// here silently drops real source files: ".ico" appears inside "ui.icons.ts",
// ".so" inside "data.source.ts", and ".class" inside "model.classifier.py".
const EXCLUDED_SUFFIXES = [
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
  ".woff2",
  ".webp",
  ".log",
  "yarn.lock",
  "poetry.lock",
];

// Minified bundles carry no architectural signal regardless of extension.
const MINIFIED_INFIX = ".min.";

function shouldIncludeFile(path: string): boolean {
  const lowerPath = path.toLowerCase();

  if (lowerPath.includes(MINIFIED_INFIX)) {
    return false;
  }

  if (EXCLUDED_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix))) {
    return false;
  }

  return !lowerPath
    .split("/")
    .some((segment) => EXCLUDED_DIRECTORY_SEGMENTS.includes(segment));
}

async function fetchJsonResult<T>(
  url: string,
  headers: HeadersInit,
  notFoundMessage: string,
  signal?: AbortSignal,
  ifNoneMatch?: string,
  conflictMessage?: string,
): Promise<JsonFetchResult<T>> {
  const timeoutSignal = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  const requestHeaders = new Headers(headers);
  if (ifNoneMatch) {
    requestHeaders.set("If-None-Match", ifNoneMatch);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: requestHeaders,
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
  } catch (error) {
    if (timeoutSignal.aborted && !signal?.aborted) {
      throw new Error(GITHUB_REQUEST_TIMEOUT_ERROR);
    }
    throw error;
  }

  if (response.status === 304 && ifNoneMatch) {
    return { notModified: true };
  }

  if (response.status === 404) {
    throw new GitHubRequestError(notFoundMessage, 404);
  }

  // GitHub answers 409 ("Git Repository is empty.") for zero-commit repos on
  // the trees endpoint — a permanent condition, not a transient failure.
  if (response.status === 409 && conflictMessage) {
    throw new Error(conflictMessage);
  }

  if (!response.ok) {
    // GitHub's error body describes *our* credential when the server key is the
    // one being rejected or throttled, and this message reaches the client and
    // the persisted audit. Keep the body in the server log only.
    console.error(
      JSON.stringify({
        event: "generate.github.request_failed",
        status: response.status,
        request_id: response.headers.get("x-github-request-id"),
        rate_limit_remaining: response.headers.get("x-ratelimit-remaining"),
        rate_limit_reset: response.headers.get("x-ratelimit-reset"),
        retry_after: response.headers.get("retry-after"),
        body: (await response.text()).slice(0, 500),
      }),
    );
    throw new GitHubRequestError(
      buildGithubRequestFailedError(response.status),
      response.status,
      response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after"),
    );
  }

  return {
    notModified: false,
    value: (await response.json()) as T,
    etag: response.headers.get("etag"),
  };
}

async function fetchJson<T>(
  url: string,
  headers: HeadersInit,
  notFoundMessage: string,
  signal?: AbortSignal,
): Promise<T> {
  const result = await fetchJsonResult<T>(
    url,
    headers,
    notFoundMessage,
    signal,
  );
  if (result.notModified) {
    throw new Error("GitHub returned an unexpected not-modified response.");
  }
  return result.value;
}

async function getRepoMetadata(
  username: string,
  repo: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<
  Pick<
    GithubData,
    | "defaultBranch"
    | "isPrivate"
    | "stargazerCount"
    | "description"
    | "language"
    | "topics"
  >
> {
  const data = await fetchJson<GitHubRepoResponse>(
    `https://api.github.com/repos/${username}/${repo}`,
    headers,
    REPOSITORY_NOT_FOUND_ERROR,
    signal,
  );

  return {
    defaultBranch: data.default_branch || "main",
    isPrivate: Boolean(data.private),
    stargazerCount:
      typeof data.stargazers_count === "number" ? data.stargazers_count : null,
    description: data.description || undefined,
    language: data.language || undefined,
    topics: Array.isArray(data.topics)
      ? data.topics.filter((topic) => typeof topic === "string")
      : undefined,
  };
}

/**
 * Top-level entries a partial recursive listing left out, and one level of
 * each top-level folder it has nothing under, read non-recursively. Best
 * effort: a failed read only leaves the listing as GitHub returned it.
 */
async function getMissingTopLevelEntries(
  username: string,
  repo: string,
  branch: string,
  listed: readonly GitHubTreeItem[],
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<GitHubTreeItem[]> {
  const readTree = async (treeish: string) =>
    (
      await fetchJson<GitHubTreeResponse>(
        `https://api.github.com/repos/${username}/${repo}/git/trees/${encodeURIComponent(treeish)}`,
        headers,
        FILE_TREE_UNAVAILABLE_ERROR,
        signal,
      )
    ).tree ?? [];
  try {
    const paths = new Set<string>();
    const coveredFolders = new Set<string>();
    for (const item of listed) {
      if (typeof item.path !== "string") continue;
      paths.add(item.path);
      const slash = item.path.indexOf("/");
      if (slash > 0) coveredFolders.add(item.path.slice(0, slash));
    }
    const root = await readTree(branch);
    const missingFolders = root
      .filter(
        (item): item is GitHubTreeItem & { path: string; sha: string } =>
          item.type === "tree" &&
          typeof item.path === "string" &&
          typeof item.sha === "string" &&
          GIT_SHA.test(item.sha) &&
          !coveredFolders.has(item.path),
      )
      .slice(0, MAX_MISSING_TOP_LEVEL_FETCHES);
    const children = await Promise.all(
      missingFolders.map(async (folder) =>
        (await readTree(folder.sha).catch(() => [])).flatMap((item) =>
          typeof item.path === "string"
            ? [{ ...item, path: `${folder.path}/${item.path}` }]
            : [],
        ),
      ),
    );
    return [
      ...root.filter(
        (item) => typeof item.path === "string" && !paths.has(item.path),
      ),
      ...children.flat().filter((item) => !paths.has(item.path)),
    ];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

async function getFileTree(
  username: string,
  repo: string,
  branch: string,
  headers: HeadersInit,
  usePublicConditionalCache: boolean,
  signal?: AbortSignal,
): Promise<{
  fileTree: string;
  pathTypes: ReadonlyMap<string, RepositoryPathType>;
  sourceBlobs?: ReadonlyMap<string, SourceBlob>;
  treeTruncated: boolean;
}> {
  // Branch names may contain URL-significant characters ("#", "?", …).
  // encodeURIComponent also encodes "/" as %2F, which the trees API accepts
  // in the {tree_sha} position; plain branch names are unchanged.
  const url = `https://api.github.com/repos/${username}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const cached = usePublicConditionalCache
    ? publicTreeCache.get(url)
    : undefined;
  if (cached) {
    publicTreeCache.delete(url);
    publicTreeCache.set(url, cached);
  }
  const result = await fetchJsonResult<GitHubTreeResponse>(
    url,
    headers,
    FILE_TREE_UNAVAILABLE_ERROR,
    signal,
    cached?.etag,
    EMPTY_REPOSITORY_ERROR,
  );
  if (result.notModified && cached) {
    return {
      fileTree: cached.fileTree,
      pathTypes: cached.pathTypes,
      sourceBlobs: cached.sourceBlobs,
      treeTruncated: cached.treeTruncated,
    };
  }
  if (result.notModified) {
    throw new Error("GitHub returned an unexpected not-modified response.");
  }
  const data = result.value;

  // GitHub returns a partial listing above 100,000 entries or 7 MB. The model
  // only sees a bounded excerpt of the tree anyway, so a partial listing still
  // makes a diagram; links to paths it omits are dropped during validation.
  // Top-level folders it left out entirely are read one level deep, so no
  // subsystem is missing from the excerpt, and the truncation is reported.
  const treeTruncated = data.truncated === true;
  const listed = data.tree ?? [];
  const items = treeTruncated
    ? [
        ...listed,
        ...(await getMissingTopLevelEntries(
          username,
          repo,
          branch,
          listed,
          headers,
          signal,
        )),
      ]
    : listed;
  if (treeTruncated) {
    console.info(
      JSON.stringify({
        event: "generate.github.tree_truncated",
        listed_entries: listed.length,
        added_entries: items.length - listed.length,
      }),
    );
  }
  const paths: string[] = [];
  const pathTypes = new Map<string, RepositoryPathType>();
  const sourceBlobs = new Map<string, SourceBlob>();
  for (const item of items) {
    if (typeof item.path === "string" && shouldIncludeFile(item.path)) {
      paths.push(item.path);
      if (item.type === "blob" || item.type === "tree") {
        pathTypes.set(item.path, item.type);
        if (
          item.type === "blob" &&
          (item.mode === "100644" || item.mode === "100755") &&
          typeof item.sha === "string" &&
          GIT_SHA.test(item.sha) &&
          typeof item.size === "number" &&
          item.size >= 0
        ) {
          sourceBlobs.set(item.path, { sha: item.sha, size: item.size });
        }
      }
    }
  }

  if (!paths.length) {
    throw new Error(EMPTY_REPOSITORY_ERROR);
  }

  const fileTree = paths.join("\n");

  if (usePublicConditionalCache) {
    deletePublicTreeCacheEntry(url);
    if (result.etag && fileTree.length <= MAX_PUBLIC_TREE_CACHE_CHARACTERS) {
      while (
        publicTreeCache.size >= MAX_PUBLIC_TREE_CACHE_ENTRIES ||
        publicTreeCacheCharacters + fileTree.length >
          MAX_PUBLIC_TREE_CACHE_CHARACTERS
      ) {
        const oldestKey = publicTreeCache.keys().next().value;
        if (typeof oldestKey !== "string") {
          break;
        }
        deletePublicTreeCacheEntry(oldestKey);
      }
      publicTreeCache.set(url, {
        etag: result.etag,
        fileTree,
        pathTypes,
        sourceBlobs,
        treeTruncated,
        characters: fileTree.length,
      });
      publicTreeCacheCharacters += fileTree.length;
    }
  }

  return { fileTree, pathTypes, sourceBlobs, treeTruncated };
}

class MissingReadmeError extends Error {}

const MISSING_README_MESSAGE = "No README found for the specified repository.";

async function getReadme(
  username: string,
  repo: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<string> {
  let data: GitHubReadmeResponse;
  try {
    data = await fetchJson<GitHubReadmeResponse>(
      `https://api.github.com/repos/${username}/${repo}/readme`,
      headers,
      MISSING_README_MESSAGE,
      signal,
    );
  } catch (error) {
    if (error instanceof Error && error.message === MISSING_README_MESSAGE) {
      throw new MissingReadmeError(MISSING_README_MESSAGE);
    }
    throw error;
  }

  if (typeof data.size === "number" && data.size > MAX_README_BYTES) {
    throw new Error(REPOSITORY_TOO_LARGE_ERROR);
  }

  if (typeof data.content !== "string" || !data.content) {
    throw new MissingReadmeError(MISSING_README_MESSAGE);
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

async function fetchGithubData(
  username: string,
  repo: string,
  githubPat?: string,
  signal?: AbortSignal,
): Promise<GithubData> {
  const hasCallerGithubPat = Boolean(githubPat?.trim());
  const headers = await getGitHubApiHeaders({ githubPat });
  const metadata = await getRepoMetadata(username, repo, headers, signal);
  const { defaultBranch, isPrivate } = metadata;

  // GitHub App installation tokens and the server PAT pool may be able to read
  // private repositories. They improve public API rate limits, but they must
  // never become authorization for an anonymous caller.
  if (isPrivate && !hasCallerGithubPat) {
    throw new Error(PRIVATE_REPOSITORY_AUTH_REQUIRED_ERROR);
  }

  const [tree, readmeResult] = await Promise.all([
    getFileTree(
      username,
      repo,
      defaultBranch,
      headers,
      !hasCallerGithubPat && !isPrivate,
      signal,
    ),
    getReadme(username, repo, headers, signal).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  // A repository without a README is still perfectly diagrammable from its file
  // tree, so only a genuine fetch failure should abort the run.
  if (!readmeResult.ok && !(readmeResult.error instanceof MissingReadmeError)) {
    throw readmeResult.error;
  }

  return {
    ...metadata,
    fileTree: tree.fileTree,
    readme: readmeResult.ok ? readmeResult.value : "",
    pathTypes: tree.pathTypes,
    sourceBlobs: tree.sourceBlobs,
    treeTruncated: tree.treeTruncated,
  };
}

export async function getGithubData(
  username: string,
  repo: string,
  githubPat?: string,
  signal?: AbortSignal,
): Promise<GithubData> {
  try {
    return await fetchGithubData(username, repo, githubPat, signal);
  } catch (error) {
    if (
      !githubPat?.trim() ||
      !(error instanceof GitHubRequestError) ||
      ![401, 403, 404].includes(error.status) ||
      signal?.aborted
    )
      throw error;

    // An expired/restricted saved token must not block public repositories.
    // No caller token means fetchGithubData rejects private metadata BEFORE
    // reading contents, even if the server's installation could access it.
    try {
      const publicData = await fetchGithubData(
        username,
        repo,
        undefined,
        signal,
      );
      console.info(
        JSON.stringify({ event: "generate.github.public_fallback_succeeded" }),
      );
      return { ...publicData, usedPublicFallback: true };
    } catch {
      // Preserve the caller's actionable credential/access failure without
      // revealing whether the server can see a private repository.
      signal?.throwIfAborted();
      throw error;
    }
  }
}
