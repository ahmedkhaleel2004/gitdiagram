from functools import lru_cache
import asyncio
import json
import re

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from openai import RateLimitError
from pydantic import BaseModel

from app.core.errors import api_error, api_success
from app.core.observability import Timer, log_event
from app.prompts import (
    SYSTEM_FIRST_PROMPT,
    SYSTEM_SECOND_PROMPT,
    SYSTEM_THIRD_PROMPT,
)
from app.services.github_service import GitHubService
from app.services.openai_service import OpenAIService

router = APIRouter(prefix="/generate", tags=["OpenAI"])

openai_service = OpenAIService()


@lru_cache(maxsize=100)
def get_cached_github_data(username: str, repo: str, github_pat: str | None = None):
    github_service = GitHubService(pat=github_pat)

    default_branch = github_service.get_default_branch(username, repo) or "main"
    file_tree = github_service.get_github_file_paths_as_list(username, repo)
    readme = github_service.get_github_readme(username, repo)

    return {
        "default_branch": default_branch,
        "file_tree": file_tree,
        "readme": readme,
    }


class ApiRequest(BaseModel):
    username: str
    repo: str
    api_key: str | None = None
    github_pat: str | None = None


def process_click_events(diagram: str, username: str, repo: str, branch: str) -> str:
    def replace_path(match):
        path = match.group(2).strip("\"'")
        is_file = "." in path.split("/")[-1]

        base_url = f"https://github.com/{username}/{repo}"
        path_type = "blob" if is_file else "tree"
        full_url = f"{base_url}/{path_type}/{branch}/{path}"

        return f'click {match.group(1)} "{full_url}"'

    click_pattern = r'click ([^\s"]+)\s+"([^"]+)"'
    return re.sub(click_pattern, replace_path, diagram)


@router.post("/cost")
async def get_generation_cost(request: Request, body: ApiRequest):
    timer = Timer()
    try:
        github_data = get_cached_github_data(body.username, body.repo, body.github_pat)
        file_tree = github_data["file_tree"]
        readme = github_data["readme"]

        file_tree_tokens = openai_service.count_tokens(file_tree)
        readme_tokens = openai_service.count_tokens(readme)

        input_cost = ((file_tree_tokens * 2 + readme_tokens) + 3000) * 0.0000011
        output_cost = 8000 * 0.0000044
        estimated_cost = input_cost + output_cost

        cost_string = f"${estimated_cost:.2f} USD"
        log_event(
            "generate.cost.success",
            username=body.username,
            repo=body.repo,
            elapsed_ms=timer.elapsed_ms(),
            estimated_cost=cost_string,
        )
        return api_success(cost=cost_string)
    except RateLimitError:
        log_event(
            "generate.cost.rate_limited",
            username=body.username,
            repo=body.repo,
            elapsed_ms=timer.elapsed_ms(),
        )
        return api_error("RATE_LIMIT", "Rate limit exceeded. Please try again later.")
    except Exception as exc:
        log_event(
            "generate.cost.failed",
            username=body.username,
            repo=body.repo,
            elapsed_ms=timer.elapsed_ms(),
            error=str(exc),
        )
        return api_error("COST_ESTIMATION_FAILED", str(exc))


@router.post("/stream")
async def generate_stream(request: Request, body: ApiRequest):
    async def event_generator():
        timer = Timer()

        def sse(payload: dict):
            return f"data: {json.dumps(payload)}\n\n"

        try:
            github_data = get_cached_github_data(body.username, body.repo, body.github_pat)
            default_branch = github_data["default_branch"]
            file_tree = github_data["file_tree"]
            readme = github_data["readme"]

            yield sse(
                {
                    "status": "started",
                    "message": "Starting generation process...",
                }
            )
            await asyncio.sleep(0.1)

            combined_content = f"{file_tree}\n{readme}"
            token_count = openai_service.count_tokens(combined_content)

            if 50000 < token_count < 195000 and not body.api_key:
                yield sse(
                    {
                        "status": "error",
                        "error": (
                            "File tree and README combined exceeds token limit (50,000). "
                            f"Current size: {token_count} tokens. This GitHub repository "
                            "is too large for free generation, but you can continue by "
                            "providing your own OpenAI API key."
                        ),
                        "error_code": "API_KEY_REQUIRED",
                    }
                )
                return

            if token_count > 195000:
                yield sse(
                    {
                        "status": "error",
                        "error": (
                            "Repository is too large (>195k tokens) for analysis. "
                            f"Current size: {token_count} tokens."
                        ),
                        "error_code": "TOKEN_LIMIT_EXCEEDED",
                    }
                )
                return

            yield sse(
                {
                    "status": "explanation_sent",
                    "message": "Sending explanation request to o4-mini...",
                }
            )
            await asyncio.sleep(0.1)
            yield sse(
                {
                    "status": "explanation",
                    "message": "Analyzing repository structure...",
                }
            )

            explanation = ""
            async for chunk in openai_service.stream_completion(
                model="o4-mini",
                system_prompt=SYSTEM_FIRST_PROMPT,
                data={
                    "file_tree": file_tree,
                    "readme": readme,
                },
                api_key=body.api_key,
                reasoning_effort="medium",
            ):
                explanation += chunk
                yield sse(
                    {
                        "status": "explanation_chunk",
                        "chunk": chunk,
                    }
                )

            yield sse(
                {
                    "status": "mapping_sent",
                    "message": "Sending component mapping request to o4-mini...",
                }
            )
            await asyncio.sleep(0.1)
            yield sse(
                {
                    "status": "mapping",
                    "message": "Creating component mapping...",
                }
            )

            full_second_response = ""
            async for chunk in openai_service.stream_completion(
                model="o4-mini",
                system_prompt=SYSTEM_SECOND_PROMPT,
                data={
                    "explanation": explanation,
                    "file_tree": file_tree,
                },
                api_key=body.api_key,
                reasoning_effort="low",
            ):
                full_second_response += chunk
                yield sse(
                    {
                        "status": "mapping_chunk",
                        "chunk": chunk,
                    }
                )

            start_tag = "<component_mapping>"
            end_tag = "</component_mapping>"
            start_idx = full_second_response.find(start_tag)
            end_idx = full_second_response.find(end_tag)
            if start_idx != -1 and end_idx != -1:
                component_mapping_text = full_second_response[start_idx:end_idx]
            else:
                component_mapping_text = full_second_response

            yield sse(
                {
                    "status": "diagram_sent",
                    "message": "Sending diagram generation request to o4-mini...",
                }
            )
            await asyncio.sleep(0.1)
            yield sse(
                {
                    "status": "diagram",
                    "message": "Generating diagram...",
                }
            )

            mermaid_code = ""
            async for chunk in openai_service.stream_completion(
                model="o4-mini",
                system_prompt=SYSTEM_THIRD_PROMPT,
                data={
                    "explanation": explanation,
                    "component_mapping": component_mapping_text,
                },
                api_key=body.api_key,
                reasoning_effort="low",
            ):
                mermaid_code += chunk
                yield sse(
                    {
                        "status": "diagram_chunk",
                        "chunk": chunk,
                    }
                )

            mermaid_code = mermaid_code.replace("```mermaid", "").replace("```", "")
            processed_diagram = process_click_events(
                mermaid_code,
                body.username,
                body.repo,
                default_branch,
            )

            log_event(
                "generate.stream.success",
                username=body.username,
                repo=body.repo,
                elapsed_ms=timer.elapsed_ms(),
            )
            yield sse(
                {
                    "status": "complete",
                    "diagram": processed_diagram,
                    "explanation": explanation,
                    "mapping": component_mapping_text,
                }
            )
        except RateLimitError:
            yield sse(
                {
                    "status": "error",
                    "error": "Rate limit exceeded. Please try again later.",
                    "error_code": "RATE_LIMIT",
                }
            )
            log_event(
                "generate.stream.rate_limited",
                username=body.username,
                repo=body.repo,
                elapsed_ms=timer.elapsed_ms(),
            )
        except Exception as exc:
            yield sse(
                {
                    "status": "error",
                    "error": str(exc),
                    "error_code": "STREAM_FAILED",
                }
            )
            log_event(
                "generate.stream.failed",
                username=body.username,
                repo=body.repo,
                elapsed_ms=timer.elapsed_ms(),
                error=str(exc),
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
