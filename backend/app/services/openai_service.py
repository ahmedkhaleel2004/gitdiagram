from __future__ import annotations

from typing import AsyncGenerator, Literal
import json
import os

import aiohttp
import tiktoken
from dotenv import load_dotenv
from openai import OpenAI

from app.utils.format_message import format_user_message

load_dotenv()

ReasoningEffort = Literal["low", "medium", "high"]


class OpenAIService:
    def __init__(self):
        self.default_api_key = os.getenv("OPENAI_API_KEY")
        self.encoding = tiktoken.get_encoding("o200k_base")
        self.base_url = "https://api.openai.com/v1/chat/completions"

    def _resolve_api_key(self, override_api_key: str | None = None) -> str:
        api_key = override_api_key or self.default_api_key
        if not api_key:
            raise ValueError(
                "Missing OpenAI API key. Set OPENAI_API_KEY or provide api_key in request."
            )
        return api_key

    def completion(
        self,
        *,
        model: str,
        system_prompt: str,
        data: dict,
        api_key: str | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> str:
        user_message = format_user_message(data)
        client = OpenAI(api_key=self._resolve_api_key(api_key))
        payload: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "max_completion_tokens": 12000,
            "temperature": 0.2,
        }
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort

        completion = client.chat.completions.create(**payload)
        content = completion.choices[0].message.content
        if content is None:
            raise ValueError(f"No content returned from OpenAI model {model}")
        return content

    async def stream_completion(
        self,
        *,
        model: str,
        system_prompt: str,
        data: dict,
        api_key: str | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> AsyncGenerator[str, None]:
        user_message = format_user_message(data)
        resolved_api_key = self._resolve_api_key(api_key)
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {resolved_api_key}",
        }
        payload: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "max_completion_tokens": 12000,
            "stream": True,
        }
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort

        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.base_url,
                headers=headers,
                json=payload,
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise ValueError(
                        f"OpenAI API returned status code {response.status}: {error_text}"
                    )

                async for line in response.content:
                    parsed = line.decode("utf-8").strip()
                    if not parsed or not parsed.startswith("data: "):
                        continue
                    if parsed == "data: [DONE]":
                        break
                    try:
                        data_json = json.loads(parsed[6:])
                        content = (
                            data_json.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content")
                        )
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue

    def count_tokens(self, prompt: str) -> int:
        return len(self.encoding.encode(prompt))
