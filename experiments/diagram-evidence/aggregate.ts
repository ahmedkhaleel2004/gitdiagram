/**
 * One table from score.ts output and judge.ts verdicts, per repository and
 * label, summed over runs. "Invented" is an edge the blind judge found
 * unsupported or contradicted; solid ones are the harmful kind (a dashed edge
 * already tells the reader it is unverified or optional).
 *
 *   bun experiments/diagram-evidence/aggregate.ts before after
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const labels = process.argv.slice(2);
const scores = JSON.parse(
  await readFile(`/tmp/eval-diagrams/score-${labels.join("-")}.json`, "utf8"),
) as Array<{
  repo: string;
  label: string;
  run: string;
  covered: number;
  modules: number;
}>;

type Totals = {
  runs: number;
  covered: number;
  modules: number;
  edges: number;
  solid: number;
  cited: number;
  invented: number;
  inventedSolid: number;
  contradicted: number;
};
const table = new Map<string, Totals>();
for (const label of labels) {
  const root = join("/tmp/eval-diagrams", label);
  for (const run of (await readdir(root)).sort()) {
    let graph: {
      edges: Array<{ style: string | null; evidencePath?: string | null }>;
    };
    let judge: { verdicts: Array<{ edge: number; verdict: string }> };
    try {
      graph = JSON.parse(await readFile(join(root, run, "graph.json"), "utf8"));
      judge = JSON.parse(await readFile(join(root, run, "judge.json"), "utf8"));
    } catch {
      continue;
    }
    const score = scores.find(
      (entry) => entry.label === label && entry.run === run,
    );
    if (!score) continue;
    const key = `${score.repo}\t${label}`;
    const totals = table.get(key) ?? {
      runs: 0,
      covered: 0,
      modules: 0,
      edges: 0,
      solid: 0,
      cited: 0,
      invented: 0,
      inventedSolid: 0,
      contradicted: 0,
    };
    totals.runs++;
    totals.covered += score.covered;
    totals.modules += score.modules;
    totals.edges += graph.edges.length;
    totals.solid += graph.edges.filter(
      (edge) => edge.style !== "dashed",
    ).length;
    totals.cited += graph.edges.filter((edge) => edge.evidencePath).length;
    for (const verdict of judge.verdicts) {
      if (verdict.verdict === "supported") continue;
      totals.invented++;
      if (verdict.verdict === "contradicted") totals.contradicted++;
      if (graph.edges[verdict.edge]?.style !== "dashed") totals.inventedSolid++;
    }
    table.set(key, totals);
  }
}
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((100 * part) / whole)}%` : "-";
console.info(
  "| Repo | Version | Runs | Core modules covered | Edges | Cited | Not backed by code (all) | Not backed, solid arrows | Contradicted |",
);
console.info("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const all = new Map<string, Totals>();
for (const [key, totals] of table) {
  const [repo, label] = key.split("\t") as [string, string];
  console.info(
    `| ${repo} | ${label} | ${totals.runs} | ${totals.covered}/${totals.modules} (${percent(totals.covered, totals.modules)}) | ${totals.edges} | ${percent(totals.cited, totals.edges)} | ${totals.invented} (${percent(totals.invented, totals.edges)}) | ${totals.inventedSolid} (${percent(totals.inventedSolid, totals.solid)} of solid) | ${totals.contradicted} |`,
  );
  const sum = all.get(label) ?? {
    ...totals,
    runs: 0,
    covered: 0,
    modules: 0,
    edges: 0,
    solid: 0,
    cited: 0,
    invented: 0,
    inventedSolid: 0,
    contradicted: 0,
  };
  for (const field of Object.keys(sum) as Array<keyof Totals>)
    sum[field] += totals[field];
  all.set(label, sum);
}
for (const [label, totals] of all)
  console.info(
    `| **All** | ${label} | ${totals.runs} | ${totals.covered}/${totals.modules} (${percent(totals.covered, totals.modules)}) | ${totals.edges} | ${percent(totals.cited, totals.edges)} | ${totals.invented} (${percent(totals.invented, totals.edges)}) | ${totals.inventedSolid} (${percent(totals.inventedSolid, totals.solid)} of solid) | ${totals.contradicted} |`,
  );
