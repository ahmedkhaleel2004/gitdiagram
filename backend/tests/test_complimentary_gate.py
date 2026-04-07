from app.services.complimentary_gate import (
    build_complimentary_admission_tokens,
    get_complimentary_model_family,
)


def test_get_complimentary_model_family_normalizes_snapshot(monkeypatch):
    monkeypatch.setenv(
        "OPENAI_COMPLIMENTARY_MODEL_FAMILY",
        "gpt-5.4-mini-2026-03-17",
    )

    assert get_complimentary_model_family() == "gpt-5.4-mini"


def test_build_complimentary_admission_tokens():
    assert (
        build_complimentary_admission_tokens(
            explanation_input_tokens=100,
            graph_static_input_tokens=200,
        )
        == 82_700
    )
