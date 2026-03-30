import { randomUUID } from "node:crypto";
import { after } from "next/server";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import { diagramGraphSchema, MAX_GRAPH_ATTEMPTS } from "~/features/diagram/graph";
import type { ArtifactVisibility } from "~/server/storage/types";
import { revalidateBrowseIndexCache } from "~/app/browse/data";
import {
  persistTerminalSessionAudit,
  saveSuccessfulDiagramState,
  updatePublicBrowseIndexForSuccessfulDiagram,
} from "~/server/storage/diagram-state";
import {
  buildComplimentaryReservationTokens,
  estimateConservativeCommittedTokens,
  finalizeComplimentaryQuota,
  getComplimentaryDenialMessage,
  getComplimentaryModelMismatchMessage,
  getComplimentaryProviderMismatchMessage,
  isComplimentaryGateEnabled,
  modelMatchesComplimentaryFamily,
  reserveComplimentaryQuota,
  shouldApplyComplimentaryGate,
  type ComplimentaryQuotaReservation,
} from "~/server/generate/complimentary-gate";
import {
  estimateGenerationCost,
  type GenerationEstimateResult,
} from "~/server/generate/cost-estimate";
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
  shouldUseExactInputTokenCount,
} from "~/server/generate/model-config";
import { generateStructuredOutput, streamCompletion } from "~/server/generate/openai";
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

const DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED_ERROR =
  "GitDiagram's default OpenAI key is temporarily unavailable because its upstream API quota is exhausted. I'm a solo student engineer running this free and open source, so please try again later or use your own OpenAI API key.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortError() {
  return new DOMException("Generation aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function isOpenAiQuotaExhaustedError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("insufficient_quota") ||
    (normalized.includes("exceeded your current quota") &&
      normalized.includes("billing"))
  );
}

function normalizeGenerationError(params: {
  provider: string;
  apiKey?: string;
  message: string;
}): { message: string; errorCode: string } {
  if (
    params.provider === "openai" &&
    !params.apiKey &&
    isOpenAiQuotaExhaustedError(params.message)
  ) {
    return {
      message: DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED_ERROR,
      errorCode: "DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED",
    };
  }

  return {
    message: params.message,
    errorCode: "STREAM_FAILED",
  };
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
  const generationAbortController = new AbortController();
  const postResponseTasks: Array<() => Promise<void>> = [];

  after(async () => {
    for (const task of postResponseTasks) {
      await task();
    }
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let controllerClosed = false;
      let wasCancelled = false;
      const abortGeneration = () => {
        wasCancelled = true;
        if (!generationAbortController.signal.aborted) {
          generationAbortController.abort();
        }
      };

      request.signal.addEventListener("abort", abortGeneration, { once: true });

      const closeStream = () => {
        if (controllerClosed) {
          return;
        }
        controllerClosed = true;
        controller.close();
      };

      const send = (payload: Record<string, unknown>) => {
        if (controllerClosed || generationAbortController.signal.aborted) {
          return;
        }
        controller.enqueue(encoder.encode(sseMessage(payload)));
      };

      const run = async () => {
        let audit = createGenerationSessionAudit({
          sessionId: randomUUID(),
          provider: "unknown",
          model: "unknown",
        });
        let estimate: GenerationEstimateResult | null = null;
        let quotaReservation: ComplimentaryQuotaReservation | null = null;
        const actualUsages: GenerationTokenUsage[] = [];
        let hasCompleteMeasuredUsage = true;
        let storageVisibility: ArtifactVisibility = githubPat?.trim()
          ? "private"
          : "public";

        const persistTerminalAudit = async (nextAudit = audit) => {
          await persistTerminalSessionAudit({
            username,
            repo,
            githubPat,
            visibility: storageVisibility,
            audit: nextAudit,
          });
        };

        try {
          throwIfAborted(generationAbortController.signal);
          const provider = getProvider();
          const providerLabel = getProviderLabel(provider);
          const model = getModel(provider);

          if (isComplimentaryGateEnabled() && !apiKey) {
            if (provider !== "openai") {
              const error = getComplimentaryProviderMismatchMessage();
              audit = withFailure(
                {
                  ...audit,
                  provider,
                  model,
                  quotaStatus: "denied",
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_PROVIDER_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }

            if (!modelMatchesComplimentaryFamily(model)) {
              const error = getComplimentaryModelMismatchMessage();
              audit = withFailure(
                {
                  ...audit,
                  provider,
                  model,
                  quotaStatus: "denied",
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_MODEL_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }
          }

          const githubData = await getGithubData(
            username,
            repo,
            githubPat,
            generationAbortController.signal,
          );
          storageVisibility = githubData.isPrivate ? "private" : "public";
          estimate = await estimateGenerationCost({
            provider,
            model,
            fileTree: githubData.fileTree,
            readme: githubData.readme,
            username,
            repo,
            apiKey,
            preferExactInputTokenCount: shouldUseExactInputTokenCount({
              provider,
              apiKey,
            }),
          });
          const tokenCount = estimate.explanationInputTokens;

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

          send({
            status: "started",
            session_id: audit.sessionId,
            message: "Starting generation process...",
            cost_summary: estimate.costSummary,
          });

          throwIfAborted(generationAbortController.signal);
          if (shouldApplyComplimentaryGate({ provider, model, apiKey })) {
            if (!modelMatchesComplimentaryFamily(model)) {
              const error = getComplimentaryModelMismatchMessage();
              audit = withFailure(
                {
                  ...audit,
                  quotaStatus: "denied",
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_MODEL_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }

            const reservationTokens = buildComplimentaryReservationTokens({
              explanationInputTokens: estimate.explanationInputTokens,
              graphStaticInputTokens: estimate.graphStaticInputTokens,
            });
            const reservation = await reserveComplimentaryQuota({
              model,
              reservationTokens,
            });

            if (!reservation.admitted) {
              const error = reservation.message || getComplimentaryDenialMessage();
              audit = withFailure(
                {
                  ...audit,
                  quotaStatus: "denied",
                  quotaResetAt: reservation.quotaResetAt,
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "DAILY_FREE_TOKEN_LIMIT_REACHED",
                failure_stage: "started",
                validation_error: error,
                quota_reset_at: reservation.quotaResetAt,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }

            quotaReservation = reservation.reservation;
            audit = {
              ...audit,
              quotaStatus: "admitted",
              quotaBucket: quotaReservation.quotaBucket,
              quotaDateUtc: quotaReservation.quotaDateUtc,
              reservedTokens: quotaReservation.reservedTokens,
              quotaResetAt: quotaReservation.quotaResetAt,
            };
          }

          if (tokenCount > 50000 && tokenCount < 195000 && !apiKey) {
            const error =
              `File tree and README combined exceeds token limit (50,000). This repository is too large for free generation. Provide your own ${providerLabel} API key to continue.`;
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            await persistTerminalAudit();
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
            closeStream();
            return;
          }

          if (tokenCount > 195000) {
            const error =
              "Repository is too large (>195k tokens) for analysis. Try a smaller repo.";
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            await persistTerminalAudit();
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
            closeStream();
            return;
          }

          audit = withTimelineEvent(
            audit,
            "explanation_sent",
            `Sending explanation request to ${model}...`,
          );
          send({
            status: "explanation_sent",
            session_id: audit.sessionId,
            message: `Sending explanation request to ${model}...`,
          });
          await sleep(80);
          throwIfAborted(generationAbortController.signal);

          audit = withTimelineEvent(audit, "explanation", "Analyzing repository structure...");
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
            signal: generationAbortController.signal,
          });
          for await (const chunk of explanationStream.stream) {
            throwIfAborted(generationAbortController.signal);
            explanationResponse += chunk;
            send({ status: "explanation_chunk", session_id: audit.sessionId, chunk });
          }
          let explanationUsage: GenerationTokenUsage | null = null;
          try {
            explanationUsage = await explanationStream.usagePromise;
          } catch {
            hasCompleteMeasuredUsage = false;
          }
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
          if (!explanation.trim()) {
            throw new Error("OpenAI explanation generation returned no usable output.");
          }
          audit = withExplanation(audit, explanation);

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
            throwIfAborted(generationAbortController.signal);
            const status = attempt === 1 ? "graph" : "graph_retry";
            const message =
              attempt === 1
                ? "Planning repository graph..."
                : `Retrying graph planning (${attempt}/${MAX_GRAPH_ATTEMPTS})...`;

            audit = withTimelineEvent(audit, status, message);
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
              signal: generationAbortController.signal,
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
            await persistTerminalAudit();
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
            closeStream();
            return;
          }

          audit = withTimelineEvent(audit, "diagram_compiling", "Compiling Mermaid diagram...");
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiling Mermaid diagram...",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
          });

          throwIfAborted(generationAbortController.signal);
          const diagram = compileDiagramGraph({
            graph: validGraph,
            username,
            repo,
            branch: githubData.defaultBranch,
          });
          audit = withCompiledDiagram(audit, diagram);
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiled Mermaid diagram. Validating syntax...",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
            diagram,
          });

          throwIfAborted(generationAbortController.signal);
          const mermaidValidation = await validateMermaidSyntax(diagram);
          if (!mermaidValidation.valid) {
            const compilerError =
              mermaidValidation.message ?? "Compiled Mermaid failed validation.";
            audit = withFailure(audit, {
              failureStage: "diagram_compiling",
              compilerError,
            });
            await persistTerminalAudit();
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
            closeStream();
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
          throwIfAborted(generationAbortController.signal);
          audit = withFinalCost(audit, finalCost);
          audit = withSuccess(withTimelineEvent(audit, "complete", "Diagram generation complete."));
          await saveSuccessfulDiagramState({
            username,
            repo,
            githubPat,
            visibility: storageVisibility,
            stargazerCount: githubData.stargazerCount,
            explanation,
            graph: validGraph,
            diagram,
            audit,
            usedOwnKey: Boolean(apiKey),
          });

          if (storageVisibility === "public") {
            const lastSuccessfulAt = audit.updatedAt ?? new Date().toISOString();
            postResponseTasks.push(async () => {
              try {
                await updatePublicBrowseIndexForSuccessfulDiagram({
                  username,
                  repo,
                  lastSuccessfulAt,
                  stargazerCount: githubData.stargazerCount,
                });
                revalidateBrowseIndexCache();
              } catch (error) {
                console.error("Failed to update browse index after completion:", error);
              }
            });
          }

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
          if (isAbortError(error)) {
            wasCancelled = true;
            return;
          }
          hasCompleteMeasuredUsage = false;
          const rawMessage =
            error instanceof Error ? error.message : "Streaming generation failed.";
          const { message, errorCode } = normalizeGenerationError({
            provider: audit.provider,
            apiKey,
            message: rawMessage,
          });
          const failedAudit = withFailure(audit, {
            failureStage: audit.stage || "started",
            validationError: message,
          });
          try {
            await persistTerminalAudit(failedAudit);
          } catch {
            // Best effort persistence.
          }

          send({
            status: "error",
            session_id: failedAudit.sessionId,
            error: message,
            error_code: errorCode,
            failure_stage: failedAudit.failureStage,
            validation_error: failedAudit.validationError,
            cost_summary: failedAudit.finalCost ?? failedAudit.estimatedCost,
            latest_session_audit: failedAudit,
          });
        } finally {
          if (quotaReservation) {
            const measuredCommittedTokens = sumGenerationUsage(
              ...actualUsages,
            ).totalTokens;
            const actualCommittedTokens =
              wasCancelled || !hasCompleteMeasuredUsage
                ? estimateConservativeCommittedTokens({
                    stage: audit.stage,
                    reservationTokens: quotaReservation.reservedTokens,
                    estimate: {
                      explanationInputTokens: estimate?.explanationInputTokens ?? 0,
                      graphStaticInputTokens: estimate?.graphStaticInputTokens ?? 0,
                    },
                    measuredTokens: measuredCommittedTokens,
                  })
                : measuredCommittedTokens;

            audit = {
              ...audit,
              quotaStatus: "finalized",
              quotaBucket: quotaReservation.quotaBucket,
              quotaDateUtc: quotaReservation.quotaDateUtc,
              reservedTokens: quotaReservation.reservedTokens,
              actualCommittedTokens,
              quotaResetAt: quotaReservation.quotaResetAt,
            };

            try {
              await finalizeComplimentaryQuota({
                reservation: quotaReservation,
                committedTokens: actualCommittedTokens,
              });
              if (!wasCancelled) {
                await persistTerminalAudit();
              }
            } catch {
              // Best effort quota finalization and audit persistence.
            }
          }
          closeStream();
        }
      };

      void run();
    },
    cancel() {
      if (!generationAbortController.signal.aborted) {
        generationAbortController.abort();
      }
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
