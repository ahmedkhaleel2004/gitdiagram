import { after } from "next/server";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import type { DiagramStreamMessage } from "~/features/diagram/types";
import type { ArtifactVisibility } from "~/server/storage/types";
import {
  admitComplimentaryQuota,
  buildComplimentaryAdmissionTokens,
  buildComplimentaryStageTokenBound,
  getComplimentaryDenialMessage,
  getComplimentaryModelMismatchMessage,
  getComplimentaryProviderMismatchMessage,
  isComplimentaryGateEnabled,
  markComplimentaryQuotaStarted,
  modelMatchesComplimentaryFamily,
  shouldApplyComplimentaryGate,
  type ComplimentaryAdmissionEstimate,
  type ComplimentaryQuotaReservation,
} from "~/server/generate/complimentary-gate";
import {
  estimateGenerationCost,
  type GenerationEstimateResult,
} from "~/server/generate/cost-estimate";
import { normalizeGenerationError } from "~/server/generate/errors";
import { createFinalGenerationCostSummary } from "~/server/generate/final-cost";
import {
  startGenerationCancellationPolling,
  unregisterActiveGeneration,
} from "~/server/generate/cancellation";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  EXPLANATION_REASONING_EFFORT,
  EXPLANATION_TEXT_VERBOSITY,
} from "~/server/generate/generation-policy";
import {
  extractTaggedSection,
  toTaggedMessage,
} from "~/server/generate/format";
import {
  getGithubData,
  REPOSITORY_TOO_LARGE_ERROR,
} from "~/server/generate/github";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  type GraphValidationCategory,
} from "~/server/generate/graph";
import {
  generateValidatedGraph,
  type GenerationUsageAccounting,
} from "~/server/generate/graph-planner";
import {
  getModel,
  getProvider,
  getProviderLabel,
  shouldUseExactInputTokenCount,
} from "~/server/generate/model-config";
import { streamCompletion } from "~/server/generate/openai";
import { SYSTEM_FIRST_PROMPT } from "~/server/generate/prompts";
import type { SuccessfulDiagramState } from "~/server/storage/generation-persistence";
import {
  createGenerationSessionAudit,
  toTerminalSessionAudit,
  withCompiledDiagram,
  withEstimatedCost,
  withExplanation,
  withFinalCost,
  withFailure,
  withStageUsage,
  withSuccess,
  withTimelineEvent,
} from "~/server/generate/session-audit";
import { coalesceTextChunks } from "~/server/generate/stream-buffer";
import {
  createGenerationSseWriter,
  type GenerationStreamState,
} from "~/server/generate/sse-writer";
import {
  assertModelPricingAvailable,
  createCostSummary,
} from "~/server/generate/pricing";
import { admitGenerationRequest } from "~/server/generate/request-admission";
import {
  finalizeGenerationStream,
  logGenerationFinished,
} from "~/server/generate/stream-finalization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FREE_GENERATION_INPUT_TOKEN_LIMIT = 100_000;
const HARD_GENERATION_INPUT_TOKEN_LIMIT = 195_000;
// Reserve enough of Vercel's 300s budget for quota reconciliation and a
// contention-safe R2 write even when an upstream generation runs unusually long.
const GENERATION_DEADLINE_MS = 220_000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

function createAbortError() {
  return new DOMException("Generation aborted.", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : createAbortError();
  }
}

export async function POST(request: Request) {
  const admission = await admitGenerationRequest(request);
  if (!admission.admitted) {
    return admission.response;
  }
  const {
    username,
    repo,
    apiKey,
    githubPat,
    sessionId,
    cancelToken,
    cancellationRegistered,
    rateLimitedClientIp,
  } = admission.value;
  const generationAbortController = new AbortController();
  const deadlineSignal = AbortSignal.timeout(GENERATION_DEADLINE_MS);
  const postResponseTasks: Array<() => Promise<void>> = [];
  if (cancellationRegistered && cancelToken) {
    postResponseTasks.push(async () => {
      try {
        await unregisterActiveGeneration(sessionId, cancelToken);
      } catch {
        console.warn(
          JSON.stringify({
            event: "generate.cancellation.cleanup_failed",
            session_id: sessionId,
            error: "Active cancellation registration cleanup failed.",
          }),
        );
      }
    });
  }
  let abortCause: "client" | "deadline" | null = null;
  const streamState: GenerationStreamState = {
    streamClosed: false,
    wasCancelled: false,
  };
  let notifyStreamPull: () => void = () => undefined;
  let resolveGenerationDone!: () => void;
  const generationDone = new Promise<void>((resolve) => {
    resolveGenerationDone = resolve;
  });

  const abortGeneration = (cause: "client" | "deadline") => {
    abortCause ??= cause;
    if (!generationAbortController.signal.aborted) {
      generationAbortController.abort(
        cause === "deadline"
          ? new DOMException("Generation deadline exceeded.", "TimeoutError")
          : createAbortError(),
      );
    }
    // Release any writer waiting on downstream backpressure. Normal writes
    // will observe the aborted signal and stop; a bounded terminal timeout
    // event may still be enqueued so a connected reader gets the final state.
    notifyStreamPull();
  };
  const handleRequestAbort = () => abortGeneration("client");
  const handleDeadline = () => abortGeneration("deadline");
  const stopCancellationPolling = cancellationRegistered
    ? startGenerationCancellationPolling({
        sessionId,
        onCancelled: () => abortGeneration("client"),
      })
    : () => undefined;

  request.signal.addEventListener("abort", handleRequestAbort, { once: true });
  deadlineSignal.addEventListener("abort", handleDeadline, { once: true });

  after(async () => {
    await generationDone;
    if (!postResponseTasks.length) {
      return;
    }
    const postResponseStartedAt = performance.now();
    const results = await Promise.allSettled(
      postResponseTasks.map((task) => task()),
    );
    console.info(
      JSON.stringify({
        event: "generate.post_response.finished",
        session_id: sessionId,
        task_count: results.length,
        rejected_task_count: results.filter(
          (result) => result.status === "rejected",
        ).length,
        elapsed_ms: Math.round(performance.now() - postResponseStartedAt),
      }),
    );
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const {
        close: closeStream,
        notifyPull,
        send,
        sendComment,
      } = createGenerationSseWriter({
        controller,
        signal: generationAbortController.signal,
        state: streamState,
        getAbortCause: () => abortCause,
        abortGeneration,
      });
      notifyStreamPull = notifyPull;

      void sendComment(`connected ${sessionId}`);
      const heartbeat = setInterval(
        () => void sendComment("keep-alive"),
        SSE_HEARTBEAT_INTERVAL_MS,
      );

      const run = async () => {
        let audit = createGenerationSessionAudit({
          sessionId,
          provider: "unknown",
          model: "unknown",
        });
        let estimate: GenerationEstimateResult | null = null;
        let quotaReservation: ComplimentaryQuotaReservation | null = null;
        const accounting: GenerationUsageAccounting = {
          actualUsages: [],
          hasCompleteMeasuredUsage: true,
          completedUnmeasuredTokenBound: 0,
          pendingModelRequestTokenBound: 0,
        };
        let terminalPayload: DiagramStreamMessage | null = null;
        let terminalErrorCode: string | null = null;
        let repositoryVerified = false;
        let successfulDiagramState: SuccessfulDiagramState | null = null;
        const invocationStartedAt = performance.now();
        const stageTimingsMs: Record<string, number> = {};
        const graphValidationCategoryCounts: Partial<
          Record<GraphValidationCategory, number>
        > = {};
        let storageVisibility: ArtifactVisibility = githubPat?.trim()
          ? "private"
          : "public";

        const recordTiming = (stage: string, startedAt: number) => {
          stageTimingsMs[stage] = Math.round(performance.now() - startedAt);
        };

        const queueTerminal = (payload: DiagramStreamMessage) => {
          terminalPayload = payload;
          terminalErrorCode =
            typeof payload.error_code === "string" ? payload.error_code : null;
        };

        try {
          throwIfAborted(generationAbortController.signal);
          send({
            status: "started",
            session_id: audit.sessionId,
            message: "Fetching repository data...",
          });
          const provider = getProvider();
          const providerLabel = getProviderLabel(provider);
          const model = getModel(provider);
          assertModelPricingAvailable(model);

          console.info(
            JSON.stringify({
              event: "generate.stream.started",
              session_id: audit.sessionId,
              provider,
              model,
              used_own_ai_key: Boolean(apiKey),
              used_private_github_token: Boolean(githubPat),
            }),
          );

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
              queueTerminal({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_PROVIDER_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
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
              queueTerminal({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_MODEL_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              return;
            }
          }

          const githubStartedAt = performance.now();
          const githubData = await getGithubData(
            username,
            repo,
            githubPat,
            generationAbortController.signal,
          );
          repositoryVerified = true;
          recordTiming("github", githubStartedAt);
          storageVisibility = githubData.isPrivate ? "private" : "public";
          const estimateStartedAt = performance.now();
          const appliesComplimentaryGate = shouldApplyComplimentaryGate({
            provider,
            apiKey,
          });
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
            signal: generationAbortController.signal,
            clientRequestId: `${audit.sessionId}:estimate`,
            includeGraphRepairInputTokens: appliesComplimentaryGate,
          });
          recordTiming("estimate", estimateStartedAt);
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
          if (tokenCount >= HARD_GENERATION_INPUT_TOKEN_LIMIT) {
            const error = REPOSITORY_TOO_LARGE_ERROR;
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            queueTerminal({
              status: "error",
              session_id: audit.sessionId,
              error,
              error_code: "TOKEN_LIMIT_EXCEEDED",
              validation_error: error,
              failure_stage: "started",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            return;
          }

          if (tokenCount > FREE_GENERATION_INPUT_TOKEN_LIMIT && !apiKey) {
            const error = `File tree and README combined exceeds token limit (${FREE_GENERATION_INPUT_TOKEN_LIMIT.toLocaleString("en-US")}). This repository is too large for free generation. Provide your own ${providerLabel} API key to continue.`;
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            queueTerminal({
              status: "error",
              session_id: audit.sessionId,
              error,
              error_code: "API_KEY_REQUIRED",
              validation_error: error,
              failure_stage: "started",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            return;
          }

          let complimentaryEstimate: ComplimentaryAdmissionEstimate | null =
            null;
          if (appliesComplimentaryGate) {
            if (estimate.graphRepairStaticInputTokens === null) {
              throw new Error(
                "Complimentary quota estimation is missing graph repair input.",
              );
            }
            complimentaryEstimate = {
              explanationInputTokens: estimate.explanationInputTokens,
              graphStaticInputTokens: estimate.graphStaticInputTokens,
              graphRepairStaticInputTokens:
                estimate.graphRepairStaticInputTokens,
            };
            const requestedTokens = buildComplimentaryAdmissionTokens(
              complimentaryEstimate,
            );
            const reservation = await admitComplimentaryQuota({
              model,
              requestedTokens,
            });

            if (!reservation.admitted) {
              const error =
                reservation.message || getComplimentaryDenialMessage();
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
              queueTerminal({
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
              return;
            }

            quotaReservation = reservation.reservation;
            audit = {
              ...audit,
              quotaStatus: "admitted",
              quotaBucket: quotaReservation.quotaBucket,
              quotaDateUtc: quotaReservation.quotaDateUtc,
              quotaResetAt: quotaReservation.quotaResetAt,
            };
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
          throwIfAborted(generationAbortController.signal);

          audit = withTimelineEvent(
            audit,
            "explanation",
            "Analyzing repository structure...",
          );
          send({
            status: "explanation",
            session_id: audit.sessionId,
            message: "Analyzing repository structure...",
          });

          let explanationResponse = "";
          if (quotaReservation) {
            await markComplimentaryQuotaStarted(quotaReservation);
          }
          accounting.pendingModelRequestTokenBound = complimentaryEstimate
            ? buildComplimentaryStageTokenBound(complimentaryEstimate, {
                stage: "explanation",
              })
            : 0;
          const explanationStartedAt = performance.now();
          let recordedFirstExplanationChunk = false;
          const explanationStream = await streamCompletion({
            provider,
            model,
            systemPrompt: SYSTEM_FIRST_PROMPT,
            userPrompt: toTaggedMessage({
              file_tree: githubData.fileTree,
              readme: githubData.readme,
            }),
            apiKey,
            reasoningEffort: EXPLANATION_REASONING_EFFORT,
            textVerbosity: EXPLANATION_TEXT_VERBOSITY,
            maxOutputTokens: EXPLANATION_MAX_OUTPUT_TOKENS,
            signal: generationAbortController.signal,
            clientRequestId: `${audit.sessionId}:explanation`,
          });
          for await (const chunk of coalesceTextChunks(
            explanationStream.stream,
          )) {
            throwIfAborted(generationAbortController.signal);
            if (!recordedFirstExplanationChunk) {
              recordTiming("explanation_first_chunk", explanationStartedAt);
              recordedFirstExplanationChunk = true;
            }
            explanationResponse += chunk;
            await send({
              status: "explanation_chunk",
              session_id: audit.sessionId,
              chunk,
            });
          }
          recordTiming("explanation", explanationStartedAt);
          let explanationUsage: GenerationTokenUsage | null = null;
          try {
            explanationUsage = await explanationStream.usagePromise;
          } catch {
            accounting.hasCompleteMeasuredUsage = false;
          }
          if (explanationUsage) {
            accounting.actualUsages.push(explanationUsage);
            accounting.pendingModelRequestTokenBound = 0;
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
            accounting.hasCompleteMeasuredUsage = false;
            accounting.completedUnmeasuredTokenBound +=
              accounting.pendingModelRequestTokenBound;
            accounting.pendingModelRequestTokenBound = 0;
          }

          const explanation = extractTaggedSection(
            explanationResponse,
            "explanation",
          );
          if (!explanation.trim()) {
            throw new Error(
              "OpenAI explanation generation returned no usable output.",
            );
          }
          audit = withExplanation(audit, explanation);

          const fileTreeLookup = buildFileTreeLookup(githubData.fileTree);
          const graphResult = await generateValidatedGraph({
            provider,
            model,
            apiKey,
            sessionId: audit.sessionId,
            explanation,
            fileTree: githubData.fileTree,
            fileTreeLookup,
            signal: generationAbortController.signal,
            audit,
            complimentaryEstimate,
            accounting,
            validationCategoryCounts: graphValidationCategoryCounts,
            recordTiming,
            send,
          });
          audit = graphResult.audit;
          if (!graphResult.ok) {
            audit = withFailure(audit, {
              failureStage: "graph_validating",
              validationError: graphResult.validationError,
            });
            queueTerminal({
              status: "error",
              session_id: audit.sessionId,
              error:
                "Graph generation remained invalid after retry attempts. Please retry generation.",
              error_code: "GRAPH_VALIDATION_FAILED",
              validation_error: graphResult.validationError,
              failure_stage: "graph_validating",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            return;
          }
          const validGraph = graphResult.graph;

          audit = withTimelineEvent(
            audit,
            "diagram_compiling",
            "Compiling Mermaid diagram...",
          );
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiling Mermaid diagram...",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
          });

          throwIfAborted(generationAbortController.signal);
          const diagramCompileStartedAt = performance.now();
          const diagram = compileDiagramGraph({
            graph: validGraph,
            username,
            repo,
            branch: githubData.defaultBranch,
            pathTypes: githubData.pathTypes,
          });
          recordTiming("diagram_compile", diagramCompileStartedAt);
          audit = withCompiledDiagram(audit, diagram);
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiled Mermaid diagram.",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
            diagram,
          });

          const finalCost = createFinalGenerationCostSummary({
            model,
            estimate,
            actualUsages: accounting.actualUsages,
            hasCompleteMeasuredUsage: accounting.hasCompleteMeasuredUsage,
            graphAttemptCount: audit.graphAttempts.length,
          });
          throwIfAborted(generationAbortController.signal);
          audit = withFinalCost(audit, finalCost);
          audit = withSuccess(
            withTimelineEvent(
              audit,
              "complete",
              "Diagram generation complete.",
            ),
          );
          successfulDiagramState = {
            stargazerCount: githubData.stargazerCount,
            explanation,
            graph: validGraph,
            diagram,
          };

          queueTerminal({
            status: "complete",
            session_id: audit.sessionId,
            cost_summary: audit.finalCost ?? audit.estimatedCost,
            diagram,
            explanation,
            graph: validGraph,
            generated_at: audit.updatedAt,
          });
        } catch (error) {
          if (
            generationAbortController.signal.aborted &&
            abortCause === "client"
          ) {
            streamState.wasCancelled = true;
            return;
          }
          accounting.hasCompleteMeasuredUsage = false;
          const deadlineExceeded = abortCause === "deadline";
          const rawMessage = deadlineExceeded
            ? "Generation timed out. Please retry."
            : error instanceof Error
              ? error.message
              : "Streaming generation failed.";
          const normalized = deadlineExceeded
            ? { message: rawMessage, errorCode: "GENERATION_TIMEOUT" }
            : normalizeGenerationError({
                provider: audit.provider,
                apiKey,
                message: rawMessage,
                error,
              });
          if (normalized.message !== rawMessage) {
            // The client and the persisted audit only ever see the normalized
            // message, so this is the one place the original survives.
            console.error(
              JSON.stringify({
                event: "generate.stream.error_redacted",
                session_id: audit.sessionId,
                error_code: normalized.errorCode,
                raw_error: rawMessage.slice(0, 500),
              }),
            );
          }
          audit = withFailure(audit, {
            failureStage: audit.stage || "started",
            validationError: normalized.message,
          });
          queueTerminal({
            status: "error",
            session_id: audit.sessionId,
            error: normalized.message,
            error_code: normalized.errorCode,
            failure_stage: audit.failureStage,
            validation_error: audit.validationError,
            cost_summary: audit.finalCost ?? audit.estimatedCost,
            latest_session_audit: audit,
          });
        } finally {
          const sendTerminal = async (
            terminalAudit: typeof audit,
            persistenceWarning?: string,
          ) => {
            clearInterval(heartbeat);
            const finalTerminalPayload = terminalPayload;
            if (!finalTerminalPayload || streamState.wasCancelled) {
              return false;
            }
            return send(
              {
                ...finalTerminalPayload,
                cost_summary:
                  terminalAudit.finalCost ?? terminalAudit.estimatedCost,
                latest_session_audit: toTerminalSessionAudit(terminalAudit),
                ...(persistenceWarning
                  ? { persistence_warning: persistenceWarning }
                  : {}),
              },
              // Eligibility is checked again after backpressure clears because
              // a deadline can fire while this terminal is already queued.
              { allowDeadlineTerminal: true },
            );
          };

          audit = await finalizeGenerationStream({
            abortCause,
            accounting,
            apiKey,
            audit,
            githubPat,
            postResponseTasks,
            quotaReservation,
            rateLimitedClientIp,
            recordTiming,
            repo,
            repositoryVerified,
            sendTerminal,
            storageVisibility,
            streamState,
            successfulDiagramState,
            username,
          });

          clearInterval(heartbeat);
          stopCancellationPolling();
          request.signal.removeEventListener("abort", handleRequestAbort);
          deadlineSignal.removeEventListener("abort", handleDeadline);
          await closeStream();

          logGenerationFinished({
            accounting,
            audit,
            graphValidationCategoryCounts,
            invocationStartedAt,
            stageTimingsMs,
            storageVisibility,
            streamState,
            terminalErrorCode,
          });
        }
      };

      void run()
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "generate.stream.unhandled_failure",
              session_id: sessionId,
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          );
        })
        .finally(resolveGenerationDone);
    },
    pull() {
      notifyStreamPull();
    },
    cancel() {
      streamState.streamClosed = true;
      notifyStreamPull();
      abortGeneration("client");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "X-Generation-Session-Id": sessionId,
    },
  });
}
