from app.services.complimentary_gate import (
    estimate_conservative_committed_tokens,
    get_complimentary_model_family,
)


def test_get_complimentary_model_family_normalizes_snapshot(monkeypatch):
    monkeypatch.setenv(
        "OPENAI_COMPLIMENTARY_MODEL_FAMILY",
        "gpt-5.4-mini-2026-03-17",
    )

    assert get_complimentary_model_family() == "gpt-5.4-mini"


def test_estimate_conservative_committed_tokens_by_stage():
    assert (
        estimate_conservative_committed_tokens(
            stage="explanation",
            reservation_tokens=82_700,
            explanation_input_tokens=100,
            graph_static_input_tokens=200,
            measured_tokens=0,
        )
        == 12_100
    )

    assert (
        estimate_conservative_committed_tokens(
            stage="graph",
            reservation_tokens=82_700,
            explanation_input_tokens=100,
            graph_static_input_tokens=200,
            measured_tokens=150,
        )
        == 30_300
    )
