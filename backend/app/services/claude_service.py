from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()


class ClaudeService:
    def __init__(self):
        self.default_client = Anthropic()

    def call_claude_api(
        self, system_prompt: str, data: dict, api_key: str | None = None
    ) -> str:
        """
        Makes an API call to Claude and returns the response.

        Args:
            system_prompt (str): The instruction/system prompt
            data (dict): Dictionary of variables to format into the user message
            api_key (str | None): Optional custom API key

        Returns:
            str: Claude's response text
        """
        # Create the user message with the data
        user_message = self._format_user_message(data)

        # Use custom client if API key provided, otherwise use default
        client = Anthropic(api_key=api_key) if api_key else self.default_client

        message = client.messages.create(
            model="claude-3-5-sonnet-latest",
            max_tokens=4096,
            temperature=0,
            system=system_prompt,
            messages=[
                {"role": "user", "content": [{"type": "text", "text": user_message}]}
            ],
        )
        return message.content[0].text  # type: ignore

    def _format_user_message(self, data: dict[str, str]) -> str:
        """Helper method to format the data into a user message"""
        parts = []
        for key, value in data.items():
            if key == "file_tree":
                parts.append(f"<file_tree>\n{value}\n</file_tree>")
            elif key == "readme":
                parts.append(f"<readme>\n{value}\n</readme>")
            elif key == "explanation":
                parts.append(f"<explanation>\n{value}\n</explanation>")
            elif key == "component_mapping":
                parts.append(f"<component_mapping>\n{value}\n</component_mapping>")
            elif key == "instructions" and value != "":
                parts.append(f"<instructions>\n{value}\n</instructions>")
            elif key == "diagram":
                parts.append(f"<diagram>\n{value}\n</diagram>")
            elif key == "explanation":
                parts.append(f"<explanation>\n{value}\n</explanation>")
        return "\n\n".join(parts)

    def count_tokens(self, prompt: str) -> int:
        """
        Counts the number of tokens in a prompt.

        Args:
            prompt (str): The prompt to count tokens for

        Returns:
            int: Number of input tokens
        """
        response = self.default_client.messages.count_tokens(
            model="claude-3-5-sonnet-latest",
            messages=[{"role": "user", "content": prompt}],
        )
        return response.input_tokens
