/**
 * Step 1 of the architecture report (/open-source-architecture-2026).
 * Read-only: it never writes to R2, Redis or GitHub.
 *
 * Reads the public browse index, picks the most-starred repositories that have
 * a stored public diagram, downloads each one's public artifact (only the
 * public namespace, `public/v1/...`, is ever read) and asks GitHub for each
 * repository's current stars, primary language and archived/fork flags. Raw
 * files go to a local cache folder that is never committed.
 *
 *   R2_* settings in the environment, `gh` signed in, then:
 *   bun run report:fetch --out <cache-dir> [--candidates 1600]
 *
 * Then run compute.ts on the same folder.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { readBrowseIndex } from "../../src/server/storage/browse-diagrams";
import { getPublicLocation } from "../../src/server/storage/cache-key";
import { getJsonObject } from "../../src/server/storage/r2";
import type { DiagramArtifact } from "../../src/server/storage/types";

function flag(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const outDir = path.resolve(flag("out"));
const candidateCount = Number(flag("candidates", "1600"));
const artifactDir = path.join(outDir, "artifacts");
await mkdir(artifactDir, { recursive: true });

const index = await readBrowseIndex();
if (!index) throw new Error("Browse index not found.");
const candidates = index
  .filter((entry) => typeof entry.stargazerCount === "number")
  .sort((a, b) => (b.stargazerCount ?? 0) - (a.stargazerCount ?? 0))
  .slice(0, candidateCount);
await writeFile(
  path.join(outDir, "index-summary.json"),
  JSON.stringify(
    {
      readAt: new Date().toISOString(),
      indexEntries: index.length,
      withStars: index.filter((e) => typeof e.stargazerCount === "number")
        .length,
      candidates,
    },
    null,
    1,
  ),
);
console.log(`index ${index.length} entries; ${candidates.length} candidates`);

function artifactFile(username: string, repo: string) {
  return path.join(
    artifactDir,
    `${encodeURIComponent(username)}__${encodeURIComponent(repo)}.json`,
  );
}

let done = 0;
const queue = [...candidates];
async function worker() {
  for (;;) {
    const entry = queue.shift();
    if (!entry) return;
    const file = artifactFile(entry.username, entry.repo);
    if (!existsSync(file)) {
      const location = getPublicLocation(entry.username, entry.repo);
      if (location.visibility !== "public") throw new Error("not public");
      const artifact = await getJsonObject<DiagramArtifact>(
        location.bucket,
        location.artifactKey,
      ).catch(() => null);
      if (artifact && artifact.visibility === "public") {
        // Keep only what the report reads.
        const kept = {
          username: artifact.username,
          repo: artifact.repo,
          stargazerCount: artifact.stargazerCount,
          graph: artifact.graph,
          generatedAt: artifact.generatedAt,
          lastSuccessfulAt: artifact.lastSuccessfulAt,
          sourcePaths: artifact.latestSessionSummary?.sourcePaths ?? [],
        };
        await writeFile(file, JSON.stringify(kept));
      } else {
        await writeFile(file, "null");
      }
    }
    done += 1;
    if (done % 100 === 0) console.log(`artifacts ${done}/${candidates.length}`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

// GitHub metadata, 50 repositories per GraphQL call.
const githubFile = path.join(outDir, "github.json");
const github: Record<string, unknown> = existsSync(githubFile)
  ? JSON.parse(await readFile(githubFile, "utf8"))
  : {};
const missing = candidates.filter(
  (e) => !(`${e.username}/${e.repo}` in github),
);
for (let i = 0; i < missing.length; i += 50) {
  const batch = missing.slice(i, i + 50);
  const fields = batch
    .map(
      (e, n) =>
        `r${n}: repository(owner: ${JSON.stringify(e.username)}, name: ${JSON.stringify(e.repo)}) { nameWithOwner stargazerCount isArchived isFork createdAt primaryLanguage { name } }`,
    )
    .join("\n");
  let data: Record<string, unknown> = {};
  try {
    const raw = execFileSync(
      "gh",
      ["api", "graphql", "-f", `query=query { ${fields} }`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    data = JSON.parse(raw).data ?? {};
  } catch (error) {
    // Renamed or deleted repositories make GraphQL return partial data with
    // errors; gh exits non-zero but still prints the body.
    const stdout = (error as { stdout?: string }).stdout;
    data = stdout ? (JSON.parse(stdout).data ?? {}) : {};
  }
  batch.forEach((e, n) => {
    github[`${e.username}/${e.repo}`] = data[`r${n}`] ?? null;
  });
  console.log(`github ${Math.min(i + 50, missing.length)}/${missing.length}`);
}
await writeFile(githubFile, JSON.stringify(github));
console.log("done");
