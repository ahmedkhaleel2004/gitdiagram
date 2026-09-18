import { createHash } from "node:crypto";
import { excerptSource } from "./source-excerpt";
import { getGitHubApiHeaders } from "../github-auth";
import type { GithubData, SourceBlob } from "./github";
import {
  MAX_SOURCE_CHARACTERS,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  isArchitectureSource,
} from "./repository-context";

interface SourceExcerpt {
  path: string;
  text: string;
  truncated: boolean;
}
export interface SourceContext {
  text: string;
  paths: string[];
  unavailableCount: number;
}

async function readBoundedBytes(
  response: Response,
  limit: number,
): Promise<Buffer | null> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function matchesBlob(bytes: Buffer, sha: string): boolean {
  return (
    createHash(sha.length === 64 ? "sha256" : "sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex") === sha
  );
}

async function readBlob(params: {
  username: string;
  repo: string;
  path: string;
  blob: SourceBlob;
  headers: HeadersInit;
  signal: AbortSignal;
}): Promise<SourceExcerpt | null> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(params.username)}/${encodeURIComponent(params.repo)}/git/blobs/${params.blob.sha}`,
    {
      headers: params.headers,
      signal: params.signal,
      cache: "no-store",
      redirect: "error",
    },
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const bytes = await readBoundedBytes(response, MAX_SOURCE_FILE_BYTES * 2);
  if (!bytes) return null;
  const data = JSON.parse(bytes.toString("utf8")) as {
    encoding?: string;
    content?: string;
    size?: number;
  };
  if (
    data.encoding !== "base64" ||
    typeof data.content !== "string" ||
    (data.size ?? 0) > MAX_SOURCE_FILE_BYTES
  )
    return null;
  const sourceBytes = Buffer.from(data.content, "base64");
  if (sourceBytes.length > MAX_SOURCE_FILE_BYTES || sourceBytes.includes(0))
    return null;
  if (!matchesBlob(sourceBytes, params.blob.sha)) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  return { path: params.path, text, truncated: false };
}

// Public content delivery avoids spending REST quota on each source file.
// Verify the Git blob hash so a branch move cannot mix tree and file versions.
// No credentials are sent to this host; private repositories stay on the API.
async function readPublicSource(params: {
  username: string;
  repo: string;
  branch: string;
  path: string;
  blob: SourceBlob;
  signal: AbortSignal;
}): Promise<SourceExcerpt | "changed" | null> {
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(params.username)}/${encodeURIComponent(params.repo)}/${encodeURIComponent(params.branch)}/${params.path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, {
    signal: params.signal,
    cache: "no-store",
    redirect: "error",
  });
  const bytes = await readBoundedBytes(response, MAX_SOURCE_FILE_BYTES);
  if (!bytes || bytes.includes(0)) return null;
  if (!matchesBlob(bytes, params.blob.sha)) return "changed";
  return {
    path: params.path,
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    truncated: false,
  };
}

export async function fetchSourceContext(params: {
  username: string;
  repo: string;
  githubData: GithubData;
  selectedPaths: string[];
  githubPat?: string;
  signal?: AbortSignal;
}): Promise<SourceContext> {
  params.signal?.throwIfAborted();
  if (params.githubData.isPrivate && !params.githubPat?.trim())
    throw new Error(
      "A GitHub token is required to analyze a private repository.",
    );
  const paths = params.selectedPaths
    .filter(isArchitectureSource)
    .slice(0, MAX_SOURCE_FILES);
  const result: Array<SourceExcerpt | null> = paths.map(() => null);
  // Best-effort enrichment gets its own short budget, but caller cancellation
  // always propagates. Never cache source bodies or follow repository URLs.
  const deadline = AbortSignal.timeout(12_000);
  const signal = params.signal
    ? AbortSignal.any([params.signal, deadline])
    : deadline;
  if (!params.githubData.sourceBlobs?.size)
    return {
      text: "No source excerpts available. Use documented relationships only.",
      paths: [],
      unavailableCount: paths.length,
    };
  const headers = params.githubData.isPrivate
    ? await getGitHubApiHeaders({ githubPat: params.githubPat })
    : {};
  let next = 0;
  let changedSourceRecoveries = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < paths.length && !signal.aborted) {
        const index = next++;
        const path = paths[index]!;
        const blob = params.githubData.sourceBlobs?.get(path);
        if (
          !blob ||
          blob.size > MAX_SOURCE_FILE_BYTES ||
          !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(blob.sha)
        )
          continue;
        try {
          if (params.githubData.isPrivate) {
            result[index] = await readBlob({
              ...params,
              path,
              blob,
              headers,
              signal,
            });
          } else {
            const source = await readPublicSource({
              ...params,
              branch: params.githubData.defaultBranch,
              path,
              blob,
              signal,
            });
            if (source === "changed") {
              // A fresh commit or stale CDN entry can hide the most important
              // file. Recover its immutable blob with at most two REST reads,
              // inside the same ingestion deadline. Ordinary CDN failures do
              // not fan out into a dozen quota-consuming API requests.
              if (changedSourceRecoveries++ < 2) {
                result[index] = await readBlob({
                  ...params,
                  path,
                  blob,
                  signal,
                  headers: await getGitHubApiHeaders({
                    githubPat: params.githubData.usedPublicFallback
                      ? undefined
                      : params.githubPat,
                  }),
                });
              }
            } else result[index] = source;
          }
        } catch {
          params.signal?.throwIfAborted();
        }
      }
    }),
  );
  params.signal?.throwIfAborted();
  const available = result.filter(
    (entry): entry is SourceExcerpt => entry !== null,
  );
  // Fair excerpts preserve coverage of every selected subsystem, not just the
  // first long file. Clearly mark omitted bodies; absence never proves no edge.
  const limits = available.map(() => 0);
  let remaining = MAX_SOURCE_CHARACTERS - 4000;
  let pending = available.map((_, index) => index);
  while (pending.length && remaining > 0) {
    const share = Math.floor(remaining / pending.length);
    if (!share) break;
    const next: number[] = [];
    for (const index of pending) {
      const allocation = Math.min(
        share,
        Math.min(available[index]!.text.length, 10_000) - limits[index]!,
      );
      limits[index]! += allocation;
      remaining -= allocation;
      if (limits[index]! < Math.min(available[index]!.text.length, 10_000))
        next.push(index);
    }
    pending = next;
  }
  const excerpts = available.map((entry, index) => {
    const limit = limits[index]!;
    const truncated = entry.text.length > limit;
    const text = excerptSource(entry.text, limit);
    return `FILE ${JSON.stringify(entry.path)}${truncated ? " (partial excerpt)" : ""}\n${text}\nEND FILE`;
  });
  return {
    text: excerpts.length
      ? excerpts.join("\n\n").slice(0, MAX_SOURCE_CHARACTERS)
      : "No source excerpts available. Use documented relationships only.",
    paths: available.map((entry) => entry.path),
    unavailableCount: paths.length - available.length,
  };
}
