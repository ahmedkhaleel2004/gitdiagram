from typing import Literal

ReasoningEffort = Literal["low", "medium", "high"]
TextVerbosity = Literal["low", "medium", "high"]

EXPLANATION_REASONING_EFFORT: ReasoningEffort = "medium"
GRAPH_REASONING_EFFORT: ReasoningEffort = "low"

EXPLANATION_TEXT_VERBOSITY: TextVerbosity = "low"
GRAPH_TEXT_VERBOSITY: TextVerbosity = "low"

EXPLANATION_MAX_OUTPUT_TOKENS = 6_000
GRAPH_MAX_OUTPUT_TOKENS = 6_000
