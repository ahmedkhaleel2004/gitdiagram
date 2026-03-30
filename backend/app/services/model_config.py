from __future__ import annotations

import os
from typing import Literal

AIProvider = Literal["openai", "openrouter"]

DEFAULT_PROVIDER: AIProvider = "openai"
DEFAULT_OPENAI_MODEL = "gpt-5.4-mini"
DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.4"


def _read_env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def get_provider(override_provider: str | None = None) -> AIProvider:
    candidate = (override_provider or _read_env("AI_PROVIDER") or "").strip().lower()
    if candidate == "openrouter":
        return "openrouter"
    return DEFAULT_PROVIDER


def get_provider_label(provider: AIProvider) -> str:
    return "OpenRouter" if provider == "openrouter" else "OpenAI"


def supports_exact_input_token_count(provider: AIProvider) -> bool:
    return provider == "openai"


def should_use_exact_input_token_count(
    provider: AIProvider,
    api_key: str | None,
) -> bool:
    return supports_exact_input_token_count(provider) and bool((api_key or "").strip())


def get_model(provider: AIProvider | None = None) -> str:
    resolved_provider = provider or get_provider()
    if resolved_provider == "openrouter":
        return _read_env("OPENROUTER_MODEL") or DEFAULT_OPENROUTER_MODEL

    return _read_env("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL
