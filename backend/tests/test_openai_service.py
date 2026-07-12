import asyncio
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from app.services.openai_service import DEFAULT_ATLAS_BASE_URL, OpenAIService


class PayloadModel(BaseModel):
    value: str


class FakeAsyncStream:
    def __init__(self, events):
        self._events = iter(events)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._events)
        except StopIteration as exc:
            raise StopAsyncIteration from exc

    async def close(self):
        self.closed = True


class FakeResponses:
    def __init__(self, *, events=None, parsed_response=None):
        self.events = events or []
        self.parsed_response = parsed_response
        self.create_payload = None
        self.parse_payload = None

    async def create(self, **payload):
        self.create_payload = payload
        return FakeAsyncStream(self.events)

    async def parse(self, **payload):
        self.parse_payload = payload
        return self.parsed_response

    async def retrieve(self, _response_id):
        raise AssertionError("completed test streams should not require retrieval")


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.closed = False

    async def close(self):
        self.closed = True


def completed_events(text="done"):
    return [
        SimpleNamespace(type="response.output_text.delta", delta=text),
        SimpleNamespace(
            type="response.completed",
            response=SimpleNamespace(
                id="resp_test",
                usage=SimpleNamespace(
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                ),
            ),
        ),
    ]


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


def test_stream_completion_gates_text_verbosity_by_provider_and_gpt_56_model(
    monkeypatch,
):
    async def run():
        service = OpenAIService()
        supported_responses = FakeResponses(events=completed_events())
        supported_client = FakeClient(supported_responses)
        monkeypatch.setattr(
            service,
            "_create_client",
            lambda provider, api_key: supported_client,
        )

        stream, usage_future = await service.stream_completion(
            provider="openai",
            model="gpt-5.6-terra-2026-07-09",
            system_prompt="system",
            data={"input": "user"},
            api_key="sk-test",
            text_verbosity="low",
        )
        assert [chunk async for chunk in stream] == ["done"]
        assert (await usage_future).total_tokens == 15
        assert supported_responses.create_payload["text"] == {"verbosity": "low"}

        unsupported_responses = FakeResponses(events=completed_events())
        unsupported_client = FakeClient(unsupported_responses)
        monkeypatch.setattr(
            service,
            "_create_client",
            lambda provider, api_key: unsupported_client,
        )

        stream, usage_future = await service.stream_completion(
            provider="openai",
            model="gpt-5.4",
            system_prompt="system",
            data={"input": "user"},
            api_key="sk-test",
            text_verbosity="low",
        )
        assert [chunk async for chunk in stream] == ["done"]
        await usage_future
        assert "text" not in unsupported_responses.create_payload

    asyncio.run(run())


def test_structured_output_merges_verbosity_with_text_format(monkeypatch):
    async def run():
        service = OpenAIService()
        responses = FakeResponses(
            parsed_response=SimpleNamespace(
                output_parsed=PayloadModel(value="ok"),
                output_text='{"value":"ok"}',
                usage=SimpleNamespace(
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                ),
            )
        )
        client = FakeClient(responses)
        monkeypatch.setattr(
            service,
            "_create_client",
            lambda provider, api_key: client,
        )

        output, raw_text, usage = await service.generate_structured_output(
            provider="openai",
            model="gpt-5.6-luna",
            system_prompt="system",
            data={"input": "user"},
            text_format=PayloadModel,
            api_key="sk-test",
            text_verbosity="low",
        )

        assert output == PayloadModel(value="ok")
        assert raw_text == '{"value":"ok"}'
        assert usage.total_tokens == 15
        assert responses.parse_payload["text_format"] is PayloadModel
        assert responses.parse_payload["text"] == {"verbosity": "low"}

    asyncio.run(run())


def test_incomplete_stream_is_a_hard_failure_after_visible_output(monkeypatch):
    async def run():
        service = OpenAIService()
        responses = FakeResponses(
            events=[
                SimpleNamespace(type="response.output_text.delta", delta="partial"),
                SimpleNamespace(
                    type="response.incomplete",
                    response=SimpleNamespace(
                        id="resp_incomplete",
                        error=None,
                        incomplete_details=SimpleNamespace(reason="max_output_tokens"),
                    ),
                ),
            ]
        )
        client = FakeClient(responses)
        monkeypatch.setattr(
            service,
            "_create_client",
            lambda provider, api_key: client,
        )

        stream, usage_future = await service.stream_completion(
            provider="openai",
            model="gpt-5.6-terra",
            system_prompt="system",
            data={"input": "user"},
            api_key="sk-test",
            text_verbosity="low",
        )

        assert await anext(stream) == "partial"
        with pytest.raises(
            ValueError,
            match="OpenAI response incomplete: max_output_tokens",
        ):
            await anext(stream)
        assert await usage_future is None
        assert client.closed is True

    asyncio.run(run())
