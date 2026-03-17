from __future__ import annotations

from dataclasses import dataclass

DEFAULT_PRICING_MODEL = "gpt-5.4-mini"


@dataclass(frozen=True)
class ModelPricing:
    input_per_million_usd: float
    output_per_million_usd: float


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


def resolve_pricing_model(model: str) -> str:
    normalized = model.strip().lower()
    if normalized in MODEL_PRICING:
        return normalized

    without_date = _strip_date_snapshot_suffix(normalized)
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
