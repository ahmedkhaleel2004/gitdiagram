from app.services.openai_service import DEFAULT_ATLAS_BASE_URL, OpenAIService


def test_resolve_api_key_reads_atlas_env(monkeypatch):
    monkeypatch.setenv("ATLAS_API_KEY", "apikey-test")

    service = OpenAIService()

    assert service._resolve_api_key("atlas") == "apikey-test"


def test_create_client_uses_atlas_base_url(monkeypatch):
    captured = {}

    class FakeAsyncOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("app.services.openai_service.AsyncOpenAI", FakeAsyncOpenAI)
    monkeypatch.delenv("ATLAS_BASE_URL", raising=False)

    OpenAIService._create_client("atlas", "apikey-test")

    assert captured["api_key"] == "apikey-test"
    assert captured["base_url"] == DEFAULT_ATLAS_BASE_URL
