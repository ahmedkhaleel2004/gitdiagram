import { createHmac } from "node:crypto";

import type { ArtifactVisibility } from "~/server/storage/types";
import { readRequiredEnv } from "~/server/storage/config";

function normalizeSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function createPatNamespace(githubPat: string): string {
  const secret = readRequiredEnv("CACHE_KEY_SECRET");
  return createHmac("sha256", secret).update(githubPat.trim()).digest("hex");
}

export interface StorageLocation {
  visibility: ArtifactVisibility;
  bucket: string;
  artifactKey: string;
  statusKey: string;
}

export function getPublicLocation(username: string, repo: string): StorageLocation {
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
