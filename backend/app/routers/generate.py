from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from app.core.observability import Timer, log_event
from app.prompts import (
    SYSTEM_FIRST_PROMPT,
    SYSTEM_FIX_MERMAID_PROMPT,
    SYSTEM_SECOND_PROMPT,
    SYSTEM_THIRD_PROMPT,
)
from app.services.github_service import GitHubService
from app.services.mermaid_service import format_validation_feedback, validate_mermaid_syntax
from app.services.model_config import (
    AIProvider,
    get_model,
    get_provider,
    get_provider_label,
    supports_exact_input_token_count,
)
from app.services.openai_service import OpenAIService
from app.services.pricing import estimate_text_token_cost_usd

router = APIRouter(prefix="/generate", tags=["AI"])

openai_service = OpenAIService()

MAX_MERMAID_FIX_ATTEMPTS = 3
MULTI_STAGE_INPUT_MULTIPLIER = 2
INPUT_OVERHEAD_TOKENS = 3000
ESTIMATED_OUTPUT_TOKENS = 8000


class GenerateRequest(BaseModel):
    username: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    api_key: str | None = Field(default=None, min_length=1)
    github_pat: str | None = Field(default=None, min_length=1)


class RepairRequest(BaseModel):
    username: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    diagram: str = Field(min_length=1)
    parser_error: str = Field(min_length=1)
    explanation: str = ""
    mapping: str = ""
    default_branch: str = Field(default="main", min_length=1)
    api_key: str | None = Field(default=None, min_length=1)


def _sse_message(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _strip_mermaid_code_fences(text: str) -> str:
    return text.replace("```mermaid", "").replace("```", "").strip()


def _extract_component_mapping(response: str) -> str:
    start_tag = "<component_mapping>"
    end_tag = "</component_mapping>"
    start_index = response.find(start_tag)
    end_index = response.find(end_tag)
    if start_index == -1 or end_index == -1:
        return response
    return response[start_index:end_index]


def process_click_events(diagram: str, username: str, repo: str, branch: str) -> str:
    click_pattern = r'click ([^\s"]+)\s+"([^"]+)"'

    def replace_path(match: re.Match[str]) -> str:
        node_id = match.group(1)
        trimmed_path = match.group(2).strip().strip("\"'")
        if trimmed_path.lower().startswith(("http://", "https://")):
            return f'click {node_id} "{trimmed_path}"'
        is_file = "." in trimmed_path and not trimmed_path.endswith("/")
        path_type = "blob" if is_file else "tree"
        full_url = f"https://github.com/{username}/{repo}/{path_type}/{branch}/{trimmed_path}"
        return f'click {node_id} "{full_url}"'

    return re.sub(click_pattern, replace_path, diagram)


def _parse_request_payload(payload: Any) -> tuple[GenerateRequest | None, str | None]:
    try:
        parsed = GenerateRequest.model_validate(payload)
        return parsed, None
    except ValidationError:
        return None, "Invalid request payload."


def _parse_repair_payload(payload: Any) -> tuple[RepairRequest | None, str | None]:
    try:
        parsed = RepairRequest.model_validate(payload)
        return parsed, None
    except ValidationError:
        return None, "Invalid request payload."


def _get_github_data(username: str, repo: str, github_pat: str | None):
    github_service = GitHubService(pat=github_pat)
    return github_service.get_github_data(username, repo)


async def _estimate_repo_input_tokens(
    provider: AIProvider,
    model: str,
    file_tree: str,
    readme: str,
    api_key: str | None = None,
) -> int:
    if not supports_exact_input_token_count(provider):
        return openai_service.estimate_tokens(f"{file_tree}\n{readme}")

    try:
        return await openai_service.count_input_tokens(
            provider=provider,
            model=model,
            system_prompt=SYSTEM_FIRST_PROMPT,
            data={
                "file_tree": file_tree,
                "readme": readme,
            },
            api_key=api_key,
            reasoning_effort="medium",
        )
    except Exception:
        return openai_service.estimate_tokens(f"{file_tree}\n{readme}")


async def _repair_mermaid_diagram(
    *,
    provider: AIProvider,
    model: str,
    diagram: str,
    parser_feedback: str,
    explanation: str,
    component_mapping: str,
    api_key: str | None,
) -> tuple[str | None, str | None]:
    candidate_diagram = _strip_mermaid_code_fences(diagram)
    attempt = 1

    while attempt <= MAX_MERMAID_FIX_ATTEMPTS:
        repaired_diagram = ""
        async for chunk in openai_service.stream_completion(
            provider=provider,
            model=model,
            system_prompt=SYSTEM_FIX_MERMAID_PROMPT,
            data={
                "mermaid_code": candidate_diagram,
                "parser_error": parser_feedback,
                "explanation": explanation,
                "component_mapping": component_mapping,
            },
            api_key=api_key,
            reasoning_effort="low",
        ):
            repaired_diagram += chunk

        candidate_diagram = _strip_mermaid_code_fences(repaired_diagram)
        validation_result = await asyncio.to_thread(
            validate_mermaid_syntax,
            candidate_diagram,
        )
        if validation_result.valid:
            return candidate_diagram, None

        parser_feedback = format_validation_feedback(validation_result)
        attempt += 1

    return None, parser_feedback


@router.post("/cost")
async def get_generation_cost(request: Request):
    timer = Timer()
    try:
        payload = await request.json()
        parsed, error = _parse_request_payload(payload)
        if not parsed:
            return JSONResponse(
                {
                    "ok": False,
                    "error": error,
                    "error_code": "VALIDATION_ERROR",
                }
            )

        github_data = _get_github_data(parsed.username, parsed.repo, parsed.github_pat)
        provider = get_provider()
        model = get_model(provider)
        base_input_tokens = await _estimate_repo_input_tokens(
            provider=provider,
            model=model,
            file_tree=github_data.file_tree,
            readme=github_data.readme,
            api_key=parsed.api_key,
        )
        estimated_input_tokens = (
            base_input_tokens * MULTI_STAGE_INPUT_MULTIPLIER + INPUT_OVERHEAD_TOKENS
        )
        estimated_output_tokens = ESTIMATED_OUTPUT_TOKENS
        cost_usd, pricing_model, pricing = estimate_text_token_cost_usd(
            model=model,
            input_tokens=estimated_input_tokens,
            output_tokens=estimated_output_tokens,
        )

        response_payload = {
            "ok": True,
            "cost": f"${cost_usd:.2f} USD",
            "model": model,
            "pricing_model": pricing_model,
            "estimated_input_tokens": estimated_input_tokens,
            "estimated_output_tokens": estimated_output_tokens,
            "pricing": {
                "input_per_million_usd": pricing.input_per_million_usd,
                "output_per_million_usd": pricing.output_per_million_usd,
            },
        }
        log_event(
            "generate.cost.success",
            username=parsed.username,
            repo=parsed.repo,
            elapsed_ms=timer.elapsed_ms(),
            model=model,
        )
        return JSONResponse(response_payload)
    except Exception as exc:
        log_event(
            "generate.cost.failed",
            elapsed_ms=timer.elapsed_ms(),
            error=str(exc),
        )
        return JSONResponse(
            {
                "ok": False,
                "error": str(exc) if isinstance(exc, Exception) else "Failed to estimate generation cost.",
                "error_code": "COST_ESTIMATION_FAILED",
            }
        )


@router.post("/stream")
async def generate_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(
            {
                "ok": False,
                "error": "Invalid request payload.",
                "error_code": "VALIDATION_ERROR",
            },
            status_code=400,
        )

    parsed, error = _parse_request_payload(payload)
    if not parsed:
        return JSONResponse(
            {
                "ok": False,
                "error": error,
                "error_code": "VALIDATION_ERROR",
            },
            status_code=400,
        )

    async def event_generator():
        timer = Timer()

        def send(payload: dict[str, Any]) -> str:
            return _sse_message(payload)

        try:
            github_data = _get_github_data(parsed.username, parsed.repo, parsed.github_pat)
            provider = get_provider()
            provider_label = get_provider_label(provider)
            model = get_model(provider)
            token_count = await _estimate_repo_input_tokens(
                provider=provider,
                model=model,
                file_tree=github_data.file_tree,
                readme=github_data.readme,
                api_key=parsed.api_key,
            )

            yield send(
                {
                    "status": "started",
                    "message": "Starting generation process...",
                }
            )

            if token_count > 50000 and token_count < 195000 and not parsed.api_key:
                yield send(
                    {
                        "status": "error",
                        "error": "File tree and README combined exceeds token limit "
                        "(50,000). This repository is too large for free generation. "
                        f"Provide your own {provider_label} API key to continue.",
                        "error_code": "API_KEY_REQUIRED",
                    }
                )
                return

            if token_count > 195000:
                yield send(
                    {
                        "status": "error",
                        "error": "Repository is too large (>195k tokens) for analysis. Try a smaller repo.",
                        "error_code": "TOKEN_LIMIT_EXCEEDED",
                    }
                )
                return

            yield send(
                {
                    "status": "explanation_sent",
                    "message": f"Sending explanation request to {model}...",
                }
            )
            await asyncio.sleep(0.08)
            yield send(
                {
                    "status": "explanation",
                    "message": "Analyzing repository structure...",
                }
            )

            explanation = ""
            async for chunk in openai_service.stream_completion(
                provider=provider,
                model=model,
                system_prompt=SYSTEM_FIRST_PROMPT,
                data={
                    "file_tree": github_data.file_tree,
                    "readme": github_data.readme,
                },
                api_key=parsed.api_key,
                reasoning_effort="medium",
            ):
                explanation += chunk
                yield send({"status": "explanation_chunk", "chunk": chunk})

            yield send(
                {
                    "status": "mapping_sent",
                    "message": f"Sending component mapping request to {model}...",
                }
            )
            await asyncio.sleep(0.08)
            yield send(
                {
                    "status": "mapping",
                    "message": "Creating component mapping...",
                }
            )

            full_mapping_response = ""
            async for chunk in openai_service.stream_completion(
                provider=provider,
                model=model,
                system_prompt=SYSTEM_SECOND_PROMPT,
                data={
                    "explanation": explanation,
                    "file_tree": github_data.file_tree,
                },
                api_key=parsed.api_key,
                reasoning_effort="low",
            ):
                full_mapping_response += chunk
                yield send({"status": "mapping_chunk", "chunk": chunk})

            component_mapping = _extract_component_mapping(full_mapping_response)

            yield send(
                {
                    "status": "diagram_sent",
                    "message": f"Sending diagram generation request to {model}...",
                }
            )
            await asyncio.sleep(0.08)
            yield send(
                {
                    "status": "diagram",
                    "message": "Generating diagram...",
                }
            )

            mermaid_code = ""
            async for chunk in openai_service.stream_completion(
                provider=provider,
                model=model,
                system_prompt=SYSTEM_THIRD_PROMPT,
                data={
                    "explanation": explanation,
                    "component_mapping": component_mapping,
                },
                api_key=parsed.api_key,
                reasoning_effort="low",
            ):
                mermaid_code += chunk
                yield send({"status": "diagram_chunk", "chunk": chunk})

            candidate_diagram = _strip_mermaid_code_fences(mermaid_code)
            validation_result = await asyncio.to_thread(
                validate_mermaid_syntax,
                candidate_diagram,
            )
            had_fix_loop = not validation_result.valid

            if not validation_result.valid:
                parser_feedback = format_validation_feedback(validation_result)
                yield send(
                    {
                        "status": "diagram_fixing",
                        "message": "Diagram generated. Mermaid syntax validation failed, starting auto-fix loop...",
                        "parser_error": parser_feedback,
                    }
                )

            attempt = 1
            while (not validation_result.valid) and attempt <= MAX_MERMAID_FIX_ATTEMPTS:
                parser_feedback = format_validation_feedback(validation_result)
                yield send(
                    {
                        "status": "diagram_fix_attempt",
                        "message": f"Fixing Mermaid syntax (attempt {attempt}/{MAX_MERMAID_FIX_ATTEMPTS})...",
                        "fix_attempt": attempt,
                        "fix_max_attempts": MAX_MERMAID_FIX_ATTEMPTS,
                        "parser_error": parser_feedback,
                    }
                )

                repaired_diagram = ""
                async for chunk in openai_service.stream_completion(
                    provider=provider,
                    model=model,
                    system_prompt=SYSTEM_FIX_MERMAID_PROMPT,
                    data={
                        "mermaid_code": candidate_diagram,
                        "parser_error": parser_feedback,
                        "explanation": explanation,
                        "component_mapping": component_mapping,
                    },
                    api_key=parsed.api_key,
                    reasoning_effort="low",
                ):
                    repaired_diagram += chunk
                    yield send(
                        {
                            "status": "diagram_fix_chunk",
                            "chunk": chunk,
                            "fix_attempt": attempt,
                            "fix_max_attempts": MAX_MERMAID_FIX_ATTEMPTS,
                        }
                    )

                candidate_diagram = _strip_mermaid_code_fences(repaired_diagram)
                yield send(
                    {
                        "status": "diagram_fix_validating",
                        "message": f"Validating Mermaid syntax after attempt {attempt}/{MAX_MERMAID_FIX_ATTEMPTS}...",
                        "fix_attempt": attempt,
                        "fix_max_attempts": MAX_MERMAID_FIX_ATTEMPTS,
                    }
                )
                validation_result = await asyncio.to_thread(
                    validate_mermaid_syntax,
                    candidate_diagram,
                )
                attempt += 1

            if not validation_result.valid:
                yield send(
                    {
                        "status": "error",
                        "error": "Generated Mermaid remained syntactically invalid after auto-fix attempts. Please retry generation.",
                        "error_code": "MERMAID_SYNTAX_UNRESOLVED",
                        "parser_error": format_validation_feedback(validation_result),
                    }
                )
                return

            processed_diagram = process_click_events(
                candidate_diagram,
                parsed.username,
                parsed.repo,
                github_data.default_branch,
            )

            if had_fix_loop:
                yield send(
                    {
                        "status": "diagram_fixing",
                        "message": "Mermaid syntax validated. Finalizing diagram output...",
                    }
                )

            yield send(
                {
                    "status": "complete",
                    "diagram": processed_diagram,
                    "explanation": explanation,
                    "mapping": component_mapping,
                }
            )
            log_event(
                "generate.stream.success",
                username=parsed.username,
                repo=parsed.repo,
                elapsed_ms=timer.elapsed_ms(),
                model=model,
            )
        except Exception as exc:
            yield send(
                {
                    "status": "error",
                    "error": str(exc) if isinstance(exc, Exception) else "Streaming generation failed.",
                    "error_code": "STREAM_FAILED",
                }
            )
            log_event(
                "generate.stream.failed",
                username=parsed.username,
                repo=parsed.repo,
                elapsed_ms=timer.elapsed_ms(),
                error=str(exc),
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/repair")
async def repair_diagram(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(
            {
                "ok": False,
                "error": "Invalid request payload.",
                "error_code": "VALIDATION_ERROR",
            },
            status_code=400,
        )

    parsed, error = _parse_repair_payload(payload)
    if not parsed:
        return JSONResponse(
            {
                "ok": False,
                "error": error,
                "error_code": "VALIDATION_ERROR",
            },
            status_code=400,
        )

    try:
        provider = get_provider()
        model = get_model(provider)
        repaired_diagram, parser_error = await _repair_mermaid_diagram(
            provider=provider,
            model=model,
            diagram=parsed.diagram,
            parser_feedback=parsed.parser_error,
            explanation=parsed.explanation,
            component_mapping=parsed.mapping,
            api_key=parsed.api_key,
        )

        if not repaired_diagram:
            return JSONResponse(
                {
                    "ok": False,
                    "error": "Generated Mermaid remained syntactically invalid after auto-fix attempts. Please retry generation.",
                    "error_code": "MERMAID_REPAIR_FAILED",
                    "parser_error": parser_error,
                },
                status_code=422,
            )

        return JSONResponse(
            {
                "ok": True,
                "diagram": process_click_events(
                    repaired_diagram,
                    parsed.username,
                    parsed.repo,
                    parsed.default_branch,
                ),
            }
        )
    except Exception as exc:
        return JSONResponse(
            {
                "ok": False,
                "error": str(exc) if isinstance(exc, Exception) else "Mermaid repair failed.",
                "error_code": "MERMAID_REPAIR_FAILED",
            },
            status_code=500,
        )
