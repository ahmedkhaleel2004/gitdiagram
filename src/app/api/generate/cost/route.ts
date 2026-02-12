import { NextResponse } from "next/server";

import { toTaggedMessage } from "~/server/generate/format";
import { getGithubData } from "~/server/generate/github";
import { getModel } from "~/server/generate/model-config";
import { countInputTokens, estimateTokens } from "~/server/generate/openai";
import { SYSTEM_FIRST_PROMPT } from "~/server/generate/prompts";
import { estimateTextTokenCostUsd } from "~/server/generate/pricing";
import { generateRequestSchema } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MULTI_STAGE_INPUT_MULTIPLIER = 2;
const INPUT_OVERHEAD_TOKENS = 3000;
const ESTIMATED_OUTPUT_TOKENS = 8000;

async function estimateRepoInputTokens(
  model: string,
  fileTree: string,
  readme: string,
  apiKey?: string,
) {
  try {
    return await countInputTokens({
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
    const githubData = await getGithubData(username, repo, githubPat);
    const model = getModel();

    const baseInputTokens = await estimateRepoInputTokens(
      model,
      githubData.fileTree,
      githubData.readme,
      apiKey,
    );
    const estimatedInputTokens =
      baseInputTokens * MULTI_STAGE_INPUT_MULTIPLIER + INPUT_OVERHEAD_TOKENS;
    const estimatedOutputTokens = ESTIMATED_OUTPUT_TOKENS;

    const { costUsd, pricingModel, pricing } = estimateTextTokenCostUsd(
      model,
      estimatedInputTokens,
      estimatedOutputTokens,
    );

    return NextResponse.json({
      ok: true,
      cost: `$${costUsd.toFixed(2)} USD`,
      model,
      pricing_model: pricingModel,
      estimated_input_tokens: estimatedInputTokens,
      estimated_output_tokens: estimatedOutputTokens,
      pricing: {
        input_per_million_usd: pricing.inputPerMillionUsd,
        output_per_million_usd: pricing.outputPerMillionUsd,
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
