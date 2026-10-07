/**
 * Tables from the saved reports and judgements.
 *
 *   bun --conditions=react-server experiments/video-haiku-designer/summary.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LONG_PROMPT,
  OUT,
  REPOS,
  RUNS,
  SETUP_NAMES,
  claudeCost,
  mean,
  runDir,
  sum,
  type CallRecord,
} from "./lib";

const json = async (path: string) =>
  JSON.parse(await readFile(path, "utf8").catch(() => "null"));
// GPT-6.1 Sol list prices per million tokens (src/server/generate/pricing.ts).
const SOL = { input: 2, output: 10, read: 0.1, write: 2.5 };

/**
 * What the film's design would bill for a repository nobody has filmed in the
 * last few minutes (the usual case), from this run's measured token counts.
 * The runs here repeat each repository within minutes, so later runs read
 * caches earlier ones wrote; this removes that.
 * - Sol: the prewarm writes the shared prefix once, every designer reads it.
 * - Haiku as the code is today: no prewarm, so every parallel designer writes
 *   the repository block itself (seen on every cold run); the tools and system
 *   prompt are read from the one-hour cache.
 * - Haiku with a prewarm: one write, every designer reads.
 */
function coldCost(calls: CallRecord[], systemTokens: number) {
  let asIs = 0;
  let prewarmed = 0;
  let repoBlock = 0;
  for (const c of calls) {
    if (c.provider === "openai") {
      const shared = c.cacheRead + c.cacheWrite5m;
      const cost =
        c.phase === "prewarm"
          ? (c.fresh * SOL.input + shared * SOL.write) / 1e6
          : (c.fresh * SOL.input + shared * SOL.read + c.output * SOL.output) /
            1e6;
      asIs += cost;
      prewarmed += cost;
      continue;
    }
    if (!c.promptTokens) continue;
    const repo = c.promptTokens - c.fresh - systemTokens;
    repoBlock = Math.max(repoBlock, repo);
    asIs +=
      claudeCost(c.model, {
        promptTokens: c.promptTokens,
        fresh: c.fresh,
        cacheWrite5m: repo,
        cacheWrite1h: 0,
        cacheRead: systemTokens,
        output: c.output,
      }) ?? 0;
    prewarmed +=
      claudeCost(c.model, {
        promptTokens: c.promptTokens,
        fresh: c.fresh,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: systemTokens + repo,
        output: c.output,
      }) ?? 0;
  }
  // The prewarm call itself: one write of the repository block, no output.
  if (repoBlock)
    prewarmed +=
      claudeCost("claude-haiku-5-5", {
        promptTokens: systemTokens + repoBlock,
        fresh: 0,
        cacheWrite5m: repoBlock,
        cacheWrite1h: 0,
        cacheRead: systemTokens,
        output: 0,
      }) ?? 0;
  return { asIs, prewarmed };
}

const kindOf = (w: string) =>
  /not in repo|unknown path|no known paths/.test(w)
    ? "paths"
    : /^overlap/.test(w)
      ? "overlap"
      : /no shot designed/.test(w)
        ? "undesigned"
        : /cue/.test(w)
          ? "cue"
          : "other";

const reports: any[] = [];
for (const repo of REPOS)
  for (const setup of SETUP_NAMES)
    for (const run of RUNS) {
      const r = await json(join(runDir(repo, setup, run), "report.json"));
      if (r) reports.push(r);
    }
// The tools and system prompt, as Claude counts them: the one-hour write.
// Seen as 6,259 on the first (cold) trial call; the batch itself only read it.
const systemTokens = Math.max(
  6259,
  ...reports.flatMap((r) => r.calls.map((c: CallRecord) => c.cacheWrite1h)),
);
const judges = {
  first: (await json(join(OUT, "judge.json"))) ?? {},
  settled: (await json(join(OUT, "judge-settled.json"))) ?? {},
};
const range = (xs: number[], digits: number, scale = 1) =>
  xs.length
    ? `${(Math.min(...xs) * scale).toFixed(digits)}–${(Math.max(...xs) * scale).toFixed(digits)}`
    : "–";

const rows = SETUP_NAMES.map((setup) => {
  const own = reports.filter((r) => r.setup === setup);
  const design = own.flatMap((r) =>
    r.calls.filter((c: CallRecord) => c.phase === "design"),
  ) as CallRecord[];
  const cold = own.map((r) =>
    coldCost(r.calls, setup.startsWith("haiku") ? systemTokens : 0),
  );
  const kinds: Record<string, number> = {};
  for (const r of own)
    for (const w of r.warnings) kinds[kindOf(w)] = (kinds[kindOf(w)] ?? 0) + 1;
  const shapes = own.reduce(
    (t, r) => ({
      scenes: t.scenes + r.scenes,
      string: t.string + (r.replyShapes?.string ?? 0),
      broken:
        t.broken + (r.replyShapes?.broken ?? 0) + (r.replyShapes?.none ?? 0),
    }),
    { scenes: 0, string: 0, broken: 0 },
  );
  const scores = (who: "claude" | "gpt", judge: Record<string, any>) => {
    const overall: number[] = [];
    const rank: number[] = [];
    const sub: Record<string, number[]> = {
      layout: [],
      clean: [],
      fidelity: [],
      variety: [],
    };
    for (const j of Object.values(judge) as any[]) {
      const verdict = j[who];
      const letter = Object.keys(j.key).find((l) => j.key[l] === setup);
      if (!verdict || !letter || !verdict.films?.[letter]) continue;
      overall.push(verdict.films[letter].overall);
      rank.push(verdict.ranking.indexOf(letter) + 1);
      for (const k of Object.keys(sub)) sub[k]!.push(verdict.films[letter][k]);
    }
    return {
      n: overall.length,
      overall: mean(overall),
      rank: mean(rank),
      firsts: rank.filter((x) => x === 1).length,
      lasts: rank.filter((x) => x === 4).length,
      ...Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, mean(v)])),
    };
  };
  return {
    setup,
    films: own.length,
    costColdAsIs: mean(cold.map((c) => c.asIs)),
    costColdAsIsRange: range(
      cold.map((c) => c.asIs),
      3,
    ),
    costColdPrewarmed: mean(cold.map((c) => c.prewarmed)),
    costBilled: mean(own.map((r) => r.costUsd)),
    costBilledTotal: sum(own.map((r) => r.costUsd)),
    seconds: mean(own.map((r) => r.designMs / 1000)),
    secondsRange: range(
      own.map((r) => r.designMs / 1000),
      0,
    ),
    warnings: sum(own.map((r) => r.warnings.length)),
    warningsPerFilm: mean(own.map((r) => r.warnings.length)),
    warningKinds: kinds,
    filmsWithWarnings: own.filter((r) => r.warnings.length).length,
    asIsFilmFails: own.filter((r) => r.asIsFilmFails).length,
    asIsFilmsMissingBeats: own.filter((r) => r.beatsDesignedAsIs < r.beats)
      .length,
    asIsBeatsLost: sum(own.map((r) => r.beats - r.beatsDesignedAsIs)),
    beats: sum(own.map((r) => r.beats)),
    fixedBeatsLost: sum(own.map((r) => r.beats - r.beatsDesigned)),
    scenes: shapes.scenes,
    stringReplies: shapes.string,
    unparseableReplies: shapes.broken,
    retries: sum(own.map((r) => r.extraCalls)),
    otherModelCalls: sum(own.map((r) => r.otherModelCalls)),
    unusable: sum(own.map((r) => r.unusable)),
    errors: design.filter((c) => c.error).length,
    promptMean: mean(design.map((c) => c.promptTokens)),
    promptMax: Math.max(0, ...design.map((c) => c.promptTokens)),
    over100k: design.filter((c) => c.promptTokens > LONG_PROMPT).length,
    designCalls: design.length,
    outputPerFilm: mean(
      own.map((r) => sum(r.calls.map((c: CallRecord) => c.output))),
    ),
    elementsPerFilm: mean(own.map((r) => r.elements ?? NaN)),
    claude: scores("claude", judges.first),
    gpt: scores("gpt", judges.first),
    claudeSettled: scores("claude", judges.settled),
    gptSettled: scores("gpt", judges.settled),
  };
});

const ledger = (await readFile(join(OUT, "ledger.jsonl"), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { what: string; costUsd: number });
const spend = {
  total: sum(ledger.map((l) => l.costUsd)),
  direct: sum(
    ledger.filter((l) => l.what.startsWith("direct")).map((l) => l.costUsd),
  ),
  design: sum(
    ledger.filter((l) => l.what.startsWith("design")).map((l) => l.costUsd),
  ),
  judge: sum(
    ledger.filter((l) => l.what.startsWith("judge")).map((l) => l.costUsd),
  ),
  trialRunsDiscarded:
    sum(
      ledger.filter((l) => l.what.startsWith("design")).map((l) => l.costUsd),
    ) - sum(reports.map((r) => r.costUsd)),
};
const scripts = [];
for (const repo of REPOS) {
  const s = await json(
    join(OUT, "scripts", `${repo.replace("/", "__").toLowerCase()}.json`),
  );
  if (s)
    scripts.push({
      repo,
      beats: s.script.beats.length,
      ms: s.ms,
      costUsd: s.costUsd,
      prompt: s.calls[0]?.promptTokens,
    });
}
await writeFile(
  join(OUT, "summary.json"),
  JSON.stringify(
    {
      systemTokens,
      rows,
      spend,
      scripts,
      reports: reports.map(({ calls: _c, ...r }) => r),
    },
    null,
    2,
  ),
);

const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "–");
console.info(`system+tools tokens (Claude count): ${systemTokens}\n`);
console.info(
  "| Setup | Films | Cost/film cold, code as is | …with a Haiku prewarm | Billed here (avg) | Design time avg (range) | Warnings sum (per film) | As-is: films failed / with lost beats | Scenes sent as a string | Retries / other-model / unusable | Prompt tokens avg (max) | Over 100K |",
);
console.info("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.info(
    `| ${r.setup} | ${r.films} | $${f(r.costColdAsIs, 3)} (${r.costColdAsIsRange}) | $${f(r.costColdPrewarmed, 3)} | $${f(r.costBilled, 3)} | ${f(r.seconds, 0)} s (${r.secondsRange}) | ${r.warnings} (${f(r.warningsPerFilm, 1)}) ${JSON.stringify(r.warningKinds)} | ${r.asIsFilmFails} / ${r.asIsFilmsMissingBeats} (${r.asIsBeatsLost} of ${r.beats} beats) | ${r.stringReplies} of ${r.scenes} (${r.unparseableReplies} unreadable) | ${r.retries} / ${r.otherModelCalls} / ${r.unusable} | ${f(r.promptMean, 0)} (${r.promptMax}) | ${r.over100k} of ${r.designCalls} |`,
  );
console.info(
  "\n| Setup | Opus judge: overall, avg rank, firsts (n) | layout / clean / fidelity / variety | Sol judge: overall, avg rank, firsts (n) | layout / clean / fidelity / variety |",
);
console.info("|---|---|---|---|---|");
const s = (j: any) =>
  `${f(j.overall)}, ${f(j.rank)}, ${j.firsts}/${j.lasts} (${j.n}) | ${f(j.layout, 1)} / ${f(j.clean, 1)} / ${f(j.fidelity, 1)} / ${f(j.variety, 1)}`;
for (const r of rows)
  console.info(`| ${r.setup} | ${s(r.claude)} | ${s(r.gpt)} |`);
console.info("\nSecond look (settled frames):");
for (const r of rows)
  console.info(`| ${r.setup} | ${s(r.claudeSettled)} | ${s(r.gptSettled)} |`);
console.info(`\nspend: ${JSON.stringify(spend)}`);
