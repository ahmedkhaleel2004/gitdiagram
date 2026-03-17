from app.services.pricing import estimate_text_token_cost_usd, resolve_pricing_model


def test_resolve_pricing_model_keeps_gpt_5_4_mini_on_its_own_tier():
    assert resolve_pricing_model("gpt-5.4-mini") == "gpt-5.4-mini"
    assert resolve_pricing_model("gpt-5.4-mini-2026-03-17") == "gpt-5.4-mini"


def test_estimate_text_token_cost_uses_gpt_5_4_mini_pricing():
    cost_usd, pricing_model, pricing = estimate_text_token_cost_usd(
        model="gpt-5.4-mini",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
    )

    assert pricing_model == "gpt-5.4-mini"
    assert pricing.input_per_million_usd == 0.75
    assert pricing.output_per_million_usd == 4.5
    assert cost_usd == 5.25
