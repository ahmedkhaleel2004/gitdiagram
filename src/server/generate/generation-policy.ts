// A direct source-grounded pass keeps generation responsive without costly
// model escalation. Repairs get additional reasoning only when validation fails.
export const EXPLANATION_REASONING_EFFORT = "low" as const;
// One recovery attempt leaves room for repository ingestion and rendering.
export const ARCHITECTURE_SLOW_RETRY_MS = 18_000;
// GPT-6 Luna overthinks this bounded extraction task at medium effort. Low
// keeps its normal pass responsive; structural repairs still use medium.
export function getArchitectureReasoningEffort(
  model: string,
): "low" | "medium" {
  return /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/i.test(model.trim())
    ? "low"
    : "medium";
}
export const GRAPH_REASONING_EFFORT = "medium" as const;

export const EXPLANATION_TEXT_VERBOSITY = "low" as const;
export const GRAPH_TEXT_VERBOSITY = "low" as const;

// Cost and quota reservation estimates only. Provider requests deliberately omit
// max_output_tokens so reasoning and output can finish beyond these estimates.
export const EXPLANATION_ESTIMATED_OUTPUT_TOKENS = 8_000;
export const GRAPH_ESTIMATED_OUTPUT_TOKENS = 6_000;
export const GRAPH_RETRY_INPUT_BUFFER_TOKENS = 2_000;

// GPT-6 Luna and the GPT-5.6 models accept 922K input tokens. The prompt is
// already bounded by repository-context.ts, so this only stops a request the
// model would reject, with headroom for a graph repair.
export const MAX_GENERATION_INPUT_TOKENS = 900_000;
