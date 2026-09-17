import {
  prepareRepositoryContext,
  selectAnalysisModel,
  MAX_SOURCE_CHARACTERS,
} from "~/server/generate/repository-context";
import { estimateTokens } from "~/server/generate/openai";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { estimateGenerationCost } from "~/server/generate/cost-estimate";
import {
  getComplimentaryModelMismatchMessage,
  getComplimentaryProviderMismatchMessage,
  isComplimentaryGateEnabled,
  modelMatchesComplimentaryFamily,
} from "~/server/generate/complimentary-gate";
import {
  getGithubData,
  REPOSITORY_TOO_LARGE_ERROR,
} from "~/server/generate/github";
import {
  getModel,
  getProvider,
  shouldUseExactInputTokenCount,
} from "~/server/generate/model-config";
import {
  consumeGenerationInfrastructureRateLimit,
  getGenerationInfrastructureRateLimitMessage,
} from "~/server/generate/rate-limit";
import {
  assertModelPricingAvailable,
  MODEL_PRICING_UNAVAILABLE_ERROR,
  ModelPricingUnavailableError,
} from "~/server/generate/pricing";
import { parseGenerateRequest } from "~/server/generate/types";
import { getClientIp } from "~/server/http/client-ip";
import { classifyGitHubError } from "~/server/generate/github-errors";
import { resolveRequestCredentials } from "~/server/http/request-credentials";
import { isSameOriginRequest } from "~/server/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COST_REQUEST_DEADLINE_MS = 55_000;

function jsonResponse(
  body: Record<string, unknown>,
  init: { status?: number; requestId: string },
) {
  return NextResponse.json(body, {
    status: init.status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Generation-Request-Id": init.requestId,
    },
  });
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const deadlineSignal = AbortSignal.timeout(COST_REQUEST_DEADLINE_MS);
  const signal = AbortSignal.any([request.signal, deadlineSignal]);
  let hasCallerGithubToken = false;

  try {
    // Estimation runs the same bounded GitHub ingestion as a real generation,
    // so an unguarded endpoint lets anyone drain the server's shared GitHub
    // API budget and take generation down for everybody.
    if (!isSameOriginRequest(request)) {
      return jsonResponse(
        {
          ok: false,
          error: "Cross-origin cost estimation is not allowed.",
          error_code: "CROSS_ORIGIN_FORBIDDEN",
        },
        { status: 403, requestId },
      );
    }

    const parsed = await parseGenerateRequest(request);
    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          error: parsed.error,
          error_code: parsed.errorCode,
        },
        { status: parsed.status, requestId },
      );
    }

    const { username, repo } = parsed.data;
    const { apiKey, githubPat } = await resolveRequestCredentials(request, {
      apiKey: parsed.data.api_key,
      githubPat: parsed.data.github_pat,
    });

    const rateLimit = await consumeGenerationInfrastructureRateLimit({
      clientIp: getClientIp(request),
    });
    hasCallerGithubToken = Boolean(githubPat?.trim());
    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          ok: false,
          error: getGenerationInfrastructureRateLimitMessage(
            rateLimit.retryAfterSeconds,
          ),
          error_code: "RATE_LIMITED",
        },
        { status: 429, requestId },
      );
    }
    const provider = getProvider();
    const model = getModel(provider);
    assertModelPricingAvailable(model);

    if (isComplimentaryGateEnabled() && !apiKey) {
      if (provider !== "openai") {
        return jsonResponse(
          {
            ok: false,
            error: getComplimentaryProviderMismatchMessage(),
            error_code: "COMPLIMENTARY_GATE_PROVIDER_MISMATCH",
          },
          { requestId },
        );
      }

      if (!modelMatchesComplimentaryFamily(model)) {
        return jsonResponse(
          {
            ok: false,
            error: getComplimentaryModelMismatchMessage(),
            error_code: "COMPLIMENTARY_GATE_MODEL_MISMATCH",
          },
          { requestId },
        );
      }
    }

    const githubData = await getGithubData(username, repo, githubPat, signal);
    const context = prepareRepositoryContext(githubData);
    const analysisModel = selectAnalysisModel({
      provider,
      model,
      apiKey,
      pathTypes: githubData.pathTypes,
    });
    const estimate = await estimateGenerationCost({
      provider,
      model,
      analysisModel,
      sourceTokenReserve: context.selectedPaths.length
        ? estimateTokens("x".repeat(MAX_SOURCE_CHARACTERS))
        : 0,
      fileTree: context.fileTree,
      readme: context.readme,
      username,
      repo,
      apiKey,
      preferExactInputTokenCount: shouldUseExactInputTokenCount({
        provider,
        apiKey,
      }),
      signal,
      clientRequestId: `${requestId}:estimate`,
    });

    return jsonResponse(
      {
        ok: true,
        cost: estimate.costSummary.display,
        cost_summary: estimate.costSummary,
        model,
        analysis_model: analysisModel,
        pricing_model: estimate.pricingModel,
        estimated_input_tokens: estimate.estimatedInputTokens,
        estimated_output_tokens: estimate.estimatedOutputTokens,
        analysis_pricing: {
          model: analysisModel,
          input_per_million_usd: (estimate.analysisPricing ?? estimate.pricing)
            .inputPerMillionUsd,
          output_per_million_usd: (estimate.analysisPricing ?? estimate.pricing)
            .outputPerMillionUsd,
        },
        pricing: {
          model,
          input_per_million_usd: estimate.pricing.inputPerMillionUsd,
          output_per_million_usd: estimate.pricing.outputPerMillionUsd,
        },
      },
      { requestId },
    );
  } catch (error) {
    const githubError = classifyGitHubError(error, hasCallerGithubToken);
    if (githubError && !deadlineSignal.aborted) {
      return jsonResponse(
        {
          ok: false,
          error: githubError.message,
          error_code: githubError.errorCode,
        },
        { status: githubError.status, requestId },
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : "Failed to estimate generation cost.";
    const timedOut = deadlineSignal.aborted;
    const pricingUnavailable = error instanceof ModelPricingUnavailableError;
    const repositoryTooLarge = message === REPOSITORY_TOO_LARGE_ERROR;
    const repositoryNotFound = message === "Repository not found.";

    if (!timedOut && !repositoryTooLarge && !repositoryNotFound) {
      // Upstream failures carry raw GitHub and provider response bodies. Log
      // them, but hand the caller a fixed message like the stream route does.
      console.error(
        JSON.stringify({
          event: "generate.cost.failed",
          request_id: requestId,
          error: message,
        }),
      );
    }

    return jsonResponse(
      {
        ok: false,
        error: timedOut
          ? "Cost estimation timed out. Please retry."
          : pricingUnavailable
            ? MODEL_PRICING_UNAVAILABLE_ERROR
            : repositoryTooLarge || repositoryNotFound
              ? message
              : "Failed to estimate generation cost. Please retry.",
        error_code: timedOut
          ? "GENERATION_TIMEOUT"
          : pricingUnavailable
            ? "MODEL_PRICING_UNAVAILABLE"
            : repositoryTooLarge
              ? "TOKEN_LIMIT_EXCEEDED"
              : repositoryNotFound
                ? "REPOSITORY_NOT_FOUND"
                : "COST_ESTIMATION_FAILED",
      },
      {
        status: timedOut
          ? 504
          : pricingUnavailable
            ? 503
            : repositoryTooLarge
              ? 413
              : repositoryNotFound
                ? 404
                : 500,
        requestId,
      },
    );
  }
}
