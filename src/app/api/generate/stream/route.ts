import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import {
  diagramGraphSchema,
  MAX_GRAPH_ATTEMPTS,
  type DiagramGraph,
} from "~/features/diagram/graph";
import type { ArtifactVisibility } from "~/server/storage/types";
import { writePublicDiagramPreview } from "~/server/storage/artifact-store";
import { revalidateBrowseIndexCache } from "~/app/browse/data";
import {
  clearSuccessfulDiagramFailureSummary,
  persistTerminalSessionAudit,
  saveSuccessfulDiagramState,
  updatePublicBrowseIndexForSuccessfulDiagram,
} from "~/server/storage/diagram-state";
import {
  admitComplimentaryQuota,
  buildComplimentaryAdmissionTokens,
  buildComplimentaryStageTokenBound,
  finalizeComplimentaryQuota,
  getComplimentaryDenialMessage,
  getComplimentaryModelMismatchMessage,
  getComplimentaryProviderMismatchMessage,
  isComplimentaryGateEnabled,
  modelMatchesComplimentaryFamily,
  shouldApplyComplimentaryGate,
  type ComplimentaryQuotaReservation,
} from "~/server/generate/complimentary-gate";
import {
  estimateGenerationCost,
  type GenerationEstimateResult,
} from "~/server/generate/cost-estimate";
import {
  registerActiveGeneration,
  startGenerationCancellationPolling,
  unregisterActiveGeneration,
} from "~/server/generate/cancellation";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  EXPLANATION_REASONING_EFFORT,
  EXPLANATION_TEXT_VERBOSITY,
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_REASONING_EFFORT,
  GRAPH_TEXT_VERBOSITY,
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
  formatGraphValidationFeedback,
  type GraphValidationCategory,
  validateDiagramGraph,
} from "~/server/generate/graph";
import {
  getModel,
  getProvider,
  getProviderLabel,
  shouldUseExactInputTokenCount,
} from "~/server/generate/model-config";
import {
  generateStructuredOutput,
  streamCompletion,
} from "~/server/generate/openai";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "~/server/generate/prompts";
import {
  getPublicDiagramStateCacheTag,
  getRepoPagePath,
} from "~/server/storage/repo-page-cache";
import {
  createGenerationSessionAudit,
  toTerminalSessionAudit,
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
  canWriteStreamMessage,
  coalesceTextChunks,
} from "~/server/generate/stream-buffer";
import {
  createCostSummary,
  sumGenerationUsage,
} from "~/server/generate/pricing";
import { parseGenerateRequest, sseMessage } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED_ERROR =
  "GitDiagram's default OpenAI key is temporarily unavailable because its upstream API quota is exhausted. I'm a solo student engineer running this free and open source, so please try again later or use your own OpenAI API key.";
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
  if (params.message === REPOSITORY_TOO_LARGE_ERROR) {
    return {
      message: params.message,
      errorCode: "TOKEN_LIMIT_EXCEEDED",
    };
  }

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
  const parsed = await parseGenerateRequest(request);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: parsed.error,
        error_code: parsed.errorCode,
      }),
      {
        status: parsed.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const {
    username,
    repo,
    api_key: apiKey,
    github_pat: githubPat,
    session_id: requestedSessionId,
    cancel_token: requestedCancelToken,
  } = parsed.data;

  const sessionId = requestedSessionId ?? randomUUID();
  let cancellationRegistered = false;
  if (requestedSessionId && requestedCancelToken) {
    try {
      cancellationRegistered = await registerActiveGeneration(
        sessionId,
        requestedCancelToken,
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "generate.cancellation.registration_failed",
          session_id: sessionId,
          error: "Cancellation registration is temporarily unavailable.",
        }),
      );
      return Response.json(
        {
          ok: false,
          error: "Generation is temporarily unavailable. Please retry.",
          error_code: "CANCELLATION_UNAVAILABLE",
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }

    if (!cancellationRegistered) {
      return Response.json(
        {
          ok: false,
          error: "Generation session already exists. Please retry.",
          error_code: "SESSION_CONFLICT",
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
  }
  const encoder = new TextEncoder();
  const generationAbortController = new AbortController();
  const deadlineSignal = AbortSignal.timeout(GENERATION_DEADLINE_MS);
  const postResponseTasks: Array<() => Promise<void>> = [];
  if (cancellationRegistered && requestedCancelToken) {
    postResponseTasks.push(async () => {
      try {
        await unregisterActiveGeneration(sessionId, requestedCancelToken);
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
  let streamClosed = false;
  let notifyStreamPull = () => undefined;
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
      let wasCancelled = false;
      const pullWaiters = new Set<() => void>();
      let writeTail: Promise<void> = Promise.resolve();

      notifyStreamPull = () => {
        for (const resolve of pullWaiters) {
          resolve();
        }
        pullWaiters.clear();
      };

      const waitForCapacity = async () => {
        while (
          !streamClosed &&
          !generationAbortController.signal.aborted &&
          controller.desiredSize !== null &&
          controller.desiredSize <= 0
        ) {
          await new Promise<void>((resolve) => pullWaiters.add(resolve));
        }
      };

      const closeStream = async () => {
        await writeTail;
        if (streamClosed) {
          return;
        }
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The consumer may already have cancelled the stream.
        }
      };

      const queueWrite = (
        message: string,
        options?: { allowDeadlineTerminal?: boolean },
      ): Promise<boolean> => {
        const write = writeTail.then(async () => {
          const canWrite = () =>
            canWriteStreamMessage({
              abortCause,
              aborted: generationAbortController.signal.aborted,
              allowDeadlineTerminal: Boolean(options?.allowDeadlineTerminal),
              streamClosed,
            });

          if (!canWrite()) {
            return false;
          }

          await waitForCapacity();
          if (!canWrite()) {
            return false;
          }

          try {
            controller.enqueue(encoder.encode(message));
            return true;
          } catch {
            streamClosed = true;
            wasCancelled = true;
            notifyStreamPull();
            abortGeneration("client");
            return false;
          }
        });
        writeTail = write.then(() => undefined);
        return write;
      };

      const send = (
        payload: Record<string, unknown>,
        options?: { allowDeadlineTerminal?: boolean },
      ): Promise<boolean> => {
        if (
          !canWriteStreamMessage({
            abortCause,
            aborted: generationAbortController.signal.aborted,
            allowDeadlineTerminal: Boolean(options?.allowDeadlineTerminal),
            streamClosed,
          })
        ) {
          return Promise.resolve(false);
        }
        return queueWrite(sseMessage(payload), options);
      };

      const sendComment = (comment: string): Promise<boolean> => {
        if (streamClosed || generationAbortController.signal.aborted) {
          return Promise.resolve(false);
        }
        return queueWrite(`: ${comment}\n\n`);
      };

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
        const actualUsages: GenerationTokenUsage[] = [];
        let hasCompleteMeasuredUsage = true;
        let completedUnmeasuredTokenBound = 0;
        let pendingModelRequestTokenBound = 0;
        let terminalPayload: Record<string, unknown> | null = null;
        let terminalErrorCode: string | null = null;
        let repositoryVerified = false;
        let successfulDiagramState: {
          stargazerCount: number | null;
          explanation: string;
          graph: DiagramGraph;
          diagram: string;
        } | null = null;
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

        const queueTerminal = (payload: Record<string, unknown>) => {
          terminalPayload = payload;
          terminalErrorCode =
            typeof payload.error_code === "string" ? payload.error_code : null;
        };

        const persistTerminalAudit = async (nextAudit = audit) => {
          if (!repositoryVerified) {
            return;
          }
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
          send({
            status: "started",
            session_id: audit.sessionId,
            message: "Fetching repository data...",
          });
          const provider = getProvider();
          const providerLabel = getProviderLabel(provider);
          const model = getModel(provider);

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
          if (
            tokenCount > FREE_GENERATION_INPUT_TOKEN_LIMIT &&
            tokenCount < HARD_GENERATION_INPUT_TOKEN_LIMIT &&
            !apiKey
          ) {
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

          if (tokenCount > HARD_GENERATION_INPUT_TOKEN_LIMIT) {
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

            const requestedTokens = buildComplimentaryAdmissionTokens({
              explanationInputTokens: estimate.explanationInputTokens,
              graphStaticInputTokens: estimate.graphStaticInputTokens,
              graphRepairStaticInputTokens:
                estimate.graphRepairStaticInputTokens,
            });
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
          pendingModelRequestTokenBound = buildComplimentaryStageTokenBound(
            estimate,
            {
              stage: "explanation",
            },
          );
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
            hasCompleteMeasuredUsage = false;
          }
          if (explanationUsage) {
            actualUsages.push(explanationUsage);
            pendingModelRequestTokenBound = 0;
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
            completedUnmeasuredTokenBound += pendingModelRequestTokenBound;
            pendingModelRequestTokenBound = 0;
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

            pendingModelRequestTokenBound = buildComplimentaryStageTokenBound(
              estimate,
              {
                stage: "graph",
                attempt,
              },
            );
            const graphStartedAt = performance.now();
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
              apiKey,
              reasoningEffort: GRAPH_REASONING_EFFORT,
              textVerbosity: GRAPH_TEXT_VERBOSITY,
              maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
              signal: generationAbortController.signal,
              clientRequestId: `${audit.sessionId}:graph:${attempt}`,
            });
            recordTiming(`graph_attempt_${attempt}`, graphStartedAt);

            if (usage) {
              actualUsages.push(usage);
              pendingModelRequestTokenBound = 0;
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
              completedUnmeasuredTokenBound += pendingModelRequestTokenBound;
              pendingModelRequestTokenBound = 0;
            }

            send({
              status,
              session_id: audit.sessionId,
              graph,
            });

            const graphValidationStartedAt = performance.now();
            const graphValidation = validateDiagramGraph(graph, fileTreeLookup);
            recordTiming(
              `graph_validation_${attempt}`,
              graphValidationStartedAt,
            );
            const validationCategories = [
              ...new Set(graphValidation.issues.map((issue) => issue.category)),
            ];
            for (const category of validationCategories) {
              graphValidationCategoryCounts[category] =
                (graphValidationCategoryCounts[category] ?? 0) + 1;
            }
            const attemptAudit = {
              attempt,
              rawOutput: rawText,
              graph,
              validationFeedback: graphValidation.valid
                ? undefined
                : formatGraphValidationFeedback(graphValidation.issues),
              validationCategories: graphValidation.valid
                ? undefined
                : validationCategories,
              status: (graphValidation.valid ? "succeeded" : "failed") as
                "failed" | "succeeded",
              createdAt: new Date().toISOString(),
            };

            audit = withGraphAttempt(audit, attemptAudit);

            if (!graphValidation.valid) {
              validationFeedback = formatGraphValidationFeedback(
                graphValidation.issues,
              );
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
            queueTerminal({
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
            return;
          }

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
                note: "Some stage usage was unavailable, so the final cost remains approximate.",
              };
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
            wasCancelled = true;
            return;
          }
          hasCompleteMeasuredUsage = false;
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
              });
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
          let terminalSent = false;
          let persistenceWarning: string | undefined;
          const sendTerminal = async () => {
            clearInterval(heartbeat);
            const finalTerminalPayload = terminalPayload as Record<
              string,
              unknown
            > | null;
            if (!finalTerminalPayload || wasCancelled) {
              return;
            }
            terminalSent = await send(
              {
                ...finalTerminalPayload,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: toTerminalSessionAudit(audit),
                ...(persistenceWarning
                  ? { persistence_warning: persistenceWarning }
                  : {}),
              },
              // Eligibility is checked again after backpressure clears because
              // a deadline can fire while this terminal is already queued.
              { allowDeadlineTerminal: true },
            );
          };

          // A timeout must reach the client before best-effort cleanup consumes
          // the remaining Vercel function budget.
          if (abortCause === "deadline") {
            await sendTerminal();
          }

          if (quotaReservation) {
            const quotaFinalizationStartedAt = performance.now();
            const measuredCommittedTokens = sumGenerationUsage(
              ...actualUsages,
            ).totalTokens;
            const actualCommittedTokens =
              hasCompleteMeasuredUsage && !wasCancelled
                ? measuredCommittedTokens
                : Math.min(
                    quotaReservation.reservedTokens,
                    measuredCommittedTokens +
                      completedUnmeasuredTokenBound +
                      pendingModelRequestTokenBound,
                  );

            try {
              await finalizeComplimentaryQuota({
                reservation: quotaReservation,
                committedTokens: actualCommittedTokens,
              });
              audit = {
                ...audit,
                quotaStatus: "finalized",
                quotaBucket: quotaReservation.quotaBucket,
                quotaDateUtc: quotaReservation.quotaDateUtc,
                actualCommittedTokens,
                quotaResetAt: quotaReservation.quotaResetAt,
              };
            } catch (quotaError) {
              console.error(
                JSON.stringify({
                  event: "generate.quota.finalization_failed",
                  session_id: audit.sessionId,
                  error:
                    quotaError instanceof Error
                      ? quotaError.message
                      : "Unknown error",
                }),
              );
            } finally {
              recordTiming("quota_finalization", quotaFinalizationStartedAt);
            }
          }

          if (repositoryVerified) {
            const persistenceStartedAt = performance.now();
            try {
              if (successfulDiagramState && audit.status === "succeeded") {
                const artifactPersistenceStartedAt = performance.now();
                const artifactWritten = await saveSuccessfulDiagramState({
                  username,
                  repo,
                  githubPat,
                  visibility: storageVisibility,
                  stargazerCount: successfulDiagramState.stargazerCount,
                  explanation: successfulDiagramState.explanation,
                  graph: successfulDiagramState.graph,
                  diagram: successfulDiagramState.diagram,
                  audit,
                  usedOwnKey: Boolean(apiKey),
                });
                recordTiming(
                  "artifact_persistence",
                  artifactPersistenceStartedAt,
                );

                if (artifactWritten) {
                  postResponseTasks.push(async () => {
                    try {
                      await clearSuccessfulDiagramFailureSummary({
                        username,
                        repo,
                        githubPat,
                        visibility: storageVisibility,
                      });
                    } catch (error) {
                      console.error(
                        JSON.stringify({
                          event:
                            "generate.persistence.failure_summary_cleanup_failed",
                          session_id: audit.sessionId,
                          error:
                            error instanceof Error
                              ? error.message
                              : "Unknown error",
                        }),
                      );
                    }
                  });
                }

                if (storageVisibility === "public" && artifactWritten) {
                  const lastSuccessfulAt =
                    audit.updatedAt ?? new Date().toISOString();
                  const publicDiagram = successfulDiagramState.diagram;
                  postResponseTasks.push(async () => {
                    try {
                      await writePublicDiagramPreview({
                        username,
                        repo,
                        diagram: publicDiagram,
                        lastSuccessfulAt,
                      });
                    } catch (error) {
                      console.warn(
                        JSON.stringify({
                          event: "generate.persistence.preview_write_failed",
                          session_id: audit.sessionId,
                          error:
                            error instanceof Error
                              ? error.message
                              : "Unknown error",
                        }),
                      );
                    }
                  });
                  postResponseTasks.push(async () => {
                    try {
                      revalidatePath(getRepoPagePath(username, repo));
                      revalidateTag(
                        getPublicDiagramStateCacheTag(username, repo),
                        "max",
                      );
                      await updatePublicBrowseIndexForSuccessfulDiagram({
                        username,
                        repo,
                        lastSuccessfulAt,
                        stargazerCount:
                          successfulDiagramState?.stargazerCount ?? null,
                      });
                      revalidateBrowseIndexCache();
                    } catch (error) {
                      console.error(
                        "Failed to update browse index after completion:",
                        error,
                      );
                    }
                  });
                }
              } else {
                const auditPersistenceStartedAt = performance.now();
                await persistTerminalAudit();
                recordTiming("audit_persistence", auditPersistenceStartedAt);
              }
            } catch (persistenceError) {
              if (successfulDiagramState && audit.status === "succeeded") {
                persistenceWarning =
                  "The diagram was generated, but could not be cached. It may need to be regenerated after a refresh.";
              }
              console.error(
                JSON.stringify({
                  event:
                    successfulDiagramState && audit.status === "succeeded"
                      ? "generate.persistence.diagram_failed"
                      : "generate.persistence.audit_failed",
                  session_id: audit.sessionId,
                  error:
                    persistenceError instanceof Error
                      ? persistenceError.message
                      : "Unknown error",
                }),
              );
            }
            recordTiming("persistence", persistenceStartedAt);
          }

          if (!terminalSent) {
            await sendTerminal();
          }

          clearInterval(heartbeat);
          stopCancellationPolling();
          request.signal.removeEventListener("abort", handleRequestAbort);
          deadlineSignal.removeEventListener("abort", handleDeadline);
          await closeStream();

          const totalUsage = sumGenerationUsage(...actualUsages);
          console.info(
            JSON.stringify({
              event: "generate.stream.finished",
              session_id: audit.sessionId,
              outcome: wasCancelled
                ? "cancelled"
                : audit.status === "succeeded"
                  ? "succeeded"
                  : "failed",
              error_code: terminalErrorCode,
              stage: audit.failureStage ?? audit.stage,
              elapsed_ms: Math.round(performance.now() - invocationStartedAt),
              stage_timings_ms: stageTimingsMs,
              provider: audit.provider,
              model: audit.model,
              visibility: storageVisibility,
              input_tokens: totalUsage.inputTokens,
              output_tokens: totalUsage.outputTokens,
              total_tokens: totalUsage.totalTokens,
              cached_input_tokens: totalUsage.cachedInputTokens ?? 0,
              reasoning_tokens: totalUsage.reasoningTokens ?? 0,
              graph_validation_categories: graphValidationCategoryCounts,
              quota_committed_tokens: audit.actualCommittedTokens ?? null,
            }),
          );
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
      streamClosed = true;
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
