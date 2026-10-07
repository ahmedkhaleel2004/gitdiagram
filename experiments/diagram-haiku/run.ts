/**
 * One repository through the production diagram pipeline for several model
 * setups ("arms"), on the SAME prompt: GitHub read and source selection run
 * once, then every arm gets the identical system and user prompt and the
 * identical output schema. Based on experiments/diagram-evidence/run.ts, with
 * timings, per-attempt validation and real usage recorded.
 *
 *   bun --conditions=react-server experiments/diagram-haiku/run.ts owner/repo <samples> <arm,arm,...>
 *
 * Arms:
 *   luna            GPT-6 Luna exactly as production calls it (streamCompletion,
 *                   effort from generation-policy, priority tier = 2x price).
 *   luna-std        The same call in OpenAI's normal lane (service_tier
 *                   "default", list price), for the speed and cost comparison.
 *   haiku-low|medium|high
 *                   Claude Haiku 5.5 on Anthropic's Messages API with the same
 *                   prompts and the same zod schema as a structured output.
 *   haiku-nothink   The same at low effort with thinking switched off.
 *   haiku-or-low    Claude Haiku 5.5 through the existing OpenRouter path of
 *                   src/server/generate/openai.ts (no adapter).
 *
 * The validation loop mirrors generateValidatedGraph (graph-planner.ts) with
 * the same exported helpers; it is copied here only so that the repair call
 * can go to either provider and every attempt can be recorded.
 *
 * Output: experiments/diagram-haiku/out/runs/<arm>/<owner>__<repo>__<n>/ and
 * one line per model call in out/spend.jsonl.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";
import {
  diagramGraphSchema,
  MAX_GRAPH_ATTEMPTS,
  type DiagramGraph,
} from "~/features/diagram/graph";
import {
  architectureOutputSchema,
  expandArchitectureGraph,
  readArchitectureProgress,
} from "~/server/generate/architecture-output";
import { applyEdgeEvidence } from "~/server/generate/edge-evidence";
import { toTaggedMessage } from "~/server/generate/format";
import { getGithubData } from "~/server/generate/github";
import {
  ARCHITECTURE_SLOW_RETRY_MS,
  getArchitectureReasoningEffort,
  GRAPH_REASONING_EFFORT,
  GRAPH_TEXT_VERBOSITY,
  EXPLANATION_TEXT_VERBOSITY,
} from "~/server/generate/generation-policy";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  formatGraphValidationFeedback,
  isRepairableWithoutRetry,
  normalizeKnownGraphPaths,
  stripUnknownGraphPaths,
  validateDiagramGraph,
} from "~/server/generate/graph";
import {
  generateStructuredOutput,
  streamCompletion,
} from "~/server/generate/openai";
import {
  SYSTEM_ARCHITECTURE_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "~/server/generate/prompts";
import { prepareRepositoryContext } from "~/server/generate/repository-context";
import { fetchSourceContext } from "~/server/generate/source-context";
import { callCostUsd, type CallUsage } from "./cost";

export const OUT = join(import.meta.dir, "out");
const HAIKU = "claude-haiku-5-5";
const HAIKU_OPENROUTER = "anthropic/claude-haiku-5.5";
const LUNA = "gpt-6-luna";

const [slug, samplesArg = "3", armsArg = "luna,haiku-low,haiku-medium"] =
  process.argv.slice(2);
if (!slug?.includes("/"))
  throw new Error("usage: run.ts owner/repo [samples] [arm,arm]");
const [username, repo] = slug.split("/") as [string, string];
const samples = Number(samplesArg);
const firstSample = Number(process.env.FIRST_SAMPLE ?? 1);
const arms = armsArg.split(",");

const anthropic = new Anthropic({
  apiKey: readFileSync(
    `${process.env.HOME}/.config/gitdiagram/anthropic-api-key`,
    "utf8",
  ).trim(),
  // Production makes one attempt per call (AI_MAX_RETRIES = 0 in openai.ts).
  maxRetries: 0,
  timeout: 150_000,
});

interface ModelCall {
  text: string;
  usage: CallUsage | null;
  firstTextMs: number | null;
  /** First moment the explanation the visitor sees had any text. */
  firstExplanationMs: number | null;
  explanationCompleteMs: number | null;
  totalMs: number;
}

type Effort = "low" | "medium" | "high";

async function callModel(params: {
  arm: string;
  system: string;
  user: string;
  schema: ZodType;
  schemaName: string;
  effort: Effort;
  streaming: boolean;
}): Promise<ModelCall> {
  const started = performance.now();
  let text = "";
  let firstTextMs: number | null = null;
  let firstExplanationMs: number | null = null;
  let explanationCompleteMs: number | null = null;
  const onChunk = (chunk: string) => {
    const now = performance.now() - started;
    firstTextMs ??= now;
    text += chunk;
    if (!params.streaming || explanationCompleteMs !== null) return;
    const progress = readArchitectureProgress(text);
    if (progress.text && firstExplanationMs === null) firstExplanationMs = now;
    if (progress.complete) explanationCompleteMs = now;
  };
  let usage: CallUsage | null = null;

  if (/^haiku-(low|medium|high|nothink)$/.test(params.arm)) {
    const stream = anthropic.messages.stream({
      model: HAIKU,
      max_tokens: 32_000,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
      // Without this Haiku 5.5 decides per request whether to think first
      // (adaptive); when it does, no text arrives until it has finished.
      ...(params.arm === "haiku-nothink"
        ? { thinking: { type: "disabled" as const } }
        : {}),
      output_config: {
        effort: params.effort,
        format: zodOutputFormat(params.schema),
      },
    });
    stream.on("text", onChunk);
    const message = await stream.finalMessage();
    if (message.stop_reason !== "end_turn")
      throw new Error(`Haiku stopped with ${message.stop_reason}`);
    const details = message.usage as unknown as {
      output_tokens_details?: { thinking_tokens?: number };
    };
    usage = {
      model: HAIKU,
      inputTokens:
        message.usage.input_tokens +
        (message.usage.cache_creation_input_tokens ?? 0) +
        (message.usage.cache_read_input_tokens ?? 0),
      cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
      reasoningTokens: details.output_tokens_details?.thinking_tokens ?? 0,
      serviceTier: message.usage.service_tier ?? null,
    };
  } else {
    const isLuna = params.arm.startsWith("luna");
    const provider = isLuna ? "openai" : "openrouter";
    const model = isLuna ? LUNA : HAIKU_OPENROUTER;
    // openai.ts picks the priority tier only for GitDiagram's own key; passing
    // the same key explicitly is how a caller gets the default tier.
    const apiKey =
      params.arm === "luna-std" ? process.env.OPENAI_API_KEY : undefined;
    const effort = params.effort;
    if (params.streaming) {
      const stream = await streamCompletion({
        provider,
        model,
        systemPrompt: params.system,
        userPrompt: params.user,
        outputSchema: params.schema,
        apiKey,
        reasoningEffort: effort,
        textVerbosity: EXPLANATION_TEXT_VERBOSITY,
      });
      for await (const chunk of stream.stream) onChunk(chunk);
      const measured = await stream.usagePromise;
      usage = measured && {
        model,
        inputTokens: measured.inputTokens,
        cachedInputTokens: measured.cachedInputTokens ?? 0,
        cacheWriteTokens: measured.cacheWriteTokens ?? 0,
        outputTokens: measured.outputTokens,
        reasoningTokens: measured.reasoningTokens ?? 0,
        serviceTier: measured.serviceTier ?? null,
      };
    } else {
      const result = await generateStructuredOutput({
        provider,
        model,
        systemPrompt: params.system,
        userPrompt: params.user,
        schema: params.schema,
        schemaName: params.schemaName,
        apiKey,
        reasoningEffort: effort,
        textVerbosity: GRAPH_TEXT_VERBOSITY,
      });
      onChunk(result.rawText);
      usage = result.usage && {
        model,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens ?? 0,
        cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
        outputTokens: result.usage.outputTokens,
        reasoningTokens: result.usage.reasoningTokens ?? 0,
        serviceTier: result.usage.serviceTier ?? null,
      };
    }
  }
  return {
    text,
    usage,
    firstTextMs,
    firstExplanationMs,
    explanationCompleteMs,
    totalMs: performance.now() - started,
  };
}

function architectureEffort(arm: string): Effort {
  if (arm.startsWith("luna")) return getArchitectureReasoningEffort(LUNA);
  if (arm === "haiku-nothink") return "low";
  return arm.split("-").at(-1) as Effort;
}

// ---- the shared prompt -----------------------------------------------------

const githubData = await getGithubData(username, repo);
const context = prepareRepositoryContext(githubData);
const sources = await fetchSourceContext({
  username,
  repo,
  githubData,
  selectedPaths: context.selectedPaths,
  referencePaths: context.referencePaths,
  listedPaths: context.listedPaths,
});
const userPrompt = toTaggedMessage({
  file_tree: context.fileTree,
  readme: context.readme,
  source_files: sources.text,
});
const fileTreeLookup = buildFileTreeLookup(githubData.fileTree);
const promptHash = createHash("sha256")
  .update(SYSTEM_ARCHITECTURE_PROMPT)
  .update(userPrompt)
  .digest("hex")
  .slice(0, 16);

async function runOnce(arm: string, sample: number) {
  const dir = join(OUT, "runs", arm, `${username}__${repo}__${sample}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "prompt.txt"), userPrompt);
  await writeFile(
    join(dir, "context.json"),
    JSON.stringify(
      {
        arm,
        sourcePaths: sources.paths,
        readPaths: sources.readPaths,
        unavailableSourceCount: sources.unavailableCount,
        treeLines: context.fileTree.split("\n").length,
        fullTreeLines: githubData.fileTree.split("\n").length,
        treeTruncated: context.treeTruncated,
      },
      null,
      2,
    ),
  );
  const record: Record<string, unknown> = {
    arm,
    repo: slug,
    sample,
    promptHash,
    systemPromptChars: SYSTEM_ARCHITECTURE_PROMPT.length,
    userPromptChars: userPrompt.length,
    effort: architectureEffort(arm),
    at: new Date().toISOString(),
  };
  const calls: Array<CallUsage & { costUsd: number; stage: string }> = [];
  const attempts: Array<Record<string, unknown>> = [];
  const started = performance.now();
  const noteCall = async (stage: string, call: ModelCall) => {
    if (!call.usage) {
      record.unmeasuredUsage = true;
      return;
    }
    const costUsd = callCostUsd(call.usage);
    calls.push({ ...call.usage, costUsd, stage });
    await appendFile(
      join(OUT, "spend.jsonl"),
      `${JSON.stringify({ label: arm, repo: slug, sample, stage, costUsd, inputTokens: call.usage.inputTokens, outputTokens: call.usage.outputTokens, at: new Date().toISOString() })}\n`,
    );
  };
  try {
    const first = await callModel({
      arm,
      system: SYSTEM_ARCHITECTURE_PROMPT,
      user: userPrompt,
      schema: architectureOutputSchema,
      schemaName: "repository_architecture",
      effort: architectureEffort(arm),
      streaming: true,
    });
    await noteCall("architecture", first);
    await writeFile(join(dir, "response.txt"), first.text);
    record.firstTextMs = first.firstTextMs;
    record.firstExplanationMs = first.firstExplanationMs;
    record.explanationCompleteMs = first.explanationCompleteMs;
    record.architectureMs = first.totalMs;
    // Production cancels and restarts an architecture call still running at
    // this point (withSlowRequestRetry); here it is only counted.
    record.wouldTriggerSlowRetry = first.totalMs > ARCHITECTURE_SLOW_RETRY_MS;

    let architecture: ReturnType<typeof architectureOutputSchema.parse>;
    try {
      architecture = architectureOutputSchema.parse(JSON.parse(first.text));
    } catch (error) {
      // In the route this throw ends the generation with an error.
      record.failure = "architecture_schema";
      record.failureDetail = String(error).slice(0, 600);
      return;
    }
    const explanation = architecture.explanation;
    await writeFile(join(dir, "explanation.md"), explanation);
    record.explanationWords = explanation.split(/\s+/).length;

    let graph: DiagramGraph | null = null;
    let validationFeedback: string | undefined;
    let previousGraphRaw: string | undefined;
    for (let attempt = 1; attempt <= MAX_GRAPH_ATTEMPTS; attempt++) {
      let generated: DiagramGraph;
      let rawText: string;
      if (attempt === 1) {
        generated = expandArchitectureGraph(architecture.graph);
        rawText = JSON.stringify(generated);
      } else {
        const repair = await callModel({
          arm,
          system: SYSTEM_GRAPH_PROMPT,
          user: toTaggedMessage({
            explanation,
            file_tree: context.fileTree,
            previous_graph: previousGraphRaw,
            validation_feedback: validationFeedback,
          }),
          schema: diagramGraphSchema,
          schemaName: "diagram_graph",
          effort: GRAPH_REASONING_EFFORT,
          streaming: false,
        });
        await noteCall(`graph_repair_${attempt}`, repair);
        rawText = repair.text;
        generated = diagramGraphSchema.parse(
          JSON.parse(repair.text),
        ) as DiagramGraph;
      }
      const normalized = normalizeKnownGraphPaths(generated, fileTreeLookup);
      const validation = validateDiagramGraph(normalized, fileTreeLookup);
      const repairable = isRepairableWithoutRetry(validation.issues);
      const stripped = repairable
        ? stripUnknownGraphPaths(normalized, fileTreeLookup)
        : { graph: normalized, strippedPathCount: 0, strippedEvidenceCount: 0 };
      const accepted = validation.valid || repairable;
      const cited = accepted
        ? applyEdgeEvidence(
            stripped.graph,
            { readPaths: sources.readPaths, references: sources.references },
            fileTreeLookup,
          )
        : null;
      attempts.push({
        attempt,
        valid: validation.valid,
        accepted,
        categories: [
          ...new Set(validation.issues.map((issue) => issue.category)),
        ],
        issues: validation.issues.length,
        nodes: normalized.nodes.length,
        nodesWithPath: normalized.nodes.filter((node) => node.path).length,
        edges: normalized.edges.length,
        edgesWithEvidenceFromModel: normalized.edges.filter(
          (edge) => edge.evidencePath,
        ).length,
        unknownNodePaths: normalized.nodes.filter(
          (node) => node.path && !fileTreeLookup.has(node.path),
        ).length,
        unknownEvidencePaths: normalized.edges.filter(
          (edge) => edge.evidencePath && !fileTreeLookup.has(edge.evidencePath),
        ).length,
        evidenceStrippedAsUnseen: cited?.strippedEvidenceCount ?? 0,
        evidenceFilled: cited?.filledEvidenceCount ?? 0,
      });
      if (accepted) {
        graph = cited?.graph ?? stripped.graph;
        break;
      }
      validationFeedback = formatGraphValidationFeedback(validation.issues);
      previousGraphRaw = rawText;
    }
    if (!graph) {
      record.failure = "graph_validation";
      record.failureDetail = validationFeedback?.slice(0, 600);
      return;
    }
    await writeFile(join(dir, "graph.json"), JSON.stringify(graph, null, 2));
    await writeFile(
      join(dir, "diagram.mmd"),
      compileDiagramGraph({
        graph,
        username,
        repo,
        branch: githubData.defaultBranch,
        pathTypes: githubData.pathTypes,
      }),
    );
  } catch (error) {
    record.failure = "provider_error";
    record.failureDetail = String((error as Error)?.message ?? error).slice(
      0,
      600,
    );
  } finally {
    record.totalMs = performance.now() - started;
    record.attempts = attempts;
    record.calls = calls;
    record.costUsd = calls.reduce((sum, call) => sum + call.costUsd, 0);
    await writeFile(join(dir, "result.json"), JSON.stringify(record, null, 2));
    const firstAttempt = attempts[0];
    console.info(
      `${arm}\t${slug}#${sample}\t${record.failure ? `FAILED ${record.failure}: ${String(record.failureDetail).slice(0, 160)}` : `ok attempts=${attempts.length} firstValid=${firstAttempt?.valid}`}\tttft=${Math.round(Number(record.firstExplanationMs ?? 0))}ms total=${Math.round(Number(record.totalMs))}ms in=${calls[0]?.inputTokens} out=${calls[0]?.outputTokens} $${Number(record.costUsd).toFixed(4)}`,
    );
  }
}

// Arms run side by side; samples of one arm run one after another, so no arm
// competes with itself for rate limits and timings stay comparable.
await Promise.all(
  arms.map(async (arm) => {
    for (let index = 0; index < samples; index++)
      await runOnce(arm, firstSample + index);
  }),
);
