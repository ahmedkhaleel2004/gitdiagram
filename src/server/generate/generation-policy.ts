// A direct source-grounded pass keeps generation responsive without costly
// model escalation. Repairs get additional reasoning only when validation fails.
export const EXPLANATION_REASONING_EFFORT = "low" as const;
export const GRAPH_REASONING_EFFORT = "medium" as const;

export const EXPLANATION_TEXT_VERBOSITY = "low" as const;
export const GRAPH_TEXT_VERBOSITY = "low" as const;

// Cost and quota reservation estimates only. Provider requests deliberately omit
// max_output_tokens so reasoning and output can finish beyond these estimates.
export const EXPLANATION_ESTIMATED_OUTPUT_TOKENS = 8_000;
export const GRAPH_ESTIMATED_OUTPUT_TOKENS = 6_000;
export const GRAPH_RETRY_INPUT_BUFFER_TOKENS = 2_000;
