import { toRepoKey, type BrowseIndexEntry } from "~/features/browse/catalog";
import { upstashCommand, upstashEval } from "./upstash";

const PENDING_BROWSE_INDEX_KEY = "pending:v1:public-browse-index";

const UPSERT_PENDING_BROWSE_ENTRY_SCRIPT = `
local existing = redis.call("HGET", KEYS[1], ARGV[1])
if existing then
  local separator = string.find(existing, "|", 1, true)
  if separator then
    local existing_sort_key = string.sub(existing, 1, separator - 1)
    if existing_sort_key >= ARGV[2] then
      return 0
    end
  end
end
redis.call("HSET", KEYS[1], ARGV[1], ARGV[3])
return 1
`;

const ACKNOWLEDGE_PENDING_BROWSE_ENTRIES_SCRIPT = `
local removed = 0
for index = 1, #ARGV, 2 do
  local field = ARGV[index]
  local expected = ARGV[index + 1]
  if redis.call("HGET", KEYS[1], field) == expected then
    removed = removed + redis.call("HDEL", KEYS[1], field)
  end
end
return removed
`;

export interface PendingBrowseIndexEntry {
  field: string;
  serialized: string;
  entry: BrowseIndexEntry;
}

function createPendingSortKey(entry: BrowseIndexEntry): string {
  const timestamp = Date.parse(entry.lastSuccessfulAt);
  const timestampKey = String(
    Number.isFinite(timestamp) ? timestamp : 0,
  ).padStart(13, "0");
  const metadataKey = entry.stargazerCount === null ? "0" : "1";
  return `${timestampKey}:${metadataKey}`;
}

function serializePendingEntry(entry: BrowseIndexEntry): string {
  return `${createPendingSortKey(entry)}|${JSON.stringify(entry)}`;
}

function isBrowseIndexEntry(value: unknown): value is BrowseIndexEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<BrowseIndexEntry>;
  return (
    typeof candidate.username === "string" &&
    typeof candidate.repo === "string" &&
    typeof candidate.lastSuccessfulAt === "string" &&
    (candidate.stargazerCount === null ||
      typeof candidate.stargazerCount === "number")
  );
}

export async function enqueuePendingBrowseIndexEntry(
  entry: BrowseIndexEntry,
): Promise<void> {
  const field = toRepoKey(entry);
  const serialized = serializePendingEntry(entry);
  await upstashEval<number>({
    script: UPSERT_PENDING_BROWSE_ENTRY_SCRIPT,
    keys: [PENDING_BROWSE_INDEX_KEY],
    args: [field, createPendingSortKey(entry), serialized],
  });
}

export async function readPendingBrowseIndexEntries(): Promise<
  PendingBrowseIndexEntry[]
> {
  const values = await upstashCommand<string[]>([
    "HGETALL",
    PENDING_BROWSE_INDEX_KEY,
  ]);
  const pending: PendingBrowseIndexEntry[] = [];

  for (let index = 0; index < values.length; index += 2) {
    const field = values[index];
    const serialized = values[index + 1];
    const separator = serialized?.indexOf("|") ?? -1;
    if (!field || !serialized || separator < 0) {
      continue;
    }

    try {
      const entry = JSON.parse(serialized.slice(separator + 1)) as unknown;
      if (!isBrowseIndexEntry(entry)) {
        throw new Error("Invalid browse index entry.");
      }
      pending.push({
        field,
        serialized,
        entry,
      });
    } catch {
      console.error(
        JSON.stringify({
          event: "browse.index.pending_entry_invalid",
          field,
        }),
      );
    }
  }

  return pending;
}

export async function acknowledgePendingBrowseIndexEntries(
  pending: PendingBrowseIndexEntry[],
): Promise<void> {
  if (!pending.length) {
    return;
  }

  await upstashEval<number>({
    script: ACKNOWLEDGE_PENDING_BROWSE_ENTRIES_SCRIPT,
    keys: [PENDING_BROWSE_INDEX_KEY],
    args: pending.flatMap(({ field, serialized }) => [field, serialized]),
  });
}
