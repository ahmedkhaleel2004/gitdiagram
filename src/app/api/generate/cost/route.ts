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
  consumeGenerationRateLimit,
  getGenerationRateLimitMessage,
} from "~/server/generate/rate-limit";
import { parseGenerateRequest } from "~/server/generate/types";
import { getClientIp } from "~/server/http/client-ip";
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

    // Callers on their own key pay for their own usage; everyone else shares
    // the server's GitHub budget, exactly as in the stream route.
    if (!apiKey?.trim()) {
      const rateLimit = await consumeGenerationRateLimit({
        clientIp: getClientIp(request),
      });
      if (!rateLimit.allowed) {
        return jsonResponse(
          {
            ok: false,
            error: getGenerationRateLimitMessage(rateLimit.retryAfterSeconds),
            error_code: "RATE_LIMITED",
          },
          { status: 429, requestId },
        );
      }
    }
    const provider = getProvider();
    const model = getModel(provider);

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
    const estimate = await estimateGenerationCost({
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
      signal,
      clientRequestId: `${requestId}:estimate`,
    });

    return jsonResponse(
      {
        ok: true,
        cost: estimate.costSummary.display,
        cost_summary: estimate.costSummary,
        model,
        pricing_model: estimate.pricingModel,
        estimated_input_tokens: estimate.estimatedInputTokens,
        estimated_output_tokens: estimate.estimatedOutputTokens,
        pricing: {
          input_per_million_usd: estimate.pricing.inputPerMillionUsd,
          output_per_million_usd: estimate.pricing.outputPerMillionUsd,
        },
      },
      { requestId },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to estimate generation cost.";
    const timedOut = deadlineSignal.aborted;
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
          : repositoryTooLarge || repositoryNotFound
            ? message
            : "Failed to estimate generation cost. Please retry.",
        error_code: timedOut
          ? "GENERATION_TIMEOUT"
          : repositoryTooLarge
            ? "TOKEN_LIMIT_EXCEEDED"
            : repositoryNotFound
              ? "REPOSITORY_NOT_FOUND"
              : "COST_ESTIMATION_FAILED",
      },
      {
        status: timedOut
          ? 504
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
