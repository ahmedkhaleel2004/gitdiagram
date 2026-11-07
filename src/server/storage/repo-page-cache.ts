function normalizeRepoPathSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function getRepoPagePath(
  username: string,
  repo: string,
  branch?: string,
): string {
  const base = `/${normalizeRepoPathSegment(username)}/${normalizeRepoPathSegment(repo)}`;
  if (!branch) return base;
  const branchPath = branch
    .split("/")
    .map(normalizeRepoPathSegment)
    .join("/");
  return `${base}/tree/${branchPath}`;
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
  branch?: string,
): string {
  const base = `/${encodeURIComponent(username.trim())}/${encodeURIComponent(repo.trim())}`;
  if (!branch) return base;
  const branchPath = branch
    .split("/")
    .map((seg) => encodeURIComponent(seg.trim()))
    .join("/");
  return `${base}/tree/${branchPath}`;
}

export function getPublicDiagramStateCacheTag(
  username: string,
  repo: string,
  branch?: string,
): string {
  const base = `public-diagram-state:${normalizeRepoPathSegment(username)}:${normalizeRepoPathSegment(repo)}`;
  return branch ? `${base}:${normalizeRepoPathSegment(branch)}` : base;
}
