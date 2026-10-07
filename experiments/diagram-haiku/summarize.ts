/**
 * One table per question from out/runs/<arm>/<run>/{result,graph,judge}.json
 * and out/score.json (score.ts must have run first).
 *
 *   bun experiments/diagram-haiku/summarize.ts <arm> <arm> ...
 *
 * Writes out/summary.md and out/summary.json.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARCHITECTURE_SLOW_RETRY_MS } from "~/server/generate/generation-policy";
import { callCostUsd, type CallUsage } from "./cost";

const arms = process.argv.slice(2);
const OUT = join(import.meta.dir, "out");
const read = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
};

interface Result {
  arm: string;
  repo: string;
  sample: number;
  failure?: string;
  failureDetail?: string;
  firstExplanationMs: number | null;
  explanationCompleteMs: number | null;
  architectureMs?: number;
  totalMs: number;
  wouldTriggerSlowRetry?: boolean;
  costUsd: number;
  attempts: Array<{
    valid: boolean;
    accepted: boolean;
    categories: string[];
    nodes: number;
    nodesWithPath: number;
    edges: number;
    edgesWithEvidenceFromModel: number;
    unknownNodePaths: number;
    unknownEvidencePaths: number;
    evidenceStrippedAsUnseen: number;
    evidenceFilled: number;
  }>;
  calls: Array<CallUsage & { costUsd: number; stage: string }>;
}
type Graph = {
  nodes: unknown[];
  edges: Array<{ style: string | null; evidencePath?: string | null }>;
};
type Judge = { verdicts: Array<{ edge: number; verdict: string }> };
type Score = {
  label: string;
  run: string;
  covered: number;
  modules: number;
  internal: number;
  staticSupported: number;
};

const scores = (await read<Score[]>(join(OUT, "score.json"))) ?? [];
const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const quantile = (values: number[], q: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!
    : NaN;
};
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
const seconds = (ms: number) =>
  Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "-";
const percent = (part: number, whole: number) =>
  whole ? `${((100 * part) / whole).toFixed(0)}%` : "-";
const usd = (value: number) =>
  Number.isFinite(value) ? `$${value.toFixed(4)}` : "-";

/** What production pays for a prompt nobody sent before (no cache read). */
function coldCost(call: CallUsage): number {
  if (/haiku/.test(call.model))
    return callCostUsd({ ...call, cachedInputTokens: 0, cacheWriteTokens: 0 });
  // OpenAI bills a first-time prompt on these models as a cache write (1.25x
  // input). Seen on the first sample of each repository: 1,280 tokens (the
  // system prompt and schema every diagram shares) read from cache, the rest
  // written. Later samples of the same repository read everything from cache,
  // which production never does, so every sample is repriced this way.
  const shared = Math.min(1280, call.inputTokens);
  return callCostUsd({
    ...call,
    cachedInputTokens: shared,
    cacheWriteTokens: call.inputTokens - shared,
  });
}
/** The same call with no caching at all: plain input price. */
function uncachedCost(call: CallUsage): number {
  return callCostUsd({ ...call, cachedInputTokens: 0, cacheWriteTokens: 0 });
}

const summary: Record<string, Record<string, unknown>> = {};
const perRepo: string[] = [];
const sizeRows: string[] = [];
for (const arm of arms) {
  const root = join(OUT, "runs", arm);
  const dirs = (await readdir(root).catch(() => [])).sort();
  const rows: Array<{
    dir: string;
    result: Result;
    graph: Graph | null;
    judge: Judge | null;
    score: Score | undefined;
  }> = [];
  for (const dir of dirs) {
    const result = await read<Result>(join(root, dir, "result.json"));
    if (!result) continue;
    rows.push({
      dir,
      result,
      graph: await read<Graph>(join(root, dir, "graph.json")),
      judge: await read<Judge>(join(root, dir, "judge.json")),
      score: scores.find((entry) => entry.label === arm && entry.run === dir),
    });
  }
  const tally = (subset: typeof rows) => {
    const ok = subset.filter((row) => !row.result.failure);
    const first = subset
      .map((row) => row.result.attempts[0])
      .filter((attempt) => attempt !== undefined);
    const judged = subset.filter((row) => row.judge && row.graph);
    let edges = 0;
    let solid = 0;
    let invented = 0;
    let inventedSolid = 0;
    let contradicted = 0;
    for (const row of judged) {
      edges += row.graph!.edges.length;
      solid += row.graph!.edges.filter((e) => e.style !== "dashed").length;
      for (const verdict of row.judge!.verdicts) {
        if (verdict.verdict === "supported") continue;
        invented++;
        if (verdict.verdict === "contradicted") contradicted++;
        if (row.graph!.edges[verdict.edge]?.style !== "dashed") inventedSolid++;
      }
    }
    const scored = subset.filter((row) => row.score);
    const sum = (pick: (score: Score) => number) =>
      scored.reduce((total, row) => total + pick(row.score!), 0);
    const billed = subset.filter((row) => row.result.calls.length > 0);
    const firstCalls = subset
      .map((row) => row.result.calls[0])
      .filter((call) => call !== undefined);
    return {
      runs: subset.length,
      hardFailures: subset.length - ok.length,
      failureKinds: subset
        .filter((row) => row.result.failure)
        .map((row) => `${row.dir}: ${row.result.failure}`),
      firstAttemptValid: first.filter((a) => a.valid).length,
      firstAttemptAccepted: first.filter((a) => a.accepted).length,
      firstAttempts: first.length,
      neededRepairCall: subset.filter((row) => row.result.attempts.length > 1)
        .length,
      unknownNodePaths: first.reduce((t, a) => t + a.unknownNodePaths, 0),
      nodesWithPath: first.reduce((t, a) => t + a.nodesWithPath, 0),
      unknownEvidencePaths: first.reduce(
        (t, a) => t + a.unknownEvidencePaths,
        0,
      ),
      evidenceStrippedAsUnseen: first.reduce(
        (t, a) => t + a.evidenceStrippedAsUnseen,
        0,
      ),
      edgesWithEvidenceFromModel: first.reduce(
        (t, a) => t + a.edgesWithEvidenceFromModel,
        0,
      ),
      meanNodes: mean(first.map((a) => a.nodes)),
      meanEdges: mean(first.map((a) => a.edges)),
      judgedRuns: judged.length,
      judgedEdges: edges,
      invented,
      solid,
      inventedSolid,
      contradicted,
      covered: sum((s) => s.covered),
      modules: sum((s) => s.modules),
      staticSupported: sum((s) => s.staticSupported),
      internal: sum((s) => s.internal),
      ttftMedian: median(ok.map((row) => row.result.firstExplanationMs ?? NaN)),
      ttftP90: quantile(
        ok.map((row) => row.result.firstExplanationMs ?? NaN),
        0.9,
      ),
      totalMedian: median(ok.map((row) => row.result.totalMs)),
      totalP90: quantile(
        ok.map((row) => row.result.totalMs),
        0.9,
      ),
      totalMax: Math.max(...ok.map((row) => row.result.totalMs)),
      over18s: subset.filter(
        (row) => (row.result.architectureMs ?? 0) > ARCHITECTURE_SLOW_RETRY_MS,
      ).length,
      inputTokensMedian: median(firstCalls.map((call) => call.inputTokens)),
      inputTokensMax: Math.max(...firstCalls.map((call) => call.inputTokens)),
      outputTokensMedian: median(firstCalls.map((call) => call.outputTokens)),
      reasoningTokensMedian: median(
        firstCalls.map((call) => call.reasoningTokens),
      ),
      over100k: firstCalls.filter((call) => call.inputTokens > 100_000).length,
      // A run whose usage was not returned (one failed Haiku call) is left
      // out of the cost means rather than counted as free.
      measuredCostMean: mean(billed.map((row) => row.result.costUsd)),
      coldCostMean: mean(
        billed.map((row) =>
          row.result.calls.reduce((t, call) => t + coldCost(call), 0),
        ),
      ),
      uncachedCostMean: mean(
        billed.map((row) =>
          row.result.calls.reduce((t, call) => t + uncachedCost(call), 0),
        ),
      ),
    };
  };
  summary[arm] = tally(rows);
  const repos = [...new Set(rows.map((row) => row.result.repo))];
  for (const repo of repos) {
    const t = tally(rows.filter((row) => row.result.repo === repo));
    perRepo.push(
      `| ${repo} | ${arm} | ${t.runs} | ${t.hardFailures} | ${t.firstAttemptValid}/${t.firstAttempts} | ${t.meanNodes.toFixed(0)} / ${t.meanEdges.toFixed(0)} | ${t.modules ? `${t.covered}/${t.modules}` : "-"} | ${t.staticSupported}/${t.internal} (${percent(t.staticSupported, t.internal)}) | ${t.judgedRuns ? `${t.invented}/${t.judgedEdges} (${percent(t.invented, t.judgedEdges)})` : "not judged"} | ${t.judgedRuns ? `${t.inventedSolid}/${t.solid} (${percent(t.inventedSolid, t.solid)})` : "-"} | ${seconds(t.ttftMedian)} | ${seconds(t.totalMedian)} | ${t.inputTokensMedian} | ${t.outputTokensMedian} | ${usd(t.coldCostMean)} |`,
    );
  }
  for (const repo of repos) {
    const row = rows.find((entry) => entry.result.repo === repo);
    const call = row?.result.calls[0];
    if (!row || !call) continue;
    const chars =
      (row.result as unknown as { userPromptChars: number }).userPromptChars +
      (row.result as unknown as { systemPromptChars: number })
        .systemPromptChars;
    sizeRows.push(`| ${repo} | ${arm} | ${chars} | ${call.inputTokens} |`);
  }
}

const lines: string[] = [];
const column = (pick: (t: Record<string, number>) => string) =>
  arms.map((arm) => pick(summary[arm] as Record<string, number>)).join(" | ");
lines.push(`| | ${arms.join(" | ")} |`);
lines.push(`| --- | ${arms.map(() => "---").join(" | ")} |`);
const row = (name: string, pick: (t: Record<string, number>) => string) =>
  lines.push(`| ${name} | ${column(pick)} |`);
row("Diagrams run", (t) => `${t.runs}`);
row(
  "Hard failures (no diagram)",
  (t) => `${t.hardFailures} (${percent(t.hardFailures!, t.runs!)})`,
);
row(
  "Graph fully valid on first attempt",
  (t) =>
    `${t.firstAttemptValid}/${t.firstAttempts} (${percent(t.firstAttemptValid!, t.firstAttempts!)})`,
);
row(
  "Accepted on first attempt (valid, or only unknown paths stripped)",
  (t) =>
    `${t.firstAttemptAccepted}/${t.firstAttempts} (${percent(t.firstAttemptAccepted!, t.firstAttempts!)})`,
);
row("Needed a repair call", (t) => `${t.neededRepairCall}`);
row(
  "Unknown node paths (of nodes with a path)",
  (t) =>
    `${t.unknownNodePaths}/${t.nodesWithPath} (${((100 * t.unknownNodePaths!) / t.nodesWithPath!).toFixed(1)}%)`,
);
row(
  "Unknown evidence paths (of cited edges)",
  (t) =>
    `${t.unknownEvidencePaths}/${t.edgesWithEvidenceFromModel} (${((100 * t.unknownEvidencePaths!) / t.edgesWithEvidenceFromModel!).toFixed(1)}%)`,
);
row(
  "Citations dropped: file exists but the model was never shown it",
  (t) =>
    `${t.evidenceStrippedAsUnseen}/${t.edgesWithEvidenceFromModel} (${((100 * t.evidenceStrippedAsUnseen!) / t.edgesWithEvidenceFromModel!).toFixed(1)}%)`,
);
row(
  "Nodes / edges per diagram (mean)",
  (t) => `${t.meanNodes!.toFixed(1)} / ${t.meanEdges!.toFixed(1)}`,
);
row(
  "Core modules covered (5 original repos)",
  (t) => `${t.covered}/${t.modules} (${percent(t.covered!, t.modules!)})`,
);
row(
  "Edges the whole repo's imports connect (static)",
  (t) =>
    `${t.staticSupported}/${t.internal} (${percent(t.staticSupported!, t.internal!)})`,
);
row("Runs judged (blind, GPT-6 Sol)", (t) => `${t.judgedRuns}`);
row("Judge: edges not backed by code", (t) =>
  t.judgedRuns
    ? `${t.invented}/${t.judgedEdges} (${((100 * t.invented!) / t.judgedEdges!).toFixed(1)}%)`
    : "not judged",
);
row("Judge: solid arrows not backed", (t) =>
  t.judgedRuns
    ? `${t.inventedSolid}/${t.solid} (${((100 * t.inventedSolid!) / t.solid!).toFixed(1)}%)`
    : "not judged",
);
row("Judge: contradicted edges", (t) =>
  t.judgedRuns ? `${t.contradicted}` : "not judged",
);
row(
  "Time to first explanation text, median (p90)",
  (t) => `${seconds(t.ttftMedian!)} (${seconds(t.ttftP90!)})`,
);
row(
  "Total model time, median (p90, max)",
  (t) =>
    `${seconds(t.totalMedian!)} (${seconds(t.totalP90!)}, ${seconds(t.totalMax!)})`,
);
row(
  "Calls over 18 s (production would cancel and restart)",
  (t) => `${t.over18s}/${t.runs} (${percent(t.over18s!, t.runs!)})`,
);
row(
  "Input tokens, median (max)",
  (t) => `${t.inputTokensMedian} (${t.inputTokensMax})`,
);
row(
  "Output tokens, median (of which reasoning)",
  (t) => `${t.outputTokensMedian} (${t.reasoningTokensMedian})`,
);
row("Prompts over 100,000 tokens", (t) => `${t.over100k}/${t.runs}`);
row("Cost per diagram as measured here (mean)", (t) =>
  usd(t.measuredCostMean!),
);
row("Cost per diagram, first-time prompt as in production (mean)", (t) =>
  usd(t.coldCostMean!),
);
row("Cost per diagram with no cache writes or reads (mean)", (t) =>
  usd(t.uncachedCostMean!),
);

const markdown = [
  "## All repositories",
  "",
  ...lines,
  "",
  "## Per repository",
  "",
  "| Repo | Arm | Runs | Failed | First attempt valid | Nodes / edges | Core modules | Static support | Judge: not backed (all) | Judge: not backed (solid) | First text | Total | Input tokens | Output tokens | Cost (first-time prompt) |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...perRepo,
  "",
  "## Prompt size by tokenizer (system + user prompt characters, billed input tokens)",
  "",
  "| Repo | Arm | Characters | Input tokens |",
  "| --- | --- | --- | --- |",
  ...sizeRows,
].join("\n");
await writeFile(join(OUT, "summary.md"), markdown);
await writeFile(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.info(markdown);
