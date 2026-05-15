from app.services.model_config import (
    get_model,
    get_provider,
    get_provider_label,
    should_use_exact_input_token_count,
)


def test_get_provider_recognizes_atlas(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "atlas")

    assert get_provider() == "atlas"
    assert get_provider_label("atlas") == "Atlas Cloud"


def test_get_model_prefers_atlas_override(monkeypatch):
    monkeypatch.setenv("ATLAS_MODEL", "deepseek-ai/DeepSeek-V3-0324")

    assert get_model("atlas") == "deepseek-ai/DeepSeek-V3-0324"


def test_get_model_uses_documented_atlas_default(monkeypatch):
    monkeypatch.delenv("ATLAS_MODEL", raising=False)

    assert get_model("atlas") == "deepseek-ai/DeepSeek-V3-0324"


def test_atlas_uses_fallback_token_counting():
    assert should_use_exact_input_token_count("atlas", "apikey-test") is False
