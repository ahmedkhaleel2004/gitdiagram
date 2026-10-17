import { createHmac } from "node:crypto";

import { isFullCommitSha } from "~/features/diagram/commit";
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

/**
 * The commit part of a storage key. Only a complete SHA is ever stored under:
 * a short SHA would let two spellings of one commit hold two artifacts, and a
 * branch name would make an "immutable" diagram move.
 */
function normalizeCommit(commit: string): string {
  const normalized = commit.trim().toLowerCase();
  if (!isFullCommitSha(normalized)) {
    throw new Error(
      "A commit storage location requires the full 40-character commit SHA.",
    );
  }
  return normalized;
}

export interface StorageLocation {
  visibility: ArtifactVisibility;
  bucket: string;
  artifactKey: string;
  statusKey: string;
}

export function getPublicPreviewKey(username: string, repo: string): string {
  // The sidecar lives under its own prefix rather than a ".preview" suffix on
  // the repo segment: normalizeSegment leaves "." unescaped, so a suffix would
  // let the sidecar for repo "app" collide with the artifact for the legal
  // repo name "app.preview" and silently overwrite it.
  return `public-preview/v1/${normalizeSegment(username)}/${normalizeSegment(repo)}.json`;
}

/**
 * Where a repository's public commit diagrams live: one object per full SHA,
 * under the repository's own folder. The default-branch artifact stays at
 * `public/v1/<owner>/<repo>.json`, which has two segments after `v1` where a
 * commit key has four, so the two kinds can never share a key.
 */
export function getPublicCommitKeyPrefix(
  username: string,
  repo: string,
): string {
  return `public/v1/${normalizeSegment(username)}/${normalizeSegment(repo)}/commit/`;
}

export function getPublicLocation(
  username: string,
  repo: string,
  commit?: string,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);
  const bucket = readRequiredEnv("R2_PUBLIC_BUCKET");

  if (commit !== undefined) {
    const sha = normalizeCommit(commit);
    return {
      visibility: "public",
      bucket,
      artifactKey: `${getPublicCommitKeyPrefix(username, repo)}${sha}.json`,
      statusKey: `status:v1:public:${normalizedUsername}:${normalizedRepo}:commit:${sha}`,
    };
  }

  return {
    visibility: "public",
    bucket,
    artifactKey: `public/v1/${normalizedUsername}/${normalizedRepo}.json`,
    statusKey: `status:v1:public:${normalizedUsername}:${normalizedRepo}`,
  };
}

export function getPrivateLocation(
  username: string,
  repo: string,
  githubPat: string,
  commit?: string,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);
  const namespace = createPatNamespace(githubPat);
  const bucket = readRequiredEnv("R2_PRIVATE_BUCKET");

  if (commit !== undefined) {
    const sha = normalizeCommit(commit);
    return {
      visibility: "private",
      bucket,
      artifactKey: `private/v1/${namespace}/${normalizedUsername}/${normalizedRepo}/commit/${sha}.json`,
      statusKey: `status:v1:private:${namespace}:${normalizedUsername}:${normalizedRepo}:commit:${sha}`,
    };
  }

  return {
    visibility: "private",
    bucket,
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
  /** Full SHA of the commit a diagram is for; absent for the default branch. */
  commit?: string;
}): StorageLocation {
  if (params.visibility !== "private") {
    return getPublicLocation(params.username, params.repo, params.commit);
  }

  return getPrivateLocation(
    params.username,
    params.repo,
    params.githubPat ?? "",
    params.commit,
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
  /** Full SHA of the commit a diagram is for; absent for the default branch. */
  commit?: string;
}): StorageLocation[] {
  const locations: StorageLocation[] = [];
  if (params.githubPat?.trim()) {
    locations.push(
      getPrivateLocation(
        params.username,
        params.repo,
        params.githubPat,
        params.commit,
      ),
    );
  }
  locations.push(
    getPublicLocation(params.username, params.repo, params.commit),
  );
  return locations;
}
