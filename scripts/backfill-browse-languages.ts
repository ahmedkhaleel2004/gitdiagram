/**
 * One-off: gives the browse index entries made before it kept languages
 * their GitHub primary language, then rebuilds the "More {language} diagrams"
 * shards. Reads GitHub's GraphQL API 100 repositories per query with
 * GITHUB_PAT; touches only the public browse index (languages are added,
 * nothing is removed) and the related shards. Needs the R2, Upstash and
 * GITHUB_PAT settings in the environment. Dry run unless --apply.
 *
 *   bun run browse:backfill-languages --cache /tmp/languages.json [--limit N] [--apply]
 *
 * The cache file keeps what GitHub answered, so a rerun resumes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { toRepoKey } from "../src/features/browse/catalog";
import {
  applyBrowseIndexLanguages,
  readBrowseIndex,
} from "../src/server/storage/browse-diagrams";
import { rebuildRelatedDiagrams } from "../src/server/storage/related-diagrams";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const cacheArgument = args[args.indexOf("--cache") + 1];
if (!args.includes("--cache") || !cacheArgument) {
  console.error(
    "Usage: bun scripts/backfill-browse-languages.ts --cache FILE [--limit N] [--apply]",
  );
  process.exit(1);
}
const cachePath: string = cacheArgument;
const token = process.env.GITHUB_PAT?.trim();
if (!token) throw new Error("GITHUB_PAT is not set.");

const BATCH = 100;
// One query at a time, paced: GitHub limits GraphQL by server CPU time
// (about 60 s a minute per user); a 100-repository query takes about 3 s, so
// faster than this trips its secondary limit (403) long before the hourly
// points run out, and the pause leaves room for the site's own GitHub calls.
const CONCURRENCY = 1;
const PAUSE_MS = 2_500;

// key -> language, or "" when GitHub has none (or the repository is gone).
const answered: Record<string, string> = existsSync(cachePath)
  ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, string>)
  : {};

const entries = await readBrowseIndex();
if (!entries) throw new Error("Browse index missing.");
// Most stars first: those are the pages people and crawlers reach, and the
// only ones other pages link to, so a partial run already covers them.
const limitArgument = args.includes("--limit")
  ? Number(args[args.indexOf("--limit") + 1])
  : Number.POSITIVE_INFINITY;
const missing = entries
  .filter((entry) => !entry.language)
  .sort(
    (left, right) => (right.stargazerCount ?? 0) - (left.stargazerCount ?? 0),
  )
  .map(toRepoKey)
  .filter((key) => !(key in answered))
  .slice(0, limitArgument);
console.log(
  `${entries.length} entries, ${entries.filter((e) => e.language).length} with a language, ${missing.length} to ask GitHub.`,
);

async function lookUp(keys: string[], attempt = 1): Promise<void> {
  const fields = keys
    .map((key, index) => {
      const [owner, name] = key.split("/");
      return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { primaryLanguage { name } }`;
    })
    .join("\n");
  let response: Response;
  try {
    response = await fetch("https://api.github.com/graphql", {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "gitdiagram-backfill",
      },
      body: JSON.stringify({ query: `query {\n${fields}\n}` }),
    });
  } catch (error) {
    if (attempt > 8) throw error;
    console.log(`GitHub request failed (${String(error)}); retrying`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    return lookUp(keys, attempt + 1);
  }
  if (!response.ok) {
    if (attempt <= 8 && (response.status >= 500 || response.status === 403)) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait =
        response.headers.get("x-ratelimit-remaining") === "0" && reset
          ? Math.max(1000, reset * 1000 - Date.now() + 1000)
          : retryAfter > 0
            ? retryAfter * 1000
            : attempt * 30_000;
      console.log(
        `GitHub ${response.status}; waiting ${Math.round(wait / 1000)} s: ${(await response.text()).slice(0, 200)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      return lookUp(keys, attempt + 1);
    }
    throw new Error(
      `GitHub GraphQL ${response.status}: ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    data?: Record<string, { primaryLanguage: { name: string } | null } | null>;
  };
  keys.forEach((key, index) => {
    answered[key] = body.data?.[`r${index}`]?.primaryLanguage?.name ?? "";
  });
}

const batches: string[][] = [];
for (let start = 0; start < missing.length; start += BATCH) {
  batches.push(missing.slice(start, start + BATCH));
}
let done = 0;
async function worker() {
  for (let batch = batches.shift(); batch; batch = batches.shift()) {
    await lookUp(batch);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    done += batch.length;
    if (done % 2000 < BATCH) {
      writeFileSync(cachePath, JSON.stringify(answered));
      console.log(`${done} / ${missing.length}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(cachePath, JSON.stringify(answered));

const languages = new Map(
  Object.entries(answered).filter(([, language]) => language),
);
console.log(`${languages.size} repositories have a language on GitHub.`);
if (!apply) {
  console.log("Dry run: pass --apply to write the index and the shards.");
  process.exit(0);
}
console.log(
  `Index entries given a language: ${await applyBrowseIndexLanguages(languages)}`,
);
console.log("Related shards:", await rebuildRelatedDiagrams());
