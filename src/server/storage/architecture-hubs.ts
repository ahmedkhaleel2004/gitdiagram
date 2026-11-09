import {
  buildHubs,
  candidatesToRead,
  hubCandidates,
  repositoryFacts,
  repositoryKey,
  type HubCandidate,
  type HubDetails,
  type HubIndex,
  type HubPage,
  type RepositoryDetail,
} from "~/features/architecture-hubs/hubs";
import { explanationSummary } from "~/features/diagram/readout";
import { storedExplanationText } from "~/features/diagram/legacy-explanation";
import { readRequiredEnv } from "./config";
import { readBrowseIndex } from "./browse-diagrams";
import { getPublicLocation } from "./cache-key";
import { getGzipJsonObject, getJsonObject, putGzipJsonObject } from "./r2";
import type { DiagramArtifact } from "./types";

// The architecture hubs' objects in the public bucket
// (features/architecture-hubs/hubs.ts says what they hold). Rebuilt once a day
// by the cron route /api/internal/architecture-hubs, which may load the whole
// browse index; pages read only the index object and their own page.

const PREFIX = "public/v1/_meta/hubs/v1/";
const INDEX_KEY = `${PREFIX}index.json.gz`;
const DETAILS_KEY = `${PREFIX}details.json.gz`;
const READ_CONCURRENCY = 8;
const WRITE_CONCURRENCY = 8;

const pageKey = (slug: string, page: number) =>
  `${PREFIX}pages/${slug}/${page}.json.gz`;

const bucket = () => readRequiredEnv("R2_PUBLIC_BUCKET");

export function readHubIndex(): Promise<HubIndex | null> {
  return getGzipJsonObject<HubIndex>(bucket(), INDEX_KEY);
}

export function readHubPage(
  slug: string,
  page: number,
): Promise<HubPage | null> {
  return getGzipJsonObject<HubPage>(bucket(), pageKey(slug, page));
}

/** What a hub keeps from one stored diagram. */
function repositoryDetail(
  candidate: HubCandidate,
  artifact: DiagramArtifact | null,
): RepositoryDetail {
  if (!artifact || artifact.visibility !== "public") {
    return { at: candidate.at, missing: true };
  }
  const description = artifact.explanation
    ? explanationSummary(storedExplanationText(artifact.explanation), 180)
    : null;
  return {
    at: candidate.at,
    ...(description ? { d: description } : {}),
    ...(artifact.graph?.nodes.length
      ? { facts: repositoryFacts(artifact.graph) }
      : {}),
  };
}

async function readDetails(
  queue: HubCandidate[],
  details: HubDetails["repositories"],
  deadline: number,
): Promise<number> {
  let read = 0;
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline) return;
      const candidate = queue.shift();
      if (!candidate) return;
      const location = getPublicLocation(candidate.owner, candidate.repo);
      const artifact = await getJsonObject<DiagramArtifact>(
        location.bucket,
        location.artifactKey,
      ).catch(() => undefined);
      // A failed read is tried again tomorrow; only a missing object counts.
      if (artifact === undefined) continue;
      details[repositoryKey(candidate.owner, candidate.repo)] =
        repositoryDetail(candidate, artifact);
      read += 1;
    }
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
  return read;
}

export interface HubRebuildOptions {
  /** At most this many stored diagrams are read (new or made again). */
  maxReads?: number;
  /** Stop reading after this many milliseconds; the rest waits a day. */
  readBudgetMs?: number;
}

/**
 * Reads the stored diagrams that are new to the hubs or were made again
 * (most stars first, within the budget), then rewrites every hub page and
 * the index. Returns what it did.
 */
export async function rebuildArchitectureHubs(
  options: HubRebuildOptions = {},
): Promise<{
  candidates: number;
  read: number;
  waiting: number;
  hubs: number;
  pages: number;
}> {
  const { maxReads = 2_500, readBudgetMs = 60_000 } = options;
  const started = Date.now();
  // Only the candidates are kept: the index itself is dropped before the
  // diagrams are read.
  const candidates = await (async () => {
    const entries = await readBrowseIndex();
    if (!entries) throw new Error("Browse index missing.");
    return hubCandidates(entries);
  })();

  const stored = await getGzipJsonObject<HubDetails>(bucket(), DETAILS_KEY);
  const previous = stored?.version === 1 ? stored.repositories : {};
  // Keep only repositories that are still candidates.
  const details: HubDetails["repositories"] = {};
  for (const candidate of candidates) {
    const key = repositoryKey(candidate.owner, candidate.repo);
    const detail = previous[key];
    if (detail) details[key] = detail;
  }

  const toRead = candidatesToRead(candidates, details).slice(0, maxReads);
  const read = await readDetails([...toRead], details, started + readBudgetMs);
  const waiting = candidatesToRead(candidates, details).length;

  const updatedAt = new Date().toISOString();
  const hubs = buildHubs(candidates, details);
  const writes: Array<[string, unknown]> = [
    [DETAILS_KEY, { version: 1, updatedAt, repositories: details }],
  ];
  for (const hub of hubs) {
    hub.pages.forEach((items, index) => {
      const page: HubPage = {
        version: 1,
        updatedAt,
        slug: hub.summary.slug,
        page: index + 1,
        items,
      };
      writes.push([pageKey(hub.summary.slug, index + 1), page]);
    });
  }
  for (let start = 0; start < writes.length; start += WRITE_CONCURRENCY) {
    await Promise.all(
      writes
        .slice(start, start + WRITE_CONCURRENCY)
        .map(([key, payload]) => putGzipJsonObject(bucket(), key, payload)),
    );
  }
  // The index last: it names only pages that now exist.
  const index: HubIndex = {
    version: 1,
    updatedAt,
    candidates: candidates.length,
    hubs: hubs.map((hub) => hub.summary),
  };
  await putGzipJsonObject(bucket(), INDEX_KEY, index);
  return {
    candidates: candidates.length,
    read,
    waiting,
    hubs: hubs.length,
    pages: writes.length - 1,
  };
}
