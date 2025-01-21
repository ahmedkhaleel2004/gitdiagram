import os
from dotenv import load_dotenv
import openai

load_dotenv()


class OpenAIService:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.base_url = os.getenv("OPENAI_BASE_URL")
        self.model = os.getenv("OPENAI_MODEL")
        self.client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    def call_openai_api(self, system_prompt: str, data: dict) -> str:
        """
        Makes an API call to OpenAI and returns the response.

        Args:
            system_prompt (str): The instruction/system prompt
            data (dict): Dictionary of variables to format into the user message

        Returns:
            str: OpenAI's response text
        """
        # Format the user message
        user_message = self._format_user_message(data)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=4096,
                temperature=0,
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"API call failed: {str(e)}")

    def _format_user_message(self, data: dict[str, str]) -> str:
        """Helper method to format the data into a user message"""
        parts = []
        for key, value in data.items():
            if key == 'file_tree':
                parts.append(f"<file_tree>\n{value}\n</file_tree>")
            elif key == 'readme':
                parts.append(f"<readme>\n{value}\n</readme>")
            elif key == 'explanation':
                parts.append(f"<explanation>\n{value}\n</explanation>")
            elif key == 'component_mapping':
                parts.append(
                    f"<component_mapping>\n{value}\n</component_mapping>")
            elif key == 'instructions' and value != "":
                parts.append(f"<instructions>\n{value}\n</instructions>")
            elif key == 'diagram':
                parts.append(f"<diagram>\n{value}\n</diagram>")
        return "\n\n".join(parts)
