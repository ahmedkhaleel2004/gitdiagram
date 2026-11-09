/**
 * Builds the data behind /most-starred-repositories: the most-starred GitHub
 * repositories that have a current public diagram on GitDiagram, with the
 * first sentences of each diagram's explanation. Read-only: it reads GitHub's
 * search API (through `gh`) and the public namespace of R2, and writes only
 * src/features/popular-repos/data.json.
 *
 *   R2_* settings in the environment, `gh` signed in, then:
 *   bun run popular:build [--count 1000]
 *
 * Re-run it (and commit the JSON) after a batch of new diagrams.
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { explanationSummary } from "../../src/features/diagram/readout";
import { storedExplanationText } from "../../src/features/diagram/legacy-explanation";
import { getPublicDiagramArtifact } from "../../src/server/storage/artifact-store";
import type { PopularRepository } from "../../src/features/popular-repos/content";

const countIndex = process.argv.indexOf("--count");
const count = countIndex >= 0 ? Number(process.argv[countIndex + 1]) : 1000;

type SearchItem = {
  full_name: string;
  stargazers_count: number;
  fork: boolean;
  language: string | null;
};

// GitHub's search answers at most 1,000 results per query, so the second
// query starts at the lowest star count of the first.
function search(query: string): SearchItem[] {
  const items: SearchItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const out = execFileSync(
      "gh",
      [
        "api",
        "-X",
        "GET",
        "search/repositories",
        "-f",
        `q=${query}`,
        "-f",
        "sort=stars",
        "-f",
        "order=desc",
        "-f",
        "per_page=100",
        "-f",
        `page=${page}`,
        "--jq",
        ".items",
      ],
      { encoding: "utf8" },
    );
    const batch = JSON.parse(out) as SearchItem[];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

const first = search("stars:>1000");
const floor = first.at(-1)?.stargazers_count ?? 1000;
const seen = new Set<string>();
const ranked = [...first, ...search(`stars:1000..${floor}`)]
  .filter((item) => {
    const key = item.full_name.toLowerCase();
    if (item.fork || seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => b.stargazers_count - a.stargazers_count);

const entries: PopularRepository[] = [];
let missing = 0;
let old = 0;
let next = 0;
async function worker() {
  for (;;) {
    const item = ranked[next++];
    if (!item) return;
    const [owner, repo] = item.full_name.toLowerCase().split("/") as [
      string,
      string,
    ];
    const artifact = await getPublicDiagramArtifact(owner, repo);
    if (!artifact) {
      missing++;
      continue;
    }
    // Diagrams from before the graph pipeline are left out until redrawn.
    if (!artifact.graph) {
      old++;
      continue;
    }
    entries.push({
      repository: item.full_name,
      stars: item.stargazers_count,
      language: item.language ?? null,
      summary:
        explanationSummary(storedExplanationText(artifact.explanation), 150) ??
        null,
      updated: artifact.lastSuccessfulAt.slice(0, 10),
    });
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

entries.sort((a, b) => b.stars - a.stars);
const list = entries.slice(0, count);
const out = path.resolve("src/features/popular-repos/data.json");
await writeFile(
  out,
  `${JSON.stringify(
    {
      checked: new Date().toISOString().slice(0, 10),
      githubTopChecked: ranked.length,
      entries: list,
    },
    null,
    1,
  )}\n`,
);
console.log(
  `GitHub top ${ranked.length}: ${entries.length} with a current diagram, ${old} old, ${missing} missing; wrote ${list.length} to ${out}`,
);
