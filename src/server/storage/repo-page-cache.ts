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

export function getPublicDiagramStateCacheTag(
  username: string,
  repo: string,
): string {
  return `public-diagram-state:${normalizeRepoPathSegment(username)}:${normalizeRepoPathSegment(repo)}`;
}
