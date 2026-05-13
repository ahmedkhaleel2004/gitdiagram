function normalizeRepoPathSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function getRepoPagePath(username: string, repo: string): string {
  return `/${normalizeRepoPathSegment(username)}/${normalizeRepoPathSegment(repo)}`;
}

export function getPublicDiagramStateCacheTag(
  username: string,
  repo: string,
): string {
  return `public-diagram-state:${normalizeRepoPathSegment(username)}:${normalizeRepoPathSegment(repo)}`;
}
