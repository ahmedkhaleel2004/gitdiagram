import { NextResponse } from "next/server";

import { estimateGenerationCost } from "~/server/generate/cost-estimate";
import {
  getComplimentaryModelMismatchMessage,
  getComplimentaryProviderMismatchMessage,
  isComplimentaryGateEnabled,
  modelMatchesComplimentaryFamily,
} from "~/server/generate/complimentary-gate";
import { getGithubData } from "~/server/generate/github";
import {
  getModel,
  getProvider,
  shouldUseExactInputTokenCount,
} from "~/server/generate/model-config";
import { generateRequestSchema } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const parsed = generateRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: "Invalid request payload.",
        error_code: "VALIDATION_ERROR",
      });
    }

    const {
      username,
      repo,
      api_key: apiKey,
      github_pat: githubPat,
    } = parsed.data;
    const provider = getProvider();
    const model = getModel(provider);

    if (isComplimentaryGateEnabled() && !apiKey) {
      if (provider !== "openai") {
        return NextResponse.json({
          ok: false,
          error: getComplimentaryProviderMismatchMessage(),
          error_code: "COMPLIMENTARY_GATE_PROVIDER_MISMATCH",
        });
      }

      if (!modelMatchesComplimentaryFamily(model)) {
        return NextResponse.json({
          ok: false,
          error: getComplimentaryModelMismatchMessage(),
          error_code: "COMPLIMENTARY_GATE_MODEL_MISMATCH",
        });
      }
    }

    const githubData = await getGithubData(username, repo, githubPat);
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
    });

    return NextResponse.json({
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
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to estimate generation cost.",
      error_code: "COST_ESTIMATION_FAILED",
    });
  }
}
