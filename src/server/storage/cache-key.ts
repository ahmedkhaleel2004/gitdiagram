import { createHmac } from "node:crypto";

import type { ArtifactVisibility } from "~/server/storage/types";
import { readRequiredEnv } from "~/server/storage/config";

function normalizeSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function createPatNamespace(githubPat: string): string {
  const trimmedPat = githubPat.trim();
  // An empty token would hash to one fixed namespace shared by every caller,
  // and no read path ever consults it (getReadLocations only reaches the
  // private bucket when a token is present). Fail loudly instead of writing
  // artifacts nobody can read back.
  if (!trimmedPat) {
    throw new Error(
      "A private storage location requires a non-empty GitHub token.",
    );
  }

  const secret = readRequiredEnv("CACHE_KEY_SECRET");
  return createHmac("sha256", secret).update(trimmedPat).digest("hex");
}

export interface StorageLocation {
  visibility: ArtifactVisibility;
  bucket: string;
  artifactKey: string;
  statusKey: string;
}

export function getPublicPreviewKey(username: string, repo: string): string {
  return `public/v1/${normalizeSegment(username)}/${normalizeSegment(repo)}.preview.json`;
}

export function getPublicLocation(
  username: string,
  repo: string,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);

  return {
    visibility: "public",
    bucket: readRequiredEnv("R2_PUBLIC_BUCKET"),
    artifactKey: `public/v1/${normalizedUsername}/${normalizedRepo}.json`,
    statusKey: `status:v1:public:${normalizedUsername}:${normalizedRepo}`,
  };
}

export function getPrivateLocation(
  username: string,
  repo: string,
  githubPat: string,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);
  const namespace = createPatNamespace(githubPat);

  return {
    visibility: "private",
    bucket: readRequiredEnv("R2_PRIVATE_BUCKET"),
    artifactKey: `private/v1/${namespace}/${normalizedUsername}/${normalizedRepo}.json`,
    statusKey: `status:v1:private:${namespace}:${normalizedUsername}:${normalizedRepo}`,
  };
}

/**
 * Resolves where a generation result should be written.
 *
 * A private artifact is namespaced by the caller's own token, so there is no
 * safe destination for a private repository the caller did not authenticate
 * for: the public bucket would expose it, and the empty-token namespace is
 * unreadable. Callers must handle that case before reaching storage —
 * `canPersistVisibility` answers the same question without throwing.
 */
export function getWriteLocation(params: {
  username: string;
  repo: string;
  visibility: ArtifactVisibility;
  githubPat?: string;
}): StorageLocation {
  if (params.visibility !== "private") {
    return getPublicLocation(params.username, params.repo);
  }

  return getPrivateLocation(
    params.username,
    params.repo,
    params.githubPat ?? "",
  );
}

export function canPersistVisibility(params: {
  visibility: ArtifactVisibility;
  githubPat?: string;
}): boolean {
  return params.visibility !== "private" || Boolean(params.githubPat?.trim());
}

export function getReadLocations(params: {
  username: string;
  repo: string;
  githubPat?: string;
}): StorageLocation[] {
  const locations: StorageLocation[] = [];
  if (params.githubPat?.trim()) {
    locations.push(
      getPrivateLocation(params.username, params.repo, params.githubPat),
    );
  }
  locations.push(getPublicLocation(params.username, params.repo));
  return locations;
}
