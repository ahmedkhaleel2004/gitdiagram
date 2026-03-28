import { randomUUID } from "node:crypto";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import { diagramGraphSchema, MAX_GRAPH_ATTEMPTS } from "~/features/diagram/graph";
import { saveSuccessfulDiagramState, upsertLatestSessionAudit } from "~/server/db/diagram-state";
import { estimateGenerationCost } from "~/server/generate/cost-estimate";
import { extractTaggedSection, toTaggedMessage } from "~/server/generate/format";
import { getGithubData } from "~/server/generate/github";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  formatGraphValidationFeedback,
  validateDiagramGraph,
} from "~/server/generate/graph";
import {
  getModel,
  getProvider,
  getProviderLabel,
  supportsExactInputTokenCount,
} from "~/server/generate/model-config";
import {
  countInputTokens,
  estimateTokens,
  generateStructuredOutput,
  streamCompletion,
} from "~/server/generate/openai";
import { validateMermaidSyntax } from "~/server/generate/mermaid";
import { SYSTEM_FIRST_PROMPT, SYSTEM_GRAPH_PROMPT } from "~/server/generate/prompts";
import {
  createGenerationSessionAudit,
  withCompiledDiagram,
  withEstimatedCost,
  withExplanation,
  withFinalCost,
  withFailure,
  withGraph,
  withGraphAttempt,
  withStageUsage,
  withSuccess,
  withTimelineEvent,
} from "~/server/generate/session-audit";
import {
  createCostSummary,
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  sumGenerationUsage,
} from "~/server/generate/pricing";
import { generateRequestSchema, sseMessage } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function estimateRepoTokenCount(
  provider: ReturnType<typeof getProvider>,
  model: string,
  fileTree: string,
  readme: string,
  apiKey?: string,
) {
  if (!supportsExactInputTokenCount(provider)) {
    return estimateTokens(`${fileTree}\n${readme}`);
  }

  try {
    return await countInputTokens({
      provider,
      model,
      systemPrompt: SYSTEM_FIRST_PROMPT,
      userPrompt: toTaggedMessage({
        file_tree: fileTree,
        readme,
      }),
      apiKey,
      reasoningEffort: "medium",
    });
  } catch {
    return estimateTokens(`${fileTree}\n${readme}`);
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid request payload.",
        error_code: "VALIDATION_ERROR",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const parsed = generateRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid request payload.",
        error_code: "VALIDATION_ERROR",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const {
    username,
    repo,
    api_key: apiKey,
    github_pat: githubPat,
  } = parsed.data;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseMessage(payload)));
      };

      const run = async () => {
        let audit = createGenerationSessionAudit({
          sessionId: randomUUID(),
          provider: "unknown",
          model: "unknown",
        });

        try {
          const githubData = await getGithubData(username, repo, githubPat);
          const provider = getProvider();
          const providerLabel = getProviderLabel(provider);
          const model = getModel(provider);
          const tokenCount = await estimateRepoTokenCount(
            provider,
            model,
            githubData.fileTree,
            githubData.readme,
            apiKey,
          );
          const estimate = await estimateGenerationCost({
            provider,
            model,
            fileTree: githubData.fileTree,
            readme: githubData.readme,
            username,
            repo,
            apiKey,
          });
          const actualUsages: GenerationTokenUsage[] = [];
          let hasCompleteMeasuredUsage = true;

          audit = withStageUsage(
            withEstimatedCost(
              {
                ...audit,
                provider,
                model,
              },
              estimate.costSummary,
            ),
            {
              stage: "estimate",
              model,
              costSummary: estimate.costSummary,
              createdAt: new Date().toISOString(),
            },
          );
          await upsertLatestSessionAudit({ username, repo, audit });

          send({
            status: "started",
            session_id: audit.sessionId,
            message: "Starting generation process...",
            cost_summary: estimate.costSummary,
          });

          if (tokenCount > 50000 && tokenCount < 195000 && !apiKey) {
            const error =
              `File tree and README combined exceeds token limit (50,000). This repository is too large for free generation. Provide your own ${providerLabel} API key to continue.`;
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            await upsertLatestSessionAudit({ username, repo, audit });
            send({
              status: "error",
              session_id: audit.sessionId,
              error,
              error_code: "API_KEY_REQUIRED",
              validation_error: error,
              failure_stage: "started",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            controller.close();
            return;
          }

          if (tokenCount > 195000) {
            const error =
              "Repository is too large (>195k tokens) for analysis. Try a smaller repo.";
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            await upsertLatestSessionAudit({ username, repo, audit });
            send({
              status: "error",
              session_id: audit.sessionId,
              error,
              error_code: "TOKEN_LIMIT_EXCEEDED",
              validation_error: error,
              failure_stage: "started",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            controller.close();
            return;
          }

          audit = withTimelineEvent(
            audit,
            "explanation_sent",
            `Sending explanation request to ${model}...`,
          );
          await upsertLatestSessionAudit({ username, repo, audit });
          send({
            status: "explanation_sent",
            session_id: audit.sessionId,
            message: `Sending explanation request to ${model}...`,
          });
          await sleep(80);

          audit = withTimelineEvent(audit, "explanation", "Analyzing repository structure...");
          await upsertLatestSessionAudit({ username, repo, audit });
          send({
            status: "explanation",
            session_id: audit.sessionId,
            message: "Analyzing repository structure...",
          });

          let explanationResponse = "";
          const explanationStream = await streamCompletion({
            provider,
            model,
            systemPrompt: SYSTEM_FIRST_PROMPT,
            userPrompt: toTaggedMessage({
              file_tree: githubData.fileTree,
              readme: githubData.readme,
            }),
            apiKey,
            reasoningEffort: "medium",
            maxOutputTokens: EXPLANATION_MAX_OUTPUT_TOKENS,
          });
          for await (const chunk of explanationStream.stream) {
            explanationResponse += chunk;
            send({ status: "explanation_chunk", session_id: audit.sessionId, chunk });
          }
          const explanationUsage = await explanationStream.usagePromise;
          if (explanationUsage) {
            actualUsages.push(explanationUsage);
            audit = withStageUsage(audit, {
              stage: "explanation",
              model,
              costSummary: createCostSummary({
                kind: "actual",
                model,
                usage: explanationUsage,
                approximate: false,
              }),
              createdAt: new Date().toISOString(),
            });
          } else {
            hasCompleteMeasuredUsage = false;
          }

          const explanation = extractTaggedSection(explanationResponse, "explanation");
          audit = withExplanation(audit, explanation);
          await upsertLatestSessionAudit({ username, repo, audit });

          const fileTreeLookup = buildFileTreeLookup(githubData.fileTree);
          let validGraph = null;
          let validationFeedback: string | undefined;
          let previousGraphRaw: string | undefined;

          send({
            status: "graph_sent",
            session_id: audit.sessionId,
            message: `Sending graph planning request to ${model}...`,
          });

          for (let attempt = 1; attempt <= MAX_GRAPH_ATTEMPTS; attempt++) {
            const status = attempt === 1 ? "graph" : "graph_retry";
            const message =
              attempt === 1
                ? "Planning repository graph..."
                : `Retrying graph planning (${attempt}/${MAX_GRAPH_ATTEMPTS})...`;

            audit = withTimelineEvent(audit, status, message);
            await upsertLatestSessionAudit({ username, repo, audit });
            send({
              status,
              session_id: audit.sessionId,
              message,
              graph_attempts: audit.graphAttempts,
            });

            const { output: graph, rawText, usage } = await generateStructuredOutput({
              provider,
              model,
              systemPrompt: SYSTEM_GRAPH_PROMPT,
              userPrompt: toTaggedMessage({
                explanation,
                file_tree: githubData.fileTree,
                repo_owner: username,
                repo_name: repo,
                previous_graph: previousGraphRaw,
                validation_feedback: validationFeedback,
              }),
              schema: diagramGraphSchema,
              schemaName: "diagram_graph",
              apiKey,
              reasoningEffort: "low",
              maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
            });

            if (usage) {
              actualUsages.push(usage);
              audit = withStageUsage(audit, {
                stage: "graph_attempt",
                attempt,
                model,
                costSummary: createCostSummary({
                  kind: "actual",
                  model,
                  usage,
                  approximate: false,
                }),
                createdAt: new Date().toISOString(),
              });
            } else {
              hasCompleteMeasuredUsage = false;
            }

            send({
              status,
              session_id: audit.sessionId,
              graph,
            });

            const graphValidation = validateDiagramGraph(graph, fileTreeLookup);
            const attemptAudit = {
              attempt,
              rawOutput: rawText,
              graph,
              validationFeedback: graphValidation.valid
                ? undefined
                : formatGraphValidationFeedback(graphValidation.issues),
              status: (graphValidation.valid ? "succeeded" : "failed") as
                | "failed"
                | "succeeded",
              createdAt: new Date().toISOString(),
            };

            audit = withGraphAttempt(audit, attemptAudit);

            if (!graphValidation.valid) {
              validationFeedback = formatGraphValidationFeedback(graphValidation.issues);
              previousGraphRaw = rawText;
              audit = withTimelineEvent(
                audit,
                "graph_validating",
                `Graph validation failed on attempt ${attempt}/${MAX_GRAPH_ATTEMPTS}.`,
              );
              await upsertLatestSessionAudit({ username, repo, audit });
              send({
                status: "graph_validating",
                session_id: audit.sessionId,
                message: `Graph validation failed on attempt ${attempt}/${MAX_GRAPH_ATTEMPTS}.`,
                validation_error: validationFeedback,
                graph_attempts: audit.graphAttempts,
              });
              continue;
            }

            validGraph = graph;
            audit = withGraph(audit, graph);
            break;
          }

          if (!validGraph) {
            const latestValidationError =
              validationFeedback ??
              "Graph generation failed validation after the maximum number of attempts.";
            audit = withFailure(audit, {
              failureStage: "graph_validating",
              validationError: latestValidationError,
            });
            await upsertLatestSessionAudit({ username, repo, audit });
            send({
              status: "error",
              session_id: audit.sessionId,
              error:
                "Graph generation remained invalid after retry attempts. Please retry generation.",
              error_code: "GRAPH_VALIDATION_FAILED",
              validation_error: latestValidationError,
              failure_stage: "graph_validating",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            controller.close();
            return;
          }

          audit = withTimelineEvent(audit, "diagram_compiling", "Compiling Mermaid diagram...");
          await upsertLatestSessionAudit({ username, repo, audit });
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiling Mermaid diagram...",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
          });

          const diagram = compileDiagramGraph({
            graph: validGraph,
            username,
            repo,
            branch: githubData.defaultBranch,
          });
          audit = withCompiledDiagram(audit, diagram);
          await upsertLatestSessionAudit({ username, repo, audit });
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiled Mermaid diagram. Validating syntax...",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
            diagram,
          });

          const mermaidValidation = await validateMermaidSyntax(diagram);
          if (!mermaidValidation.valid) {
            const compilerError =
              mermaidValidation.message ?? "Compiled Mermaid failed validation.";
            audit = withFailure(audit, {
              failureStage: "diagram_compiling",
              compilerError,
            });
            await upsertLatestSessionAudit({ username, repo, audit });
            send({
              status: "error",
              session_id: audit.sessionId,
              error: "Compiled Mermaid failed validation.",
              error_code: "COMPILER_VALIDATION_FAILED",
              failure_stage: "diagram_compiling",
              validation_error: compilerError,
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            controller.close();
            return;
          }

          const finalCost = hasCompleteMeasuredUsage
            ? createCostSummary({
                kind: "actual",
                model,
                usage: sumGenerationUsage(...actualUsages),
                approximate: false,
              })
            : {
                ...estimate.costSummary,
                kind: "actual" as const,
                note:
                  "Some stage usage was unavailable, so the final cost remains approximate.",
              };
          audit = withFinalCost(audit, finalCost);
          audit = withSuccess(withTimelineEvent(audit, "complete", "Diagram generation complete."));
          await saveSuccessfulDiagramState({
            username,
            repo,
            explanation,
            graph: validGraph,
            diagram,
            audit,
            usedOwnKey: Boolean(apiKey),
          });

          send({
            status: "complete",
            session_id: audit.sessionId,
            cost_summary: audit.finalCost ?? audit.estimatedCost,
            diagram,
            explanation,
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
            latest_session_audit: audit,
            generated_at: audit.updatedAt,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Streaming generation failed.";
          const failedAudit = withFailure(audit, {
            failureStage: audit.stage || "started",
            validationError: message,
          });
          try {
            await upsertLatestSessionAudit({ username, repo, audit: failedAudit });
          } catch {
            // Best effort persistence.
          }

          send({
            status: "error",
            session_id: failedAudit.sessionId,
            error: message,
            error_code: "STREAM_FAILED",
            failure_stage: failedAudit.failureStage,
            validation_error: failedAudit.validationError,
            cost_summary: failedAudit.finalCost ?? failedAudit.estimatedCost,
            latest_session_audit: failedAudit,
          });
        } finally {
          controller.close();
        }
      };

      void run();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
