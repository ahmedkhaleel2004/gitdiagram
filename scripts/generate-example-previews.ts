import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GenerationTokenUsage } from "../src/features/diagram/cost";
import {
  diagramGraphSchema,
  MAX_GRAPH_ATTEMPTS,
  type DiagramGraph,
} from "../src/features/diagram/graph";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  EXPLANATION_REASONING_EFFORT,
  EXPLANATION_TEXT_VERBOSITY,
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_REASONING_EFFORT,
  GRAPH_TEXT_VERBOSITY,
} from "../src/server/generate/generation-policy";
import {
  extractTaggedSection,
  toTaggedMessage,
} from "../src/server/generate/format";
import { getGithubData } from "../src/server/generate/github";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  formatGraphValidationFeedback,
  validateDiagramGraph,
} from "../src/server/generate/graph";
import { getModel, getProvider } from "../src/server/generate/model-config";
import { validateMermaidSyntax } from "../src/server/generate/mermaid";
import {
  generateStructuredOutput,
  streamCompletion,
} from "../src/server/generate/openai";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "../src/server/generate/prompts";

const examples = [
  { username: "fastapi", repo: "fastapi" },
  { username: "streamlit", repo: "streamlit" },
  { username: "pallets", repo: "flask" },
  { username: "tom-draper", repo: "api-analytics" },
  { username: "monkeytypegame", repo: "monkeytype" },
] as const;

type Example = (typeof examples)[number];

interface PreviewAttempt {
  attempt: number;
  valid: boolean;
  validationFeedback?: string;
  usage: GenerationTokenUsage | null;
}

interface ExamplePreview {
  username: string;
  repo: string;
  defaultBranch: string;
  generatedAt: string;
  durationMs: number;
  explanation: string;
  graph: DiagramGraph;
  diagram: string;
  graphAttempts: PreviewAttempt[];
  explanationUsage: GenerationTokenUsage | null;
}

interface PreviewFailure {
  username: string;
  repo: string;
  message: string;
}

interface PreviewFile {
  generatedAt: string;
  provider: string;
  model: string;
  previews: ExamplePreview[];
  failures: PreviewFailure[];
}

const outputDirectory = path.join(
  process.cwd(),
  "tmp",
  "example-generation-previews",
);
const provider = getProvider();
const model = getModel(provider);
const runStartedAt = new Date().toISOString();
const runDirectory = path.join(
  outputDirectory,
  runStartedAt.replace(/[:.]/gu, "-"),
);
const concurrency = Math.max(
  1,
  Math.min(
    examples.length,
    Number.parseInt(process.env.EXAMPLE_PREVIEW_CONCURRENCY ?? "2", 10) || 2,
  ),
);

const previews: ExamplePreview[] = [];
const failures: PreviewFailure[] = [];

async function writeJsonAtomically(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function persistPreviewState() {
  const payload: PreviewFile = {
    generatedAt: runStartedAt,
    provider,
    model,
    previews: examples.flatMap((example) => {
      const preview = previews.find(
        (candidate) =>
          candidate.username === example.username &&
          candidate.repo === example.repo,
      );
      return preview ? [preview] : [];
    }),
    failures: [...failures],
  };

  await writeJsonAtomically(path.join(runDirectory, "previews.json"), payload);
  await writeJsonAtomically(path.join(outputDirectory, "latest.json"), payload);
}

async function generatePreview(example: Example): Promise<ExamplePreview> {
  const label = `${example.username}/${example.repo}`;
  const startedAt = performance.now();
  const requestId = `example-preview-${randomUUID()}`;
  const signal = AbortSignal.timeout(220_000);

  console.log(`[${label}] Fetching current GitHub repository data...`);
  const githubData = await getGithubData(
    example.username,
    example.repo,
    undefined,
    signal,
  );

  console.log(
    `[${label}] Generating architecture explanation with ${model}...`,
  );
  let explanationResponse = "";
  const explanationStream = await streamCompletion({
    provider,
    model,
    systemPrompt: SYSTEM_FIRST_PROMPT,
    userPrompt: toTaggedMessage({
      file_tree: githubData.fileTree,
      readme: githubData.readme,
    }),
    reasoningEffort: EXPLANATION_REASONING_EFFORT,
    textVerbosity: EXPLANATION_TEXT_VERBOSITY,
    maxOutputTokens: EXPLANATION_MAX_OUTPUT_TOKENS,
    signal,
    clientRequestId: `${requestId}:explanation`,
  });

  for await (const chunk of explanationStream.stream) {
    explanationResponse += chunk;
  }
  const explanationUsage = await explanationStream.usagePromise.catch(
    () => null,
  );
  const explanation = extractTaggedSection(explanationResponse, "explanation");
  if (!explanation.trim()) {
    throw new Error("Explanation generation returned no usable output.");
  }

  const fileTreeLookup = buildFileTreeLookup(githubData.fileTree);
  const graphAttempts: PreviewAttempt[] = [];
  let validGraph: DiagramGraph | null = null;
  let validationFeedback: string | undefined;
  let previousGraphRaw: string | undefined;

  for (let attempt = 1; attempt <= MAX_GRAPH_ATTEMPTS; attempt++) {
    console.log(
      `[${label}] Planning graph (attempt ${attempt}/${MAX_GRAPH_ATTEMPTS})...`,
    );
    const {
      output: graph,
      rawText,
      usage,
    } = await generateStructuredOutput({
      provider,
      model,
      systemPrompt: SYSTEM_GRAPH_PROMPT,
      userPrompt: toTaggedMessage(
        attempt === 1
          ? { explanation }
          : {
              explanation,
              file_tree: githubData.fileTree,
              previous_graph: previousGraphRaw,
              validation_feedback: validationFeedback,
            },
      ),
      schema: diagramGraphSchema,
      schemaName: "diagram_graph",
      reasoningEffort: GRAPH_REASONING_EFFORT,
      textVerbosity: GRAPH_TEXT_VERBOSITY,
      maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
      signal,
      clientRequestId: `${requestId}:graph:${attempt}`,
    });

    const validation = validateDiagramGraph(graph, fileTreeLookup);
    validationFeedback = validation.valid
      ? undefined
      : formatGraphValidationFeedback(validation.issues);
    graphAttempts.push({
      attempt,
      valid: validation.valid,
      validationFeedback,
      usage,
    });

    if (validation.valid) {
      validGraph = graph;
      break;
    }

    previousGraphRaw = rawText;
    console.log(`[${label}] Graph validation requested a repair.`);
  }

  if (!validGraph) {
    throw new Error(
      validationFeedback ??
        "Graph generation failed validation after all repair attempts.",
    );
  }

  const diagram = compileDiagramGraph({
    graph: validGraph,
    username: example.username,
    repo: example.repo,
    branch: githubData.defaultBranch,
  });
  const mermaidValidation = await validateMermaidSyntax(diagram);
  if (!mermaidValidation.valid) {
    throw new Error(
      `Compiled Mermaid failed validation: ${mermaidValidation.message ?? "unknown error"}`,
    );
  }

  const preview: ExamplePreview = {
    username: example.username,
    repo: example.repo,
    defaultBranch: githubData.defaultBranch,
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    explanation,
    graph: validGraph,
    diagram,
    graphAttempts,
    explanationUsage,
  };
  console.log(
    `[${label}] Complete: ${validGraph.nodes.length} nodes, ${validGraph.edges.length} edges, ${validGraph.groups.length} groups.`,
  );
  return preview;
}

async function main() {
  await mkdir(runDirectory, { recursive: true });
  console.log(
    `Generating ${examples.length} preview-only example diagrams with ${provider}/${model} (concurrency ${concurrency}).`,
  );

  const queue = [...examples];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const example = queue.shift();
      if (!example) return;

      try {
        previews.push(await generatePreview(example));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown generation error.";
        failures.push({ ...example, message });
        console.error(
          `[${example.username}/${example.repo}] Failed: ${message}`,
        );
      }

      await persistPreviewState();
    }
  });

  await Promise.all(workers);
  await persistPreviewState();

  console.log(
    JSON.stringify(
      {
        output: path.join(outputDirectory, "latest.json"),
        generated: previews.length,
        failed: failures.length,
      },
      null,
      2,
    ),
  );

  if (failures.length) {
    process.exitCode = 1;
  }
}

await main();
