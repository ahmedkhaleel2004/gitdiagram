from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator, Literal, TypeVar
import math
import os

from dotenv import load_dotenv
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.services.model_config import (
    AIProvider,
    get_provider_label,
    supports_text_verbosity,
)
from app.services.pricing import GenerationTokenUsage, normalize_generation_usage
from app.utils.format_message import format_user_message

load_dotenv()

ReasoningEffort = Literal["low", "medium", "high"]
TextVerbosity = Literal["low", "medium", "high"]
StructuredOutputModel = TypeVar("StructuredOutputModel", bound=BaseModel)
DEFAULT_ATLAS_BASE_URL = "https://api.atlascloud.ai/v1"


class OpenAIService:
    def __init__(self):
        self.default_atlas_api_key = os.getenv("ATLAS_API_KEY")
        self.default_openai_api_key = os.getenv("OPENAI_API_KEY")
        self.default_openrouter_api_key = os.getenv("OPENROUTER_API_KEY")

    def _resolve_api_key(
        self,
        provider: AIProvider,
        override_api_key: str | None = None,
    ) -> str:
        default_api_key = (
            self.default_atlas_api_key
            if provider == "atlas"
            else self.default_openrouter_api_key
            if provider == "openrouter"
            else self.default_openai_api_key
        )
        env_var_name = (
            "ATLAS_API_KEY"
            if provider == "atlas"
            else "OPENROUTER_API_KEY"
            if provider == "openrouter"
            else "OPENAI_API_KEY"
        )
        api_key = (override_api_key or default_api_key or "").strip()
        if not api_key:
            raise ValueError(
                f"Missing {get_provider_label(provider)} API key. Set {env_var_name} "
                "or provide api_key in request."
            )
        return api_key

    @staticmethod
    def estimate_tokens(text: str) -> int:
        # Conservative local estimate used when we deliberately avoid billable count calls.
        return 0 if len(text) == 0 else math.ceil(len(text) / 3) + 32

    @staticmethod
    def _build_input(system_prompt: str, user_prompt: str) -> list[dict]:
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    @staticmethod
    def _extract_chat_completion_text(content: object | None) -> str:
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return ""

        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)

    @staticmethod
    def _normalize_chat_completion_usage(usage: object | None) -> GenerationTokenUsage | None:
        if usage is None:
            return None

        input_tokens = getattr(usage, "prompt_tokens", None)
        output_tokens = getattr(usage, "completion_tokens", None)
        total_tokens = getattr(usage, "total_tokens", None)
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
        )

    @staticmethod
    def _build_atlas_structured_user_prompt(
        *,
        user_prompt: str,
        text_format: type[StructuredOutputModel],
    ) -> str:
        schema = json.dumps(text_format.model_json_schema(), ensure_ascii=True, indent=2)
        return (
            f"{user_prompt}\n\n"
            "Return valid JSON only with no markdown fences or commentary.\n"
            "The JSON must satisfy this schema exactly:\n"
            f"{schema}"
        )

    @staticmethod
    def _get_response_failure_message(response: object | None) -> str:
        error = getattr(response, "error", None)
        message = getattr(error, "message", None)
        if isinstance(message, str) and message.strip():
            return message

        incomplete_details = getattr(response, "incomplete_details", None)
        reason = getattr(incomplete_details, "reason", None)
        if isinstance(reason, str) and reason.strip():
            return f"OpenAI response incomplete: {reason}."

        return "OpenAI response did not complete successfully."

    @staticmethod
    def _create_client(provider: AIProvider, api_key: str) -> AsyncOpenAI:
        client_kwargs: dict = {
            "api_key": api_key,
            "max_retries": 0,
            "timeout": 600,
        }
        if provider == "atlas":
            client_kwargs["base_url"] = (
                os.getenv("ATLAS_BASE_URL", "").strip() or DEFAULT_ATLAS_BASE_URL
            )
            return AsyncOpenAI(**client_kwargs)
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
        text_verbosity: TextVerbosity | None = None,
        max_output_tokens: int | None = None,
    ) -> tuple[AsyncGenerator[str, None], asyncio.Future[GenerationTokenUsage | None]]:
        user_prompt = format_user_message(data)
        resolved_api_key = self._resolve_api_key(provider, api_key)
        if provider == "atlas":
            client = self._create_client(provider, resolved_api_key)
            stream = await client.chat.completions.create(
                model=model,
                messages=self._build_input(system_prompt, user_prompt),
                stream=True,
                **({"max_tokens": max_output_tokens} if max_output_tokens else {}),
            )
            loop = asyncio.get_running_loop()
            usage_future: asyncio.Future[GenerationTokenUsage | None] = loop.create_future()

            async def text_stream() -> AsyncGenerator[str, None]:
                final_usage: GenerationTokenUsage | None = None
                try:
                    async for chunk in stream:
                        final_usage = (
                            self._normalize_chat_completion_usage(
                                getattr(chunk, "usage", None)
                            )
                            or final_usage
                        )
                        choices = getattr(chunk, "choices", None) or []
                        if not choices:
                            continue
                        delta = getattr(choices[0], "delta", None)
                        content = getattr(delta, "content", None)
                        if isinstance(content, str) and content:
                            yield content

                    if not usage_future.done():
                        usage_future.set_result(final_usage)
                except Exception:
                    if not usage_future.done():
                        usage_future.set_result(None)
                    raise
                finally:
                    if not usage_future.done():
                        usage_future.set_result(None)
                    close = getattr(stream, "close", None)
                    if callable(close):
                        maybe_awaitable = close()
                        if hasattr(maybe_awaitable, "__await__"):
                            await maybe_awaitable
                    await client.close()

            return text_stream(), usage_future

        payload: dict = {
            "model": model,
            "stream": True,
            "input": self._build_input(system_prompt, user_prompt),
        }
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        if text_verbosity and supports_text_verbosity(provider, model):
            payload["text"] = {"verbosity": text_verbosity}
        if max_output_tokens:
            payload["max_output_tokens"] = max_output_tokens

        client = self._create_client(provider, resolved_api_key)
        stream = await client.responses.create(**payload)
        loop = asyncio.get_running_loop()
        usage_future: asyncio.Future[GenerationTokenUsage | None] = loop.create_future()

        async def text_stream() -> AsyncGenerator[str, None]:
            response_id: str | None = None
            final_usage: GenerationTokenUsage | None = None
            try:
                async for event in stream:
                    response = getattr(event, "response", None)
                    event_response_id = getattr(response, "id", None)
                    if isinstance(event_response_id, str) and event_response_id:
                        response_id = event_response_id

                    if event.type == "response.output_text.delta":
                        delta = getattr(event, "delta", None)
                        if isinstance(delta, str) and delta:
                            yield delta
                        continue

                    if event.type == "response.completed":
                        final_usage = normalize_generation_usage(
                            getattr(response, "usage", None)
                        )
                        continue

                    if event.type == "response.failed":
                        raise ValueError(self._get_response_failure_message(response))

                    if event.type == "response.incomplete":
                        raise ValueError(self._get_response_failure_message(response))

                    if event.type == "error":
                        message = getattr(event, "message", None) or "OpenAI stream failed."
                        raise ValueError(str(message))

                if final_usage is None and response_id:
                    try:
                        response = await client.responses.retrieve(response_id)
                        final_usage = normalize_generation_usage(
                            getattr(response, "usage", None)
                        )
                    except Exception:
                        final_usage = None

                if not usage_future.done():
                    usage_future.set_result(final_usage)
            except Exception as exc:
                if not usage_future.done():
                    usage_future.set_result(None)
                raise
            finally:
                if not usage_future.done():
                    usage_future.set_result(None)
                await stream.close()
                await client.close()

        return text_stream(), usage_future

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
        if provider == "atlas":
            raise ValueError(
                "Atlas Cloud does not expose exact input token counting in this integration."
            )

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

    async def generate_structured_output(
        self,
        *,
        provider: AIProvider,
        model: str,
        system_prompt: str,
        data: dict[str, str | None],
        text_format: type[StructuredOutputModel],
        api_key: str | None = None,
        reasoning_effort: ReasoningEffort | None = None,
        text_verbosity: TextVerbosity | None = None,
        max_output_tokens: int | None = None,
    ) -> tuple[StructuredOutputModel, str, GenerationTokenUsage | None]:
        user_prompt = format_user_message(data)
        resolved_api_key = self._resolve_api_key(provider, api_key)
        if provider == "atlas":
            client = self._create_client(provider, resolved_api_key)
            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=self._build_input(
                        system_prompt,
                        self._build_atlas_structured_user_prompt(
                            user_prompt=user_prompt,
                            text_format=text_format,
                        ),
                    ),
                    response_format={"type": "json_object"},
                    temperature=0,
                    **({"max_tokens": max_output_tokens} if max_output_tokens else {}),
                )
                choices = getattr(response, "choices", None) or []
                if not choices:
                    raise ValueError("Structured output parsing returned no parsed payload.")
                message = getattr(choices[0], "message", None)
                raw_text = self._extract_chat_completion_text(
                    getattr(message, "content", None)
                ).strip()
                if not raw_text:
                    raise ValueError("Structured output parsing returned no parsed payload.")
                return (
                    text_format.model_validate_json(raw_text),
                    raw_text,
                    self._normalize_chat_completion_usage(getattr(response, "usage", None)),
                )
            finally:
                await client.close()

        payload: dict = {
            "model": model,
            "input": self._build_input(system_prompt, user_prompt),
            "text_format": text_format,
        }
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        if text_verbosity and supports_text_verbosity(provider, model):
            payload["text"] = {"verbosity": text_verbosity}
        if max_output_tokens:
            payload["max_output_tokens"] = max_output_tokens

        client = self._create_client(provider, resolved_api_key)
        try:
            response = await client.responses.parse(**payload)
            parsed = getattr(response, "output_parsed", None)
            if parsed is None:
                raise ValueError("Structured output parsing returned no parsed payload.")
            output_text = getattr(response, "output_text", None)
            raw_text = output_text.strip() if isinstance(output_text, str) and output_text.strip() else parsed.model_dump_json(indent=2)
            return parsed, raw_text, normalize_generation_usage(getattr(response, "usage", None))
        except Exception as exc:
            if provider == "openrouter":
                raise ValueError(
                    f"OpenRouter model does not support the required structured graph output: {exc}"
                ) from exc
            raise
        finally:
            await client.close()
