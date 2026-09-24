import "server-only";

import { getGitHubApiHeaders } from "~/server/github-auth";
import { getGithubData } from "~/server/generate/github";
import { prepareRepositoryContext } from "~/server/generate/repository-context";
import { fetchSourceContext } from "~/server/generate/source-context";
import type { VideoMeta } from "~/features/video/types";
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

export class VideoInputError extends Error {}

export interface VideoRepository {
  meta: VideoMeta;
  prompt: RepositoryContextInput;
  facts: PlanRepositoryFacts;
}

async function readMetadata(
  username: string,
  repo: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`,
    { headers: await getGitHubApiHeaders(), signal },
  );
  if (!response.ok) return null;
  return (await response.json()) as {
    description?: string | null;
    language?: string | null;
    topics?: string[];
    stargazers_count?: number;
  };
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
  const [data, metadata] = await Promise.all([
    getGithubData(username, repo, undefined, signal),
    readMetadata(username, repo, signal),
  ]);
  if (data.isPrivate)
    throw new VideoInputError(
      "Explainer videos are available for public repositories only.",
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
    description: metadata?.description ?? "",
    stars: metadata?.stargazers_count ?? data.stargazerCount ?? 0,
    language: metadata?.language ?? "",
  };
  return {
    meta,
    prompt: {
      owner: username,
      repo,
      url: meta.url,
      description: meta.description,
      stars: meta.stars,
      language: meta.language,
      topics: metadata?.topics ?? [],
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
