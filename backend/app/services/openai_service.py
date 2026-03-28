from __future__ import annotations

from typing import AsyncGenerator, Literal
import math
import os

from dotenv import load_dotenv
from openai import AsyncOpenAI

from app.services.model_config import AIProvider, get_provider_label
from app.utils.format_message import format_user_message

load_dotenv()

ReasoningEffort = Literal["low", "medium", "high"]


class OpenAIService:
    def __init__(self):
        self.default_openai_api_key = os.getenv("OPENAI_API_KEY")
        self.default_openrouter_api_key = os.getenv("OPENROUTER_API_KEY")

    def _resolve_api_key(
        self,
        provider: AIProvider,
        override_api_key: str | None = None,
    ) -> str:
        default_api_key = (
            self.default_openrouter_api_key
            if provider == "openrouter"
            else self.default_openai_api_key
        )
        api_key = (override_api_key or default_api_key or "").strip()
        if not api_key:
            raise ValueError(
                f"Missing {get_provider_label(provider)} API key. Set "
                f"{'OPENROUTER_API_KEY' if provider == 'openrouter' else 'OPENAI_API_KEY'} "
                "or provide api_key in request."
            )
        return api_key

    @staticmethod
    def estimate_tokens(text: str) -> int:
        # Matches the lightweight token estimate used by the Next.js backend.
        return math.ceil(len(text) / 4)

    @staticmethod
    def _build_input(system_prompt: str, user_prompt: str) -> list[dict]:
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    @staticmethod
    def _create_client(provider: AIProvider, api_key: str) -> AsyncOpenAI:
        client_kwargs: dict = {
            "api_key": api_key,
            "max_retries": 2,
            "timeout": 600,
        }
        if provider == "openrouter":
            default_headers: dict[str, str] = {}
            site_url = os.getenv("OPENROUTER_SITE_URL", "").strip()
            app_name = os.getenv("OPENROUTER_APP_NAME", "").strip() or "GitDiagram"
            if site_url:
                default_headers["HTTP-Referer"] = site_url
            if app_name:
                default_headers["X-OpenRouter-Title"] = app_name

            client_kwargs["base_url"] = "https://openrouter.ai/api/v1"
            client_kwargs["default_headers"] = default_headers

        return AsyncOpenAI(**client_kwargs)

    async def stream_completion(
        self,
        *,
        provider: AIProvider,
        model: str,
        system_prompt: str,
        data: dict[str, str | None],
        api_key: str | None = None,
        reasoning_effort: ReasoningEffort | None = None,
        max_output_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        user_prompt = format_user_message(data)
        resolved_api_key = self._resolve_api_key(provider, api_key)
        payload: dict = {
            "model": model,
            "stream": True,
            "input": self._build_input(system_prompt, user_prompt),
        }
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        if max_output_tokens:
            payload["max_output_tokens"] = max_output_tokens

        client = self._create_client(provider, resolved_api_key)
        stream = await client.responses.create(**payload)
        try:
            async for event in stream:
                if event.type == "response.output_text.delta":
                    delta = getattr(event, "delta", None)
                    if isinstance(delta, str) and delta:
                        yield delta
                    continue

                if event.type == "error":
                    message = getattr(event, "message", None) or "OpenAI stream failed."
                    raise ValueError(str(message))
        finally:
            await stream.close()
            await client.close()

    async def count_input_tokens(
        self,
        *,
        provider: AIProvider,
        model: str,
        system_prompt: str,
        data: dict[str, str | None],
        api_key: str | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> int:
        user_prompt = format_user_message(data)
        resolved_api_key = self._resolve_api_key(provider, api_key)
        payload: dict = {
            "model": model,
            "input": self._build_input(system_prompt, user_prompt),
        }
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}

        client = self._create_client(provider, resolved_api_key)
        try:
            response = await client.responses.input_tokens.count(**payload)
            input_tokens = getattr(response, "input_tokens", None)
            if not isinstance(input_tokens, int):
                raise ValueError("OpenAI input token count returned invalid payload.")
            return input_tokens
        finally:
            await client.close()
