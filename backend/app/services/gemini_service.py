from dotenv import load_dotenv
from app.utils.format_message import format_user_message
import os
import aiohttp
import json
from typing import AsyncGenerator

load_dotenv()

class GeminiService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

    def call_gemini_api(
        self,
        system_prompt: str,
        data: dict,
        api_key: str | None = None,
    ) -> str:
        """
        Makes an API call to Gemini and returns the response.
        Args:
            system_prompt (str): The instruction/system prompt
            data (dict): Dictionary of variables to format into the user message
            api_key (str | None): Optional custom API key
        Returns:
            str: Gemini's response text
        """
        user_message = format_user_message(data)
        key = api_key or self.api_key
        if not key:
            raise ValueError("Gemini API key is missing. Please set GEMINI_API_KEY in your environment or provide api_key.")
        headers = {
            "Content-Type": "application/json",
        }
        params = {"key": str(key)}
        payload = {
            "contents": [
                {"role": "user", "parts": [{"text": f"{system_prompt}\n{user_message}"}]}
            ]
        }
        try:
            import requests
            response = requests.post(self.base_url, headers=headers, params=params, json=payload)
            response.raise_for_status()
            result = response.json()
            return result["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            print(f"Error in Gemini API call: {str(e)}")
            raise

    async def call_gemini_api_stream(
        self,
        system_prompt: str,
        data: dict,
        api_key: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Makes a streaming API call to Gemini and yields the responses.
        Args:
            system_prompt (str): The instruction/system prompt
            data (dict): Dictionary of variables to format into the user message
            api_key (str | None): Optional custom API key
        Yields:
            str: Chunks of Gemini's response text
        """
        user_message = format_user_message(data)
        key = api_key or self.api_key
        if not key:
            raise ValueError("Gemini API key is missing. Please set GEMINI_API_KEY in your environment or provide api_key.")
        headers = {
            "Content-Type": "application/json",
        }
        params = {"key": str(key)}
        payload = {
            "contents": [
                {"role": "user", "parts": [{"text": f"{system_prompt}\n{user_message}"}]}
            ]
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(self.base_url, headers=headers, params=params, json=payload) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        print(f"Error response: {error_text}")
                        raise ValueError(f"Gemini API returned status code {response.status}: {error_text}")
                    response_text = await response.text()
                    try:
                        data = json.loads(response_text)
                        text = data["candidates"][0]["content"]["parts"][0]["text"]
                        if text:
                            yield text
                    except Exception as e:
                        print(f"Error parsing Gemini response: {e}")
        except aiohttp.ClientError as e:
            print(f"Connection error: {str(e)}")
            raise ValueError(f"Failed to connect to Gemini API: {str(e)}")
        except Exception as e:
            print(f"Unexpected error in streaming API call: {str(e)}")
            raise

    def count_tokens(self, prompt: str) -> int:
        """
        Counts the number of tokens in a prompt.
        Args:
            prompt (str): The prompt to count tokens for
        Returns:
            int: Estimated number of input tokens
        """
        # Gemini does not have a public tokenizer, so we approximate by whitespace splitting
        return len(prompt.split())
