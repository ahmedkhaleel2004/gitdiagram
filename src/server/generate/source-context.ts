import { createHash } from "node:crypto";
import { excerptSource } from "./source-excerpt";
import { getGitHubApiHeaders } from "../github-auth";
import type { GithubData, SourceBlob } from "./github";
import {
  MAX_REFERENCE_FILES,
  MAX_SOURCE_CHARACTERS,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  isArchitectureSource,
  isManifestPath,
} from "./repository-context";
import { createReferenceResolver } from "./source-references";

interface SourceExcerpt {
  path: string;
  text: string;
  truncated: boolean;
}
export interface SourceContext {
  text: string;
  /** Files excerpted for the model. */
  paths: string[];
  /** Every file read in full: the excerpted ones and the reference-only ones. */
  readPaths?: string[];
  /** For each file read, the repository files it imports or names. */
  references?: Record<string, string[]>;
  unavailableCount: number;
}

// Parallel reads; the CDN serves public files without spending API quota.
const READ_CONCURRENCY = 6;
// Ranked files read in the first round beside the excerpt picks; the rest of
// the reference budget follows what those files import.
const FIRST_ROUND_REFERENCE_FILES = 12;
// The index is carved out of the excerpt budget, so the prompt does not grow.
const MAX_SOURCE_INDEX_CHARACTERS = 9_000;
const MAX_REFERENCES_SHOWN = 16;
const MAX_CORE_MODULES = 16;
// Widely imported for their declarations, not their behavior.
const SUPPORTING_FILE =
  /(?:^|\/)(?:types?|index|mod|__init__|constants?|utils?|helpers?|errors?|[^/]*Error)\.[^/]+$|\.d\.ts$/i;

/** A file that mostly re-exports or declares other modules. */
function isReexportBarrel(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:\/\/|#|\*|\/\*)/.test(line));
  if (!lines.length) return true;
  const declarations = lines.filter((line) =>
    /^(?:export\s+(?:\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s|export\s+\*\s+as\s|(?:pub(?:\([^)]*\))?\s+)?(?:mod|use)\s|from\s+\.\S*\s+import\s)/.test(
      line,
    ),
  ).length;
  return declarations / lines.length >= 0.6;
}

type IndexEntry = {
  path: string;
  size?: number;
  status: "excerpt" | "read" | "not read";
  references?: string[];
};

function formatSize(size: number | undefined): string {
  if (size === undefined) return "";
  return size < 10_000
    ? `${Math.max(0.1, Math.round(size / 100) / 10)} KB, `
    : `${Math.round(size / 1000)} KB, `;
}

/**
 * A compact map of the files that matter most: which were excerpted, which
 * were read only for their references, and which exist but were not read. It
 * tells the model which core modules exist (so they are not dropped) and which
 * connections GitDiagram actually saw in the code (so edges can be cited).
 */
export function formatSourceIndex(
  entries: IndexEntry[],
  budget = MAX_SOURCE_INDEX_CHARACTERS,
  core: string[] = [],
): string {
  if (!entries.length) return "";
  const header = [
    "SOURCE INDEX (computed by GitDiagram from the repository files, not written by a model)",
    'Each line: path (size, how it was used) -> repository files it imports or names anywhere in its full text, including parts not excerpted below. "excerpt": excerpted below. "read": read in full, not excerpted. "not read": never opened, so its contents and connections are unknown. Lists miss dynamic, HTTP, event and configuration wiring.',
    ...(core.length
      ? [
          `CORE MODULES (the largest and most used files; give each a node, alone or as part of its subsystem's node): ${core.join(", ")}`,
        ]
      : []),
  ].join("\n");
  const footer = "END SOURCE INDEX";
  const lines: Array<{ path: string; line: string }> = [];
  let characters = header.length + footer.length + 2;
  for (const entry of entries) {
    let line = `${entry.path} (${formatSize(entry.size)}${entry.status})`;
    if (entry.references) {
      const shown = entry.references.slice(0, MAX_REFERENCES_SHOWN);
      const more = entry.references.length - shown.length;
      line += shown.length
        ? ` -> ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`
        : " -> none found";
    }
    if (characters + line.length + 1 > budget) continue;
    lines.push({ path: entry.path, line });
    characters += line.length + 1;
  }
  lines.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [header, ...lines.map((entry) => entry.line), footer].join("\n");
}

// Source reads never follow a redirect: `redirect: "manual"` hands a 3xx back
// as a response that is not `ok`, which every read treats as "no file".
// (`redirect: "error"` meant the same on Node, but Cloudflare Workers rejects
// that option with a TypeError: every diagram made there read no source files
// at all until this was changed.)
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
      redirect: "manual",
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
    redirect: "manual",
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
  /** Read in full only for the source index's reference lists. */
  referencePaths?: string[];
  /** Listed in the source index by name and size, never read. */
  listedPaths?: string[];
  githubPat?: string;
  signal?: AbortSignal;
}): Promise<SourceContext> {
  params.signal?.throwIfAborted();
  if (params.githubData.isPrivate && !params.githubPat?.trim())
    throw new Error(
      "A GitHub token is required to analyze a private repository.",
    );
  const excerptTarget = params.selectedPaths
    .filter(isArchitectureSource)
    .slice(0, MAX_SOURCE_FILES);
  const excerptCandidates = new Set(excerptTarget);
  // The ranked reading list: the files picked for excerpts, then the next
  // ranked ones. Callers that pass no reference paths read only their picks.
  const ranked = [...excerptTarget];
  const rankedSet = new Set(ranked);
  for (const path of params.referencePaths ?? []) {
    if (ranked.length >= MAX_SOURCE_FILES + MAX_REFERENCE_FILES) break;
    if (!isArchitectureSource(path) || rankedSet.has(path)) continue;
    ranked.push(path);
    rankedSet.add(path);
  }
  const readBudget = params.referencePaths
    ? MAX_SOURCE_FILES + MAX_REFERENCE_FILES
    : ranked.length;
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
      readPaths: [],
      references: {},
      unavailableCount: excerptTarget.length,
    };
  const headers = params.githubData.isPrivate
    ? await getGitHubApiHeaders({ githubPat: params.githubPat })
    : {};
  const texts = new Map<string, string>();
  let changedSourceRecoveries = 0;
  const readAll = async (paths: string[]) => {
    let next = 0;
    await Promise.all(
      Array.from({ length: READ_CONCURRENCY }, async () => {
        while (next < paths.length && !signal.aborted) {
          const path = paths[next++]!;
          const blob = params.githubData.sourceBlobs?.get(path);
          if (
            !blob ||
            blob.size > MAX_SOURCE_FILE_BYTES ||
            !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(blob.sha)
          )
            continue;
          try {
            let source: SourceExcerpt | "changed" | null;
            if (params.githubData.isPrivate) {
              source = await readBlob({
                ...params,
                path,
                blob,
                headers,
                signal,
              });
            } else {
              source = await readPublicSource({
                ...params,
                branch: params.githubData.defaultBranch,
                path,
                blob,
                signal,
              });
              // A fresh commit or stale CDN entry can hide the most important
              // file. Recover its immutable blob with at most two REST reads,
              // inside the same ingestion deadline. Ordinary CDN failures do
              // not fan out into a dozen quota-consuming API requests, and
              // reference-only files are never worth a recovery.
              if (source === "changed")
                source =
                  excerptCandidates.has(path) && changedSourceRecoveries++ < 2
                    ? await readBlob({
                        ...params,
                        path,
                        blob,
                        signal,
                        headers: await getGitHubApiHeaders({
                          githubPat: params.githubData.usedPublicFallback
                            ? undefined
                            : params.githubPat,
                        }),
                      })
                    : null;
            }
            if (source) texts.set(path, source.text);
          } catch {
            params.signal?.throwIfAborted();
          }
        }
      }),
    );
  };
  const resolveReferences = createReferenceResolver(
    params.githubData.pathTypes,
  );
  const references: Record<string, string[]> = {};
  const indexReferences = () => {
    for (const [path, text] of texts)
      references[path] ??= resolveReferences(path, text);
  };
  // First the excerpt picks and the best-ranked others; then the files what
  // was read depends on most, which name-based ranking cannot know about.
  const firstRound = ranked.slice(
    0,
    Math.min(readBudget, MAX_SOURCE_FILES + FIRST_ROUND_REFERENCE_FILES),
  );
  await readAll(firstRound);
  params.signal?.throwIfAborted();
  indexReferences();
  const position = new Map(ranked.map((path, index) => [path, index]));
  const dependedOn = new Map<string, number>();
  for (const list of Object.values(references))
    for (const path of list)
      if (
        !texts.has(path) &&
        params.githubData.pathTypes.get(path) === "blob" &&
        isArchitectureSource(path)
      )
        dependedOn.set(path, (dependedOn.get(path) ?? 0) + 1);
  const followed = [...dependedOn]
    .sort(
      ([a, aCount], [b, bCount]) =>
        bCount - aCount ||
        (position.get(a) ?? Infinity) - (position.get(b) ?? Infinity) ||
        (a < b ? -1 : a > b ? 1 : 0),
    )
    .map(([path]) => path);
  const secondRound = [
    ...new Set([...followed, ...ranked.slice(firstRound.length)]),
  ].slice(0, Math.max(0, readBudget - firstRound.length));
  if (secondRound.length && !signal.aborted) {
    await readAll(secondRound);
    params.signal?.throwIfAborted();
    indexReferences();
  }
  const readOrder = [...firstRound, ...secondRound].filter((path) =>
    texts.has(path),
  );
  const readSet = new Set(readOrder);
  // Excerpt the files the others connect through. A file that neither uses
  // nor is used by anything read (a stray script) gives up its excerpt,
  // unless nothing read is connected at all (a language without resolvable
  // references) or it is the manifest.
  const usedBy = new Map<string, number>();
  for (const path of readOrder)
    for (const target of references[path] ?? [])
      if (readSet.has(target) && target !== path)
        usedBy.set(target, (usedBy.get(target) ?? 0) + 1);
  const degree = (path: string) =>
    Math.min(8, usedBy.get(path) ?? 0) * 4 +
    Math.min(8, references[path]?.length ?? 0);
  const connected = readOrder.some((path) => degree(path) > 0);
  // Name-based rank still matters, but a file many others use outranks one
  // picked for its name (a crawled file ranks last by name).
  const priority = (path: string) =>
    -0.4 * (position.get(path) ?? ranked.length) +
    degree(path) -
    (connected && !degree(path) && !isManifestPath(path) ? 15 : 0);
  const excerptSet = new Set(
    [...readOrder]
      .sort((a, b) => priority(b) - priority(a))
      .slice(0, excerptTarget.length),
  );
  const available: SourceExcerpt[] = readOrder
    .filter((path) => excerptSet.has(path))
    .map((path) => ({ path, text: texts.get(path)!, truncated: false }));
  const size = (path: string) => params.githubData.sourceBlobs?.get(path)?.size;
  // A short checklist of core modules: files others use, or large ones,
  // excluding strays and the manifest. A model given only "cover the main
  // modules" drops small but real ones (a proxy's URL canonicalizer).
  const usedUnread = new Map<string, number>();
  for (const path of readOrder)
    for (const target of references[path] ?? [])
      if (
        !readSet.has(target) &&
        params.githubData.pathTypes.get(target) === "blob" &&
        isArchitectureSource(target)
      )
        usedUnread.set(target, (usedUnread.get(target) ?? 0) + 1);
  const coreScore = (path: string) =>
    3 *
      Math.min(
        4,
        (readSet.has(path) ? usedBy.get(path) : usedUnread.get(path)) ?? 0,
      ) +
    Math.min(6, Math.log2(1 + (size(path) ?? 0) / 1000));
  const core = [...readOrder, ...usedUnread.keys()]
    .filter(
      (path) =>
        !isManifestPath(path) &&
        !SUPPORTING_FILE.test(path) &&
        !(texts.has(path) && isReexportBarrel(texts.get(path)!)) &&
        !(connected && readSet.has(path) && !degree(path)),
    )
    .map((path) => ({ path, score: coreScore(path) }))
    .filter((entry) => entry.score >= 3)
    .sort(
      (a, b) =>
        b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .slice(0, MAX_CORE_MODULES)
    .map((entry) => entry.path)
    .sort();
  const index = formatSourceIndex(
    [
      ...readOrder.map((path) => ({
        path,
        size: size(path),
        status: excerptSet.has(path) ? ("excerpt" as const) : ("read" as const),
        references: references[path],
      })),
      // Unread files that read ones depend on are core modules too.
      ...[
        ...new Set([
          ...ranked,
          ...followed,
          ...readOrder.flatMap((path) => references[path] ?? []),
          ...(params.listedPaths ?? []),
        ]),
      ]
        .filter(
          (path) =>
            !readSet.has(path) &&
            params.githubData.pathTypes.get(path) === "blob" &&
            isArchitectureSource(path),
        )
        .map((path) => ({
          path,
          size: size(path),
          status: "not read" as const,
        })),
    ],
    MAX_SOURCE_INDEX_CHARACTERS,
    core,
  );
  // Fair excerpts preserve coverage of every selected subsystem, not just the
  // first long file. Clearly mark omitted bodies; absence never proves no edge.
  const limits = available.map(() => 0);
  let remaining = MAX_SOURCE_CHARACTERS - 4000 - index.length;
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
  const body = excerpts.length
    ? excerpts.join("\n\n")
    : "No source excerpts available. Use documented relationships only.";
  return {
    text: (index ? `${index}\n\n${body}` : body).slice(
      0,
      MAX_SOURCE_CHARACTERS,
    ),
    paths: available.map((entry) => entry.path),
    readPaths: readOrder,
    references: Object.fromEntries(
      readOrder.map((path) => [path, references[path] ?? []]),
    ),
    unavailableCount: excerptTarget.length - available.length,
  };
}
