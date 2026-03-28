from __future__ import annotations

from dataclasses import dataclass
from typing import Any

DEFAULT_PRICING_MODEL = "gpt-5.4-mini"
EXPLANATION_MAX_OUTPUT_TOKENS = 4000
GRAPH_MAX_OUTPUT_TOKENS = 6000


@dataclass(frozen=True)
class ModelPricing:
    input_per_million_usd: float
    output_per_million_usd: float


@dataclass(frozen=True)
class GenerationTokenUsage:
    input_tokens: int
    output_tokens: int
    total_tokens: int
    reasoning_tokens: int | None = None
    cached_input_tokens: int | None = None


MODEL_PRICING: dict[str, ModelPricing] = {
    "gpt-5.4": ModelPricing(input_per_million_usd=2.5, output_per_million_usd=15.0),
    "gpt-5.4-pro": ModelPricing(input_per_million_usd=30.0, output_per_million_usd=180.0),
    "gpt-5.4-mini": ModelPricing(input_per_million_usd=0.75, output_per_million_usd=4.5),
    "gpt-5.4-nano": ModelPricing(input_per_million_usd=0.2, output_per_million_usd=1.25),
    "gpt-5.2": ModelPricing(input_per_million_usd=1.75, output_per_million_usd=14.0),
    "gpt-5.2-chat-latest": ModelPricing(
        input_per_million_usd=1.75,
        output_per_million_usd=14.0,
    ),
    "gpt-5.2-codex": ModelPricing(input_per_million_usd=1.75, output_per_million_usd=14.0),
    "gpt-5.2-pro": ModelPricing(input_per_million_usd=21.0, output_per_million_usd=168.0),
    "gpt-5.1": ModelPricing(input_per_million_usd=1.25, output_per_million_usd=10.0),
    "gpt-5": ModelPricing(input_per_million_usd=1.25, output_per_million_usd=10.0),
    "gpt-5-mini": ModelPricing(input_per_million_usd=0.25, output_per_million_usd=2.0),
    "gpt-5-nano": ModelPricing(input_per_million_usd=0.05, output_per_million_usd=0.4),
    "o4-mini": ModelPricing(input_per_million_usd=1.1, output_per_million_usd=4.4),
}

DEFAULT_PRICING = MODEL_PRICING[DEFAULT_PRICING_MODEL]


def _strip_date_snapshot_suffix(model: str) -> str:
    import re

    return re.sub(r"-\d{4}-\d{2}-\d{2}$", "", model, flags=re.IGNORECASE)


def _strip_provider_prefix(model: str) -> str:
    if "/" not in model:
        return model
    return model.rsplit("/", maxsplit=1)[-1]


def resolve_pricing_model(model: str) -> str:
    normalized = model.strip().lower()
    if normalized in MODEL_PRICING:
        return normalized

    without_date = _strip_date_snapshot_suffix(_strip_provider_prefix(normalized))
    if without_date in MODEL_PRICING:
        return without_date

    if without_date.startswith("gpt-5.4-pro"):
        return "gpt-5.4-pro"
    if without_date.startswith("gpt-5.4-mini"):
        return "gpt-5.4-mini"
    if without_date.startswith("gpt-5.4-nano"):
        return "gpt-5.4-nano"
    if without_date.startswith("gpt-5.4"):
        return "gpt-5.4"
    if without_date.startswith("gpt-5.2-pro"):
        return "gpt-5.2-pro"
    if without_date.startswith("gpt-5.2-codex"):
        return "gpt-5.2-codex"
    if without_date.startswith("gpt-5.2-chat"):
        return "gpt-5.2-chat-latest"
    if without_date.startswith("gpt-5.2"):
        return "gpt-5.2"
    if without_date.startswith("gpt-5.1"):
        return "gpt-5.1"
    if without_date.startswith("gpt-5-mini"):
        return "gpt-5-mini"
    if without_date.startswith("gpt-5-nano"):
        return "gpt-5-nano"
    if without_date.startswith("gpt-5"):
        return "gpt-5"
    if without_date.startswith("o4-mini"):
        return "o4-mini"

    return DEFAULT_PRICING_MODEL


def estimate_text_token_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> tuple[float, str, ModelPricing]:
    pricing_model = resolve_pricing_model(model)
    pricing = MODEL_PRICING.get(pricing_model, DEFAULT_PRICING)
    input_cost = (max(input_tokens, 0) / 1_000_000) * pricing.input_per_million_usd
    output_cost = (max(output_tokens, 0) / 1_000_000) * pricing.output_per_million_usd
    return (input_cost + output_cost, pricing_model, pricing)


def normalize_generation_usage(usage: Any) -> GenerationTokenUsage | None:
    if usage is None:
        return None

    input_tokens = getattr(usage, "input_tokens", None)
    output_tokens = getattr(usage, "output_tokens", None)
    total_tokens = getattr(usage, "total_tokens", None)
    input_token_details = getattr(usage, "input_tokens_details", None)
    output_token_details = getattr(usage, "output_tokens_details", None)
    cached_input_tokens = getattr(input_token_details, "cached_tokens", None)
    reasoning_tokens = getattr(output_token_details, "reasoning_tokens", None)

    if not isinstance(input_tokens, int) and not isinstance(output_tokens, int):
        return None

    resolved_input_tokens = input_tokens if isinstance(input_tokens, int) else 0
    resolved_output_tokens = output_tokens if isinstance(output_tokens, int) else 0
    resolved_total_tokens = (
        total_tokens
        if isinstance(total_tokens, int)
        else resolved_input_tokens + resolved_output_tokens
    )

    return GenerationTokenUsage(
        input_tokens=resolved_input_tokens,
        output_tokens=resolved_output_tokens,
        total_tokens=resolved_total_tokens,
        reasoning_tokens=reasoning_tokens if isinstance(reasoning_tokens, int) else None,
        cached_input_tokens=(
            cached_input_tokens if isinstance(cached_input_tokens, int) else None
        ),
    )


def sum_generation_usage(*usages: GenerationTokenUsage | None) -> GenerationTokenUsage:
    total_input = 0
    total_output = 0
    total_tokens = 0
    total_reasoning = 0
    total_cached_input = 0

    for usage in usages:
        if not usage:
            continue
        total_input += usage.input_tokens
        total_output += usage.output_tokens
        total_tokens += usage.total_tokens
        total_reasoning += usage.reasoning_tokens or 0
        total_cached_input += usage.cached_input_tokens or 0

    return GenerationTokenUsage(
        input_tokens=total_input,
        output_tokens=total_output,
        total_tokens=total_tokens,
        reasoning_tokens=total_reasoning,
        cached_input_tokens=total_cached_input,
    )


def _format_cost_usd(cost_usd: float) -> str:
    if cost_usd == 0:
        return "$0.00 USD"
    if cost_usd >= 1:
        return f"${cost_usd:.2f} USD"
    if cost_usd >= 0.01:
        return f"${cost_usd:.3f} USD"
    return f"${cost_usd:.4f} USD"


def generation_usage_to_dict(usage: GenerationTokenUsage) -> dict[str, int]:
    payload: dict[str, int] = {
        "inputTokens": usage.input_tokens,
        "outputTokens": usage.output_tokens,
        "totalTokens": usage.total_tokens,
    }
    if usage.reasoning_tokens is not None:
        payload["reasoningTokens"] = usage.reasoning_tokens
    if usage.cached_input_tokens is not None:
        payload["cachedInputTokens"] = usage.cached_input_tokens
    return payload


def create_cost_summary(
    *,
    kind: str,
    model: str,
    usage: GenerationTokenUsage,
    approximate: bool,
    note: str | None = None,
) -> dict[str, Any]:
    cost_usd, pricing_model, _pricing = estimate_text_token_cost_usd(
        model=model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )
    payload: dict[str, Any] = {
        "kind": kind,
        "approximate": approximate,
        "amountUsd": cost_usd,
        "display": _format_cost_usd(cost_usd),
        "pricingModel": pricing_model,
        "usage": generation_usage_to_dict(usage),
    }
    if note:
        payload["note"] = note
    return payload


def create_estimate_cost_summary(
    *,
    model: str,
    explanation_input_tokens: int,
    graph_static_input_tokens: int,
    approximate: bool,
    note: str | None = None,
    graph_attempt_count: int = 1,
) -> dict[str, Any]:
    usage = GenerationTokenUsage(
        input_tokens=(
            explanation_input_tokens
            + graph_static_input_tokens
            + EXPLANATION_MAX_OUTPUT_TOKENS
        ),
        output_tokens=(
            EXPLANATION_MAX_OUTPUT_TOKENS
            + GRAPH_MAX_OUTPUT_TOKENS * graph_attempt_count
        ),
        total_tokens=0,
    )
    usage = GenerationTokenUsage(
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        total_tokens=usage.input_tokens + usage.output_tokens,
        reasoning_tokens=usage.reasoning_tokens,
        cached_input_tokens=usage.cached_input_tokens,
    )

    return create_cost_summary(
        kind="estimate",
        model=model,
        usage=usage,
        approximate=approximate,
        note=note
        or "Estimate assumes one graph-planning attempt and the configured output caps.",
    )
