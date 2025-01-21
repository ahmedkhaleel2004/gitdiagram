from fastapi import APIRouter, Request, HTTPException
from dotenv import load_dotenv
from app.services.github_service import GitHubService
from app.services.claude_service import ClaudeService
from app.core.limiter import limiter
from app.prompts import (
    SYSTEM_FIRST_PROMPT,
    SYSTEM_SECOND_PROMPT,
    SYSTEM_THIRD_PROMPT,
    ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT,
)
from anthropic._exceptions import RateLimitError
from pydantic import BaseModel
from functools import lru_cache
import re

load_dotenv()

router = APIRouter(prefix="/generate", tags=["Claude"])

# Initialize services
github_service = GitHubService()
claude_service = ClaudeService()


# cache github data for 5 minutes to avoid double API calls from cost and generate
@lru_cache(maxsize=100)
def get_cached_github_data(username: str, repo: str):
    default_branch = github_service.get_default_branch(username, repo)
    if not default_branch:
        default_branch = "main"  # fallback value

    file_tree = github_service.get_github_file_paths_as_list(username, repo)
    readme = github_service.get_github_readme(username, repo)

    return {"default_branch": default_branch, "file_tree": file_tree, "readme": readme}


class ApiRequest(BaseModel):
    username: str
    repo: str
    instructions: str
    api_key: str | None = None


@router.post("")
# @limiter.limit("1/minute;5/day") # TEMP: disable rate limit for growth??
async def generate(request: Request, body: ApiRequest):
    try:
        # Check instructions length
        if len(body.instructions) > 1000:
            return {"error": "Instructions exceed maximum length of 1000 characters"}

        if body.repo in [
            "fastapi",
            "streamlit",
            "flask",
            "api-analytics",
            "monkeytype",
        ]:
            return {"error": "Example repos cannot be regenerated"}

        # Get cached github data
        github_data = get_cached_github_data(body.username, body.repo)

        # Get default branch first
        default_branch = github_data["default_branch"]
        file_tree = github_data["file_tree"]
        readme = github_data["readme"]

        # Check combined token count
        combined_content = f"{file_tree}\n{readme}"
        token_count = claude_service.count_tokens(combined_content)

        # Modified token limit check
        if 50000 < token_count < 190000 and not body.api_key:
            return {
                "error": f"File tree and README combined exceeds token limit (50,000). Current size: {token_count} tokens. This GitHub repository is too large for my wallet, but you can continue by providing your own Anthropic API key.",
                "token_count": token_count,
                "requires_api_key": True,
            }
        elif token_count > 200000:
            return {
                "error": f"Repository is too large (>200k tokens) for analysis. Claude 3.5 Sonnet's max context length is 200k tokens. Current size: {token_count} tokens."
            }

        # Prepare system prompts with instructions if provided
        first_system_prompt = SYSTEM_FIRST_PROMPT
        third_system_prompt = SYSTEM_THIRD_PROMPT
        if body.instructions:
            first_system_prompt = (
                first_system_prompt + "\n" + ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT
            )
            third_system_prompt = (
                third_system_prompt + "\n" + ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT
            )

        # get the explanation for sysdesign from claude
        explanation = claude_service.call_claude_api(
            system_prompt=first_system_prompt,
            data={
                "file_tree": file_tree,
                "readme": readme,
                "instructions": body.instructions,
            },
            api_key=body.api_key,
        )

        # Check for BAD_INSTRUCTIONS response
        if "BAD_INSTRUCTIONS" in explanation:
            return {"error": "Invalid or unclear instructions provided"}

        full_second_response = claude_service.call_claude_api(
            system_prompt=SYSTEM_SECOND_PROMPT,
            data={"explanation": explanation, "file_tree": file_tree},
        )

        # Extract component mapping from the response
        start_tag = "<component_mapping>"
        end_tag = "</component_mapping>"
        component_mapping_text = full_second_response[
            full_second_response.find(start_tag) : full_second_response.find(end_tag)
        ]

        # get mermaid.js code from claude
        mermaid_code = claude_service.call_claude_api(
            system_prompt=third_system_prompt,
            data={
                "explanation": explanation,
                "component_mapping": component_mapping_text,
                "instructions": body.instructions,
            },
        )

        # Check for BAD_INSTRUCTIONS response
        if "BAD_INSTRUCTIONS" in mermaid_code:
            return {"error": "Invalid or unclear instructions provided"}

        # Process click events to include full GitHub URLs
        processed_diagram = process_click_events(
            mermaid_code, body.username, body.repo, default_branch
        )

        return {"diagram": processed_diagram, "explanation": explanation}
    except RateLimitError as e:
        raise HTTPException(
            status_code=429,
            detail="Service is currently experiencing high demand. Please try again in a few minutes.",
        )
    except Exception as e:
        return {"error": str(e)}


@router.post("/cost")
# @limiter.limit("5/minute") # TEMP: disable rate limit for growth??
async def get_generation_cost(request: Request, body: ApiRequest):
    try:
        # Get file tree and README content
        github_data = get_cached_github_data(body.username, body.repo)
        file_tree = github_data["file_tree"]
        readme = github_data["readme"]

        # Calculate combined token count
        file_tree_tokens = claude_service.count_tokens(file_tree)
        readme_tokens = claude_service.count_tokens(readme)

        # Calculate approximate cost
        # Input cost: $3 per 1M tokens ($0.000003 per token)
        # Output cost: $15 per 1M tokens ($0.000015 per token)
        # Estimate output tokens as roughly equal to input tokens
        input_cost = ((file_tree_tokens * 2 + readme_tokens) + 3000) * 0.000003
        output_cost = 3500 * 0.000015
        estimated_cost = input_cost + output_cost

        # Format as currency string
        cost_string = f"${estimated_cost:.2f} USD"
        return {"cost": cost_string}
    except Exception as e:
        return {"error": str(e)}


def process_click_events(diagram: str, username: str, repo: str, branch: str) -> str:
    """
    Process click events in Mermaid diagram to include full GitHub URLs.
    Detects if path is file or directory and uses appropriate URL format.
    """

    def replace_path(match):
        # Extract the path from the click event
        path = match.group(2).strip("\"'")

        # Determine if path is likely a file (has extension) or directory
        is_file = "." in path.split("/")[-1]

        # Construct GitHub URL
        base_url = f"https://github.com/{username}/{repo}"
        path_type = "blob" if is_file else "tree"
        full_url = f"{base_url}/{path_type}/{branch}/{path}"

        # Return the full click event with the new URL
        return f'click {match.group(1)} "{full_url}"'

    # Match click events: click ComponentName "path/to/something"
    click_pattern = r'click ([^\s"]+)\s+"([^"]+)"'
    return re.sub(click_pattern, replace_path, diagram)
