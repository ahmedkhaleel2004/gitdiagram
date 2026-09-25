import "server-only";

import { getGitHubApiHeaders } from "~/server/github-auth";
import {
  EMPTY_REPOSITORY_ERROR,
  getGithubData,
  PRIVATE_REPOSITORY_AUTH_REQUIRED_ERROR,
  REPOSITORY_NOT_FOUND_ERROR,
  REPOSITORY_TOO_LARGE_ERROR,
} from "~/server/generate/github";
import { prepareRepositoryContext } from "~/server/generate/repository-context";
import { fetchSourceContext } from "~/server/generate/source-context";
import type { VideoMeta } from "~/features/explainer/types";
import type { PlanRepositoryFacts } from "./text";

/** Everything the film's writers see about the repository. */
export interface RepositoryContextInput {
  owner: string;
  repo: string;
  url: string;
  description: string;
  stars: number;
  language: string;
  topics: string[];
  readme: string;
  fileTree: string;
  treeTruncated: boolean;
  sourceText: string;
}

/** A repository no video can be made for; asking again will not help. */
export class VideoInputError extends Error {}

const PUBLIC_ONLY_MESSAGE =
  "Explainer videos are available for public repositories only.";
const EMPTY_MESSAGE =
  "This repository looks empty, so there is nothing to explain yet.";

// What the diagram pipeline's GitHub read reports, as told to a video viewer.
// Videos are read with GitDiagram's own token, never a visitor's, so a
// private repository reads as missing or as needing a token.
const INPUT_ERRORS = new Map([
  [REPOSITORY_NOT_FOUND_ERROR, PUBLIC_ONLY_MESSAGE],
  [PRIVATE_REPOSITORY_AUTH_REQUIRED_ERROR, PUBLIC_ONLY_MESSAGE],
  [EMPTY_REPOSITORY_ERROR, EMPTY_MESSAGE],
  [REPOSITORY_TOO_LARGE_ERROR, REPOSITORY_TOO_LARGE_ERROR],
]);

/**
 * Whether GitHub reports the repository as public, for naming it on the
 * /admin feed. False when unsure (a slow or failed read), so a private name
 * is never sent. Best effort: a short timeout, never throws.
 */
export async function isPublicRepository(
  username: string,
  repo: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`,
      {
        headers: await getGitHubApiHeaders(),
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as { private?: unknown };
    return body.private === false;
  } catch {
    return false;
  }
}

export interface VideoRepository {
  meta: VideoMeta;
  prompt: RepositoryContextInput;
  facts: PlanRepositoryFacts;
  /** Source files whose excerpts the model reads. */
  sourceFileCount: number;
}

/**
 * Read a public repository the same way diagram generation does (tree, README,
 * and scored, integrity-checked source excerpts), plus display metadata.
 */
export async function readRepositoryForVideo(params: {
  username: string;
  repo: string;
  signal?: AbortSignal;
}): Promise<VideoRepository> {
  const { username, repo, signal } = params;
  const data = await getGithubData(username, repo, undefined, signal).catch(
    (error: unknown) => {
      const message =
        error instanceof Error ? INPUT_ERRORS.get(error.message) : undefined;
      throw message ? new VideoInputError(message) : error;
    },
  );
  const prepared = prepareRepositoryContext(data);
  const source = await fetchSourceContext({
    username,
    repo,
    githubData: data,
    selectedPaths: prepared.selectedPaths,
    signal,
  });
  const meta: VideoMeta = {
    owner: username,
    repo,
    url: `https://github.com/${username}/${repo}`,
    description: data.description ?? "",
    stars: data.stargazerCount ?? 0,
    language: data.language ?? "",
  };
  return {
    meta,
    sourceFileCount: prepared.selectedPaths.length,
    prompt: {
      owner: username,
      repo,
      url: meta.url,
      description: meta.description,
      stars: meta.stars,
      language: meta.language,
      topics: data.topics ?? [],
      readme: prepared.readme,
      fileTree: prepared.fileTree,
      treeTruncated: prepared.treeTruncated,
      sourceText: source.text,
    },
    facts: {
      name: repo,
      paths: data.fileTree.split("\n").filter(Boolean),
      // README examples are real code too; on-screen code may quote either.
      sourceText: `${source.text}\n${prepared.readme}`,
    },
  };
}
