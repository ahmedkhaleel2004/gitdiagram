import "server-only";

import { unstable_cache } from "next/cache";

import {
  diagramGraphSchema,
  type DiagramGraph,
} from "~/features/diagram/graph";
import {
  githubRepoSchema,
  githubUsernameSchema,
} from "~/server/generate/types";
import { getStoredDiagramArtifact } from "~/server/storage/artifact-store";
import { getPublicDiagramStateCacheTag } from "~/server/storage/repo-page-cache";

export type DiagramPictureData =
  | { kind: "graph"; graph: DiagramGraph; stargazerCount: number | null }
  // Diagrams stored before the graph format keep only their Mermaid text.
  | { kind: "card"; stargazerCount: number | null };

async function readPictureData(
  username: string,
  repo: string,
): Promise<DiagramPictureData | null> {
  // No token: only the public namespace is read, so a private repository's
  // diagram can never be drawn here.
  const stored = await getStoredDiagramArtifact({ username, repo });
  if (!stored || stored.artifact.visibility !== "public") return null;
  if (!stored.artifact.diagram) return null;
  const graph = diagramGraphSchema.safeParse(stored.artifact.graph);
  const stargazerCount = stored.artifact.stargazerCount;
  return graph.success
    ? { kind: "graph", graph: graph.data, stargazerCount }
    : { kind: "card", stargazerCount };
}

/**
 * What the README picture draws for a public repository, or null. Cached
 * under the repository page's own tag, which a new diagram revalidates.
 */
export async function getDiagramPictureData(
  username: string,
  repo: string,
): Promise<DiagramPictureData | null> {
  const owner = githubUsernameSchema.safeParse(username);
  const name = githubRepoSchema.safeParse(repo);
  if (!owner.success || !name.success) return null;
  return unstable_cache(
    () => readPictureData(owner.data, name.data),
    ["diagram-picture", owner.data.toLowerCase(), name.data.toLowerCase()],
    {
      revalidate: 86400,
      tags: [getPublicDiagramStateCacheTag(owner.data, name.data)],
    },
  )();
}
