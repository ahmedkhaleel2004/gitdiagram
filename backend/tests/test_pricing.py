from types import SimpleNamespace

from app.services.pricing import (
    create_estimate_cost_summary,
    estimate_text_token_cost_usd,
    normalize_generation_usage,
    resolve_pricing_model,
)


def test_resolve_pricing_model_keeps_gpt_5_6_terra_on_its_own_tier():
    assert resolve_pricing_model("gpt-5.6-terra") == "gpt-5.6-terra"
    assert resolve_pricing_model("gpt-5.6-terra-2026-07-09") == "gpt-5.6-terra"


def test_resolve_pricing_model_prices_gpt_5_6_alias_as_sol():
    assert resolve_pricing_model("gpt-5.6") == "gpt-5.6-sol"


def test_estimate_text_token_cost_uses_gpt_5_6_terra_pricing():
    cost_usd, pricing_model, pricing = estimate_text_token_cost_usd(
        model="gpt-5.6-terra",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
    )

    assert cost_usd == 17.5
    assert pricing_model == "gpt-5.6-terra"
    assert pricing.input_per_million_usd == 2.5
    assert pricing.output_per_million_usd == 15.0


def test_resolve_pricing_model_maps_atlas_model_prefix():
    assert resolve_pricing_model("deepseek-ai/DeepSeek-V3-0324") == "deepseek-v3-0324"


def test_normalize_generation_usage_maps_usage_payload():
    usage = normalize_generation_usage(
        SimpleNamespace(
            input_tokens=120,
            output_tokens=80,
            total_tokens=200,
            input_tokens_details=SimpleNamespace(cached_tokens=30),
            output_tokens_details=SimpleNamespace(reasoning_tokens=12),
        )
    )

    assert usage is not None
    assert usage.input_tokens == 120
    assert usage.output_tokens == 80
    assert usage.total_tokens == 200
    assert usage.cached_input_tokens == 30
    assert usage.reasoning_tokens == 12


def test_create_estimate_cost_summary_uses_stage_caps():
    summary = create_estimate_cost_summary(
        model="gpt-5.6-terra",
        explanation_input_tokens=100,
        graph_static_input_tokens=200,
        approximate=True,
    )

    assert summary["kind"] == "estimate"
    assert summary["approximate"] is True
    assert summary["usage"]["inputTokens"] == 6_300
    assert summary["usage"]["outputTokens"] == 12_000
    assert "configured output caps" in summary["note"]
