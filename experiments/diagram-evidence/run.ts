/**
 * One diagram through the production generation pipeline (GitHub read, source
 * selection, the single-pass architecture call, graph validation/repair and the
 * Mermaid compiler), without quotas, persistence or the HTTP layer. Saves what
 * the model saw and what it drew so connections can be checked by hand.
 *
 *   bun --conditions=react-server experiments/diagram-evidence/run.ts <label> owner/repo [samples] [--two-pass]
 *
 * Output: /tmp/eval-diagrams/<label>/<owner>__<repo>__<n>/, and one line per
 * model call in /tmp/eval-diagrams/spend.jsonl.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GenerationTokenUsage } from "~/features/diagram/cost";
import {
  architectureOutputSchema,
  expandArchitectureGraph,
} from "~/server/generate/architecture-output";
import {
  extractTaggedSection,
  toTaggedMessage,
} from "~/server/generate/format";
import { getGithubData } from "~/server/generate/github";
import {
  EXPLANATION_REASONING_EFFORT,
  EXPLANATION_TEXT_VERBOSITY,
  getArchitectureReasoningEffort,
} from "~/server/generate/generation-policy";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
} from "~/server/generate/graph";
import { generateValidatedGraph } from "~/server/generate/graph-planner";
import { getModel, getProvider } from "~/server/generate/model-config";
import { streamCompletion } from "~/server/generate/openai";
import { createCostSummary } from "~/server/generate/pricing";
import {
  SYSTEM_ARCHITECTURE_PROMPT,
  SYSTEM_FIRST_PROMPT,
} from "~/server/generate/prompts";
import { prepareRepositoryContext } from "~/server/generate/repository-context";
import { createGenerationSessionAudit } from "~/server/generate/session-audit";
import { fetchSourceContext } from "~/server/generate/source-context";

const [label, slug, samplesArg] = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"));
const twoPass = process.argv.includes("--two-pass");
if (!label || !slug?.includes("/"))
  throw new Error("usage: run.ts <label> owner/repo [samples] [--two-pass]");
const [username, repo] = slug.split("/") as [string, string];
const samples = Number(samplesArg ?? 1);
const root = "/tmp/eval-diagrams";

const provider = getProvider();
const model = getModel(provider);
const githubData = await getGithubData(username, repo);
const context = prepareRepositoryContext(githubData);
const sources = await fetchSourceContext({
  username,
  repo,
  githubData,
  selectedPaths: context.selectedPaths,
  // Absent before this experiment's change; the runner works on both.
  ...(context as { referencePaths?: string[]; listedPaths?: string[] }),
});
const userPrompt = toTaggedMessage({
  file_tree: context.fileTree,
  readme: context.readme,
  source_files: sources.text,
});
const extra = sources as {
  readPaths?: string[];
  references?: Record<string, string[]>;
};

async function runOnce(sample: number) {
  const dir = join(root, label!, `${username}__${repo}__${sample}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "context.json"),
    JSON.stringify(
      {
        model,
        twoPass,
        selectedPaths: context.selectedPaths,
        sourcePaths: sources.paths,
        readPaths: extra.readPaths,
        references: extra.references,
        unavailableSourceCount: sources.unavailableCount,
        sourceCharacters: sources.text.length,
        treeLines: context.fileTree.split("\n").length,
        fullTreeLines: githubData.fileTree.split("\n").length,
        treeTruncated: context.treeTruncated,
      },
      null,
      2,
    ),
  );
  await writeFile(join(dir, "prompt.txt"), userPrompt);
  const usages: GenerationTokenUsage[] = [];
  const stream = await streamCompletion({
    provider,
    model,
    systemPrompt: twoPass ? SYSTEM_FIRST_PROMPT : SYSTEM_ARCHITECTURE_PROMPT,
    ...(twoPass ? {} : { outputSchema: architectureOutputSchema }),
    userPrompt,
    reasoningEffort: twoPass
      ? EXPLANATION_REASONING_EFFORT
      : getArchitectureReasoningEffort(model),
    textVerbosity: EXPLANATION_TEXT_VERBOSITY,
  });
  let raw = "";
  for await (const chunk of stream.stream) raw += chunk;
  const usage = await stream.usagePromise;
  if (usage) usages.push(usage);
  await writeFile(join(dir, "response.txt"), raw);
  const architecture = twoPass
    ? null
    : architectureOutputSchema.parse(JSON.parse(raw));
  const explanation =
    architecture?.explanation ?? extractTaggedSection(raw, "explanation");
  const accounting = {
    actualUsages: usages,
    hasCompleteMeasuredUsage: true,
    completedUnmeasuredTokenEstimate: 0,
    pendingModelRequestTokenEstimate: 0,
  };
  const result = await generateValidatedGraph({
    provider,
    model,
    sessionId: `eval-${Date.now()}`,
    explanation,
    initialGraph: architecture
      ? expandArchitectureGraph(architecture.graph)
      : undefined,
    fileTree: context.fileTree,
    fileTreeLookup: buildFileTreeLookup(githubData.fileTree),
    ...(extra.readPaths
      ? {
          evidence: {
            readPaths: extra.readPaths,
            references: extra.references ?? {},
          },
        }
      : {}),
    signal: new AbortController().signal,
    audit: createGenerationSessionAudit({
      sessionId: "eval",
      provider,
      model,
    }),
    complimentaryEstimate: null,
    accounting,
    validationCategoryCounts: {},
    recordTiming: () => {},
    send: async () => true,
  });
  const costs = usages.map((entry) =>
    createCostSummary({
      kind: "actual",
      model,
      usage: entry,
      approximate: false,
    }),
  );
  const costUsd = costs.reduce((sum, cost) => sum + cost.amountUsd, 0);
  await appendFile(
    join(root, "spend.jsonl"),
    `${JSON.stringify({ label, repo: slug, sample, costUsd, calls: usages.length, at: new Date().toISOString() })}\n`,
  );
  await writeFile(join(dir, "explanation.md"), explanation);
  if (!result.ok) {
    await writeFile(join(dir, "failure.txt"), result.validationError);
    console.info(`${slug}#${sample}: FAILED ${result.validationError}`);
    return;
  }
  await writeFile(
    join(dir, "graph.json"),
    JSON.stringify(result.graph, null, 2),
  );
  await writeFile(
    join(dir, "diagram.mmd"),
    compileDiagramGraph({
      graph: result.graph,
      username,
      repo,
      branch: githubData.defaultBranch,
      pathTypes: githubData.pathTypes,
    }),
  );
  const withEvidence = result.graph.edges.filter(
    (edge) => (edge as { evidencePath?: string | null }).evidencePath,
  ).length;
  console.info(
    `${slug}#${sample}: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges (${withEvidence} with evidence), $${costUsd.toFixed(4)} -> ${dir}`,
  );
}

await Promise.all(
  Array.from({ length: samples }, (_, index) => runOnce(index + 1)),
);
