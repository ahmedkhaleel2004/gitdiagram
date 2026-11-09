import { toRepoKey, type BrowseIndexEntry } from "./catalog";

// "More {language} diagrams" under a repository page's readout: a few other
// public diagrams in the same GitHub language, so readers and crawlers can
// walk from one repository page to the next. Built once a day from the whole
// browse index into small shards (the page reads only its own shard, never
// the index: a Worker isolate over 128 MB is killed).

/** Shards in storage: about a thousand repositories each. */
export const RELATED_SHARD_COUNT = 256;
/** Links shown under a page. */
const RELATED_LINK_COUNT = 5;
/** Fewer than this many and the line is left out. */
const RELATED_MIN_LINKS = 3;
/** Only repositories with at least this many stars are linked to. */
const RELATED_MIN_STARS = 10;

export interface RelatedDiagrams {
  language: string;
  /** owner/repo, most stars first. */
  repositories: string[];
}

export interface RelatedShard {
  version: 1;
  updatedAt: string;
  repositories: Record<string, RelatedDiagrams>;
}

/** FNV-1a: stable across runtimes, so the writer and reader agree. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function relatedShardId(repositoryKey: string): string {
  return (hash(repositoryKey.toLowerCase()) % RELATED_SHARD_COUNT)
    .toString(16)
    .padStart(2, "0");
}

interface Candidate {
  key: string;
  stars: number;
}

function byStars(left: Candidate, right: Candidate) {
  return right.stars - left.stars || left.key.localeCompare(right.key);
}

/**
 * Neighbours in the language's star order: a repository with stars links to
 * the ones nearest its own popularity; one below the threshold links to a
 * stable spot picked by its name, so links spread over the whole list
 * instead of all pointing at the same few.
 */
function pickRelated(
  key: string,
  stars: number,
  candidates: Candidate[],
): string[] {
  let position: number;
  if (stars >= RELATED_MIN_STARS) {
    // First candidate that sorts at or after this repository.
    let low = 0;
    let high = candidates.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (byStars(candidates[middle]!, { key, stars }) < 0) low = middle + 1;
      else high = middle;
    }
    position = low;
  } else {
    position = hash(key) % candidates.length;
  }
  const picked: Candidate[] = [];
  for (
    let step = 0;
    picked.length < RELATED_LINK_COUNT &&
    step <= 2 * (RELATED_LINK_COUNT + 1) + 2;
    step++
  ) {
    // position, position-1, position+1, position-2, ...
    const offset = step % 2 === 0 ? step / 2 : -Math.ceil(step / 2);
    const candidate = candidates[position + offset];
    if (candidate && candidate.key !== key && !picked.includes(candidate)) {
      picked.push(candidate);
    }
  }
  return picked.sort(byStars).map((candidate) => candidate.key);
}

/**
 * Every repository's related diagrams, grouped into shards. Repositories with
 * no language, or whose language has too few linkable diagrams, are left out
 * (their page shows nothing).
 */
export function buildRelatedShards(
  entries: readonly BrowseIndexEntry[],
  updatedAt: string,
): Map<string, RelatedShard> {
  const candidatesByLanguage = new Map<string, Candidate[]>();
  for (const entry of entries) {
    // An old name of a renamed repository is never linked to: its page is a
    // duplicate of the current one.
    if (!entry.language || entry.renamed) continue;
    const stars = entry.stargazerCount ?? 0;
    if (stars < RELATED_MIN_STARS) continue;
    const list = candidatesByLanguage.get(entry.language) ?? [];
    list.push({ key: toRepoKey(entry), stars });
    candidatesByLanguage.set(entry.language, list);
  }
  for (const list of candidatesByLanguage.values()) list.sort(byStars);

  const shards = new Map<string, RelatedShard>();
  for (const entry of entries) {
    if (!entry.language) continue;
    const candidates = candidatesByLanguage.get(entry.language);
    if (!candidates) continue;
    const key = toRepoKey(entry);
    const repositories = pickRelated(
      key,
      entry.stargazerCount ?? 0,
      candidates,
    );
    if (repositories.length < RELATED_MIN_LINKS) continue;
    const id = relatedShardId(key);
    let shard = shards.get(id);
    if (!shard) {
      shard = { version: 1, updatedAt, repositories: {} };
      shards.set(id, shard);
    }
    shard.repositories[key] = { language: entry.language, repositories };
  }
  return shards;
}

/** A shard's answer for one repository, checked (it comes from storage). */
export function relatedFromShard(
  shard: RelatedShard | null,
  repositoryKey: string,
): RelatedDiagrams | null {
  const value = shard?.repositories?.[repositoryKey.toLowerCase()];
  if (
    !value ||
    typeof value.language !== "string" ||
    !Array.isArray(value.repositories)
  ) {
    return null;
  }
  const repositories = value.repositories.filter(
    (repository): repository is string =>
      typeof repository === "string" &&
      /^[a-z0-9][a-z0-9-]*\/(?!\.\.?$)[a-z0-9_.-]+$/.test(repository),
  );
  return repositories.length >= RELATED_MIN_LINKS
    ? {
        language: value.language,
        repositories: repositories.slice(0, RELATED_LINK_COUNT),
      }
    : null;
}

/**
 * The shard to write: the new lists, plus every list the stored shard had for
 * a repository that is still in the index but has none now (its language not
 * known yet, or a smaller pool). A refresh can only add or replace lists,
 * never make a page lose its line; a repository that left the index drops out.
 */
export function mergeRelatedShard(
  fresh: RelatedShard | undefined,
  stored: RelatedShard | null,
  indexed: ReadonlySet<string>,
  updatedAt: string,
): RelatedShard {
  const repositories: Record<string, RelatedDiagrams> = {};
  for (const [key, value] of Object.entries(stored?.repositories ?? {})) {
    if (indexed.has(key) && relatedFromShard(stored, key)) {
      repositories[key] = value;
    }
  }
  Object.assign(repositories, fresh?.repositories ?? {});
  return { version: 1, updatedAt, repositories };
}
