function normalizeRepoPathSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function getRepoPagePath(username: string, repo: string): string {
  return `/${normalizeRepoPathSegment(username)}/${normalizeRepoPathSegment(repo)}`;
}

/**
 * The route-level ISR entry is keyed on the URL exactly as it was requested,
 * while storage lowercases everything. Revalidating only the normalized path
 * leaves a visitor who arrived at `/Acme/Demo` on stale HTML, so the caller's
 * own casing has to be invalidated too.
 */
export function getRequestedRepoPagePath(
  username: string,
  repo: string,
): string {
  return `/${encodeURIComponent(username.trim())}/${encodeURIComponent(repo.trim())}`;
}

/** `/{owner}/{repo}/commit/{sha}`: the page of one commit's diagram. */
export function getCommitPagePath(
  username: string,
  repo: string,
  commit: string,
): string {
  return `${getRepoPagePath(username, repo)}/commit/${normalizeRepoPathSegment(commit)}`;
}

/**
 * The tag of a cached public read. A commit has a tag of its own so that
 * generating a commit never drops the default-branch page, or another commit.
 */
export function getPublicDiagramStateCacheTag(
  username: string,
  repo: string,
  commit?: string,
): string {
  const base = `public-diagram-state:${normalizeRepoPathSegment(username)}:${normalizeRepoPathSegment(repo)}`;
  return commit ? `${base}:commit:${normalizeRepoPathSegment(commit)}` : base;
}
