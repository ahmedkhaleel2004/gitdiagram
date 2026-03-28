from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from app.core.observability import Timer, log_event
from app.prompts import SYSTEM_FIRST_PROMPT, SYSTEM_GRAPH_PROMPT
from app.services.complimentary_gate import (
    build_complimentary_reservation_tokens,
    finalize_complimentary_quota,
    get_complimentary_denial_message,
    model_matches_complimentary_family,
    reserve_complimentary_quota,
    should_apply_complimentary_gate,
)
from app.services.cost_estimator import estimate_generation_cost
from app.services.diagram_state_repository import DiagramStateRepository
from app.services.github_service import GitHubService
from app.services.graph_service import (
    MAX_GRAPH_ATTEMPTS,
    DiagramGraph,
    build_file_tree_lookup,
    compile_diagram_graph,
    format_graph_validation_feedback,
    validate_diagram_graph,
)
from app.services.mermaid_service import validate_mermaid_syntax
from app.services.model_config import (
    get_model,
    get_provider,
    get_provider_label,
)
from app.services.openai_service import OpenAIService
from app.services.pricing import (
    EXPLANATION_MAX_OUTPUT_TOKENS,
    GRAPH_MAX_OUTPUT_TOKENS,
    create_cost_summary,
    sum_generation_usage,
)

router = APIRouter(prefix="/generate", tags=["AI"])

openai_service = OpenAIService()
diagram_state_repository = DiagramStateRepository()


class GenerateRequest(BaseModel):
    username: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    api_key: str | None = Field(default=None, min_length=1)
    github_pat: str | None = Field(default=None, min_length=1)


def _sse_message(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _parse_request_payload(payload: Any) -> tuple[GenerateRequest | None, str | None]:
    try:
        parsed = GenerateRequest.model_validate(payload)
        return parsed, None
    except ValidationError:
        return None, "Invalid request payload."


def _get_github_data(username: str, repo: str, github_pat: str | None):
    github_service = GitHubService(pat=github_pat)
    github_data = github_service.get_github_data(username, repo)
    return SimpleNamespace(
        default_branch=github_data.default_branch,
        file_tree=github_data.file_tree,
        readme=github_data.readme,
    )


def _extract_tagged_section(text: str, tag: str) -> str:
    start_tag = f"<{tag}>"
    end_tag = f"</{tag}>"
    start_index = text.find(start_tag)
    end_index = text.find(end_tag)
    if start_index == -1 or end_index == -1:
        return text.strip()
    return text[start_index + len(start_tag) : end_index].strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _create_session_audit(*, session_id: str, provider: str, model: str) -> dict[str, Any]:
    created_at = _now_iso()
    return {
        "sessionId": session_id,
        "status": "running",
        "stage": "started",
        "provider": provider,
        "model": model,
        "stageUsages": [],
        "graph": None,
        "graphAttempts": [],
        "timeline": [{"stage": "started", "createdAt": created_at}],
        "createdAt": created_at,
        "updatedAt": created_at,
    }


def _timeline(audit: dict[str, Any], stage: str, message: str | None = None) -> dict[str, Any]:
    created_at = _now_iso()
    next_audit = dict(audit)
    next_audit["stage"] = stage
    next_audit["updatedAt"] = created_at
    next_audit["timeline"] = [*audit.get("timeline", []), {"stage": stage, "message": message, "createdAt": created_at}]
    return next_audit


def _set_failure(audit: dict[str, Any], *, failure_stage: str, validation_error: str | None = None, compiler_error: str | None = None) -> dict[str, Any]:
    next_audit = dict(audit)
    next_audit["status"] = "failed"
    next_audit["failureStage"] = failure_stage
    next_audit["validationError"] = validation_error
    next_audit["compilerError"] = compiler_error
    next_audit["updatedAt"] = _now_iso()
    return next_audit


def _set_success(audit: dict[str, Any]) -> dict[str, Any]:
    next_audit = dict(audit)
    next_audit["status"] = "succeeded"
    next_audit["updatedAt"] = _now_iso()
    return next_audit


def _set_estimated_cost(audit: dict[str, Any], cost_summary: dict[str, Any]) -> dict[str, Any]:
    next_audit = dict(audit)
    next_audit["estimatedCost"] = cost_summary
    next_audit["updatedAt"] = _now_iso()
    return next_audit


def _set_final_cost(audit: dict[str, Any], cost_summary: dict[str, Any]) -> dict[str, Any]:
    next_audit = dict(audit)
    next_audit["finalCost"] = cost_summary
    next_audit["updatedAt"] = _now_iso()
    return next_audit


def _append_stage_usage(audit: dict[str, Any], stage_usage: dict[str, Any]) -> dict[str, Any]:
    next_audit = dict(audit)
    next_audit["stageUsages"] = [*audit.get("stageUsages", []), stage_usage]
    next_audit["updatedAt"] = _now_iso()
    return next_audit


@router.post("/cost")
async def get_generation_cost(request: Request):
    timer = Timer()
    try:
        payload = await request.json()
        parsed, error = _parse_request_payload(payload)
        if not parsed:
            return JSONResponse({"ok": False, "error": error, "error_code": "VALIDATION_ERROR"})

        github_data = _get_github_data(parsed.username, parsed.repo, parsed.github_pat)
        provider = get_provider()
        model = get_model(provider)
        estimate = await estimate_generation_cost(
            provider=provider,
            model=model,
            file_tree=github_data.file_tree,
            readme=github_data.readme,
            username=parsed.username,
            repo=parsed.repo,
            api_key=parsed.api_key,
        )
        pricing = estimate["pricing"]

        response_payload = {
            "ok": True,
            "cost": estimate["cost_summary"]["display"],
            "cost_summary": estimate["cost_summary"],
            "model": model,
            "pricing_model": estimate["pricing_model"],
            "estimated_input_tokens": estimate["estimated_input_tokens"],
            "estimated_output_tokens": estimate["estimated_output_tokens"],
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
        log_event("generate.cost.failed", elapsed_ms=timer.elapsed_ms(), error=str(exc))
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
            {"ok": False, "error": "Invalid request payload.", "error_code": "VALIDATION_ERROR"},
            status_code=400,
        )

    parsed, error = _parse_request_payload(payload)
    if not parsed:
        return JSONResponse(
            {"ok": False, "error": error, "error_code": "VALIDATION_ERROR"},
            status_code=400,
        )

    async def event_generator():
        timer = Timer()
        provider = get_provider()
        model = get_model(provider)
        audit = _create_session_audit(session_id=str(uuid4()), provider=provider, model=model)
        quota_reservation = None
        actual_usages = []
        has_complete_measured_usage = True

        async def persist_audit() -> None:
            if not diagram_state_repository.is_configured():
                return
            try:
                await asyncio.to_thread(
                    diagram_state_repository.upsert_latest_session_audit,
                    username=parsed.username,
                    repo=parsed.repo,
                    audit=audit,
                )
            except Exception as exc:
                log_event(
                    "generate.persistence.audit_failed",
                    username=parsed.username,
                    repo=parsed.repo,
                    session_id=audit["sessionId"],
                    error=str(exc),
                )

        async def persist_successful_state(
            *,
            explanation: str,
            graph: dict[str, Any],
            diagram: str,
            used_own_key: bool,
        ) -> None:
            if not diagram_state_repository.is_configured():
                return
            try:
                await asyncio.to_thread(
                    diagram_state_repository.save_successful_diagram_state,
                    username=parsed.username,
                    repo=parsed.repo,
                    explanation=explanation,
                    graph=graph,
                    diagram=diagram,
                    audit=audit,
                    used_own_key=used_own_key,
                )
            except Exception as exc:
                log_event(
                    "generate.persistence.success_state_failed",
                    username=parsed.username,
                    repo=parsed.repo,
                    session_id=audit["sessionId"],
                    error=str(exc),
                )

        def send(payload: dict[str, Any]) -> str:
            return _sse_message(payload)

        try:
            github_data = _get_github_data(parsed.username, parsed.repo, parsed.github_pat)
            provider_label = get_provider_label(provider)
            estimate = await estimate_generation_cost(
                provider=provider,
                model=model,
                file_tree=github_data.file_tree,
                readme=github_data.readme,
                username=parsed.username,
                repo=parsed.repo,
                api_key=parsed.api_key,
            )
            token_count = estimate["explanation_input_tokens"]

            audit = _append_stage_usage(
                _set_estimated_cost(audit, estimate["cost_summary"]),
                {
                    "stage": "estimate",
                    "model": model,
                    "costSummary": estimate["cost_summary"],
                    "createdAt": _now_iso(),
                },
            )

            await persist_audit()
            yield send(
                {
                    "status": "started",
                    "session_id": audit["sessionId"],
                    "message": "Starting generation process...",
                    "cost_summary": estimate["cost_summary"],
                }
            )

            if should_apply_complimentary_gate(
                provider=provider,
                model=model,
                api_key=parsed.api_key,
            ):
                if not diagram_state_repository.is_configured():
                    error_message = (
                        "OPENAI_COMPLIMENTARY_GATE_ENABLED requires POSTGRES_URL on the backend "
                        "service because quota tracking is stored in Postgres."
                    )
                    audit = _set_failure(
                        {
                            **audit,
                            "quotaStatus": "storage_unavailable",
                        },
                        failure_stage="started",
                        validation_error=error_message,
                    )
                    await persist_audit()
                    yield send(
                        {
                            "status": "error",
                            "session_id": audit["sessionId"],
                            "error": error_message,
                            "error_code": "COMPLIMENTARY_GATE_STORAGE_UNAVAILABLE",
                            "validation_error": error_message,
                            "failure_stage": "started",
                            "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                            "latest_session_audit": audit,
                        }
                    )
                    return

                if not model_matches_complimentary_family(model):
                    error_message = (
                        "GitDiagram's complimentary usage gate only supports the "
                        "gpt-5.4-mini model family for the default server key."
                    )
                    audit = _set_failure(
                        {
                            **audit,
                            "quotaStatus": "denied",
                        },
                        failure_stage="started",
                        validation_error=error_message,
                    )
                    await persist_audit()
                    yield send(
                        {
                            "status": "error",
                            "session_id": audit["sessionId"],
                            "error": error_message,
                            "error_code": "COMPLIMENTARY_GATE_MODEL_MISMATCH",
                            "validation_error": error_message,
                            "failure_stage": "started",
                            "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                            "latest_session_audit": audit,
                        }
                    )
                    return

                reservation_tokens = build_complimentary_reservation_tokens(
                    explanation_input_tokens=estimate["explanation_input_tokens"],
                    graph_static_input_tokens=estimate["graph_static_input_tokens"],
                )
                admitted, quota_reservation, quota_reset_at = await asyncio.to_thread(
                    reserve_complimentary_quota,
                    repository=diagram_state_repository,
                    model=model,
                    reservation_tokens=reservation_tokens,
                )
                if not admitted or quota_reservation is None:
                    error_message = get_complimentary_denial_message()
                    audit = _set_failure(
                        {
                            **audit,
                            "quotaStatus": "denied",
                            "quotaResetAt": quota_reset_at,
                        },
                        failure_stage="started",
                        validation_error=error_message,
                    )
                    await persist_audit()
                    yield send(
                        {
                            "status": "error",
                            "session_id": audit["sessionId"],
                            "error": error_message,
                            "error_code": "DAILY_FREE_TOKEN_LIMIT_REACHED",
                            "validation_error": error_message,
                            "failure_stage": "started",
                            "quota_reset_at": quota_reset_at,
                            "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                            "latest_session_audit": audit,
                        }
                    )
                    return

                audit = {
                    **audit,
                    "quotaStatus": "admitted",
                    "quotaBucket": quota_reservation.quota_bucket,
                    "quotaDateUtc": quota_reservation.quota_date_utc,
                    "reservedTokens": quota_reservation.reserved_tokens,
                    "quotaResetAt": quota_reservation.quota_reset_at,
                }
                await persist_audit()

            if token_count > 50000 and token_count < 195000 and not parsed.api_key:
                error_message = (
                    "File tree and README combined exceeds token limit (50,000). "
                    f"This repository is too large for free generation. Provide your own {provider_label} API key to continue."
                )
                audit = _set_failure(audit, failure_stage="started", validation_error=error_message)
                await persist_audit()
                yield send(
                    {
                        "status": "error",
                        "session_id": audit["sessionId"],
                        "error": error_message,
                        "error_code": "API_KEY_REQUIRED",
                        "validation_error": error_message,
                        "failure_stage": "started",
                        "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                        "latest_session_audit": audit,
                    }
                )
                return

            if token_count > 195000:
                error_message = "Repository is too large (>195k tokens) for analysis. Try a smaller repo."
                audit = _set_failure(audit, failure_stage="started", validation_error=error_message)
                await persist_audit()
                yield send(
                    {
                        "status": "error",
                        "session_id": audit["sessionId"],
                        "error": error_message,
                        "error_code": "TOKEN_LIMIT_EXCEEDED",
                        "validation_error": error_message,
                        "failure_stage": "started",
                        "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                        "latest_session_audit": audit,
                    }
                )
                return

            audit = _timeline(audit, "explanation_sent", f"Sending explanation request to {model}...")
            await persist_audit()
            yield send(
                {
                    "status": "explanation_sent",
                    "session_id": audit["sessionId"],
                    "message": f"Sending explanation request to {model}...",
                }
            )
            await asyncio.sleep(0.08)

            audit = _timeline(audit, "explanation", "Analyzing repository structure...")
            await persist_audit()
            yield send({"status": "explanation", "session_id": audit["sessionId"], "message": "Analyzing repository structure..."})

            explanation_response = ""
            explanation_stream, explanation_usage_future = await openai_service.stream_completion(
                provider=provider,
                model=model,
                system_prompt=SYSTEM_FIRST_PROMPT,
                data={"file_tree": github_data.file_tree, "readme": github_data.readme},
                api_key=parsed.api_key,
                reasoning_effort="medium",
                max_output_tokens=EXPLANATION_MAX_OUTPUT_TOKENS,
            )
            async for chunk in explanation_stream:
                explanation_response += chunk
                yield send({"status": "explanation_chunk", "session_id": audit["sessionId"], "chunk": chunk})
            explanation_usage = await explanation_usage_future
            if explanation_usage is not None:
                actual_usages.append(explanation_usage)
                audit = _append_stage_usage(
                    audit,
                    {
                        "stage": "explanation",
                        "model": model,
                        "costSummary": create_cost_summary(
                            kind="actual",
                            model=model,
                            usage=explanation_usage,
                            approximate=False,
                        ),
                        "createdAt": _now_iso(),
                    },
                )
            else:
                has_complete_measured_usage = False

            explanation = _extract_tagged_section(explanation_response, "explanation")
            audit["explanation"] = explanation
            audit["updatedAt"] = _now_iso()
            await persist_audit()

            file_tree_lookup = build_file_tree_lookup(github_data.file_tree)
            valid_graph: DiagramGraph | None = None
            validation_feedback: str | None = None
            previous_graph: str | None = None

            yield send(
                {
                    "status": "graph_sent",
                    "session_id": audit["sessionId"],
                    "message": f"Sending graph planning request to {model}...",
                }
            )

            for attempt in range(1, MAX_GRAPH_ATTEMPTS + 1):
                status = "graph" if attempt == 1 else "graph_retry"
                message = (
                    "Planning repository graph..."
                    if attempt == 1
                    else f"Retrying graph planning ({attempt}/{MAX_GRAPH_ATTEMPTS})..."
                )
                audit = _timeline(audit, status, message)
                await persist_audit()
                yield send(
                    {
                        "status": status,
                        "session_id": audit["sessionId"],
                        "message": message,
                        "graph_attempts": audit["graphAttempts"],
                    }
                )

                graph, raw_output, usage = await openai_service.generate_structured_output(
                    provider=provider,
                    model=model,
                    system_prompt=SYSTEM_GRAPH_PROMPT,
                    data={
                        "explanation": explanation,
                        "file_tree": github_data.file_tree,
                        "repo_owner": parsed.username,
                        "repo_name": parsed.repo,
                        "previous_graph": previous_graph,
                        "validation_feedback": validation_feedback,
                    },
                    text_format=DiagramGraph,
                    api_key=parsed.api_key,
                    reasoning_effort="low",
                    max_output_tokens=GRAPH_MAX_OUTPUT_TOKENS,
                )

                if usage is not None:
                    actual_usages.append(usage)
                    audit = _append_stage_usage(
                        audit,
                        {
                            "stage": "graph_attempt",
                            "attempt": attempt,
                            "model": model,
                            "costSummary": create_cost_summary(
                                kind="actual",
                                model=model,
                                usage=usage,
                                approximate=False,
                            ),
                            "createdAt": _now_iso(),
                        },
                    )
                else:
                    has_complete_measured_usage = False

                yield send({"status": status, "session_id": audit["sessionId"], "graph": graph.model_dump(by_alias=True)})

                issues = validate_diagram_graph(graph, file_tree_lookup)
                feedback = None if not issues else format_graph_validation_feedback(issues)
                audit["graphAttempts"] = [
                    *audit.get("graphAttempts", []),
                    {
                        "attempt": attempt,
                        "rawOutput": raw_output,
                        "graph": graph.model_dump(by_alias=True),
                        "validationFeedback": feedback,
                        "status": "succeeded" if not issues else "failed",
                        "createdAt": _now_iso(),
                    },
                ]

                if issues:
                    validation_feedback = feedback
                    previous_graph = raw_output
                    audit = _timeline(
                        audit,
                        "graph_validating",
                        f"Graph validation failed on attempt {attempt}/{MAX_GRAPH_ATTEMPTS}.",
                    )
                    await persist_audit()
                    yield send(
                        {
                            "status": "graph_validating",
                            "session_id": audit["sessionId"],
                            "message": f"Graph validation failed on attempt {attempt}/{MAX_GRAPH_ATTEMPTS}.",
                            "validation_error": validation_feedback,
                            "graph_attempts": audit["graphAttempts"],
                        }
                    )
                    continue

                valid_graph = graph
                audit["graph"] = graph.model_dump(by_alias=True)
                audit["updatedAt"] = _now_iso()
                break

            if valid_graph is None:
                error_message = validation_feedback or "Graph generation failed validation."
                audit = _set_failure(audit, failure_stage="graph_validating", validation_error=error_message)
                await persist_audit()
                yield send(
                    {
                        "status": "error",
                        "session_id": audit["sessionId"],
                        "error": "Graph generation remained invalid after retry attempts. Please retry generation.",
                        "error_code": "GRAPH_VALIDATION_FAILED",
                        "validation_error": error_message,
                        "failure_stage": "graph_validating",
                        "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                        "latest_session_audit": audit,
                    }
                )
                return

            audit = _timeline(audit, "diagram_compiling", "Compiling Mermaid diagram...")
            await persist_audit()
            yield send(
                {
                    "status": "diagram_compiling",
                    "session_id": audit["sessionId"],
                    "message": "Compiling Mermaid diagram...",
                    "graph": valid_graph.model_dump(by_alias=True),
                    "graph_attempts": audit["graphAttempts"],
                }
            )

            diagram = compile_diagram_graph(
                valid_graph,
                parsed.username,
                parsed.repo,
                github_data.default_branch,
            )
            audit["compiledDiagram"] = diagram
            audit["updatedAt"] = _now_iso()

            validation_result = await asyncio.to_thread(validate_mermaid_syntax, diagram)
            if not validation_result.valid:
                compiler_error = validation_result.message or "Compiled Mermaid failed validation."
                audit = _set_failure(
                    audit,
                    failure_stage="diagram_compiling",
                    compiler_error=compiler_error,
                )
                await persist_audit()
                yield send(
                    {
                        "status": "error",
                        "session_id": audit["sessionId"],
                        "error": "Compiled Mermaid failed validation.",
                        "error_code": "COMPILER_VALIDATION_FAILED",
                        "validation_error": compiler_error,
                        "failure_stage": "diagram_compiling",
                        "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                        "latest_session_audit": audit,
                    }
                )
                return

            final_cost = (
                create_cost_summary(
                    kind="actual",
                    model=model,
                    usage=sum_generation_usage(*actual_usages),
                    approximate=False,
                )
                if has_complete_measured_usage
                else {
                    **estimate["cost_summary"],
                    "kind": "actual",
                    "note": "Some stage usage was unavailable, so the final cost remains approximate.",
                }
            )
            audit = _set_final_cost(audit, final_cost)
            audit = _set_success(_timeline(audit, "complete", "Diagram generation complete."))
            await persist_successful_state(
                explanation=explanation,
                graph=valid_graph.model_dump(by_alias=True),
                diagram=diagram,
                used_own_key=bool(parsed.api_key),
            )

            yield send(
                {
                    "status": "complete",
                    "session_id": audit["sessionId"],
                    "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                    "diagram": diagram,
                    "explanation": explanation,
                    "graph": valid_graph.model_dump(by_alias=True),
                    "graph_attempts": audit["graphAttempts"],
                    "latest_session_audit": audit,
                    "generated_at": audit["updatedAt"],
                }
            )
        except Exception as exc:
            has_complete_measured_usage = False
            error_message = str(exc)
            audit = _set_failure(audit, failure_stage=audit.get("stage", "started"), validation_error=error_message)
            try:
                await persist_audit()
            except Exception:
                pass
            yield send(
                {
                    "status": "error",
                    "session_id": audit["sessionId"],
                    "error": error_message,
                    "error_code": "STREAM_FAILED",
                    "validation_error": error_message,
                    "failure_stage": audit.get("failureStage"),
                    "cost_summary": audit.get("finalCost") or audit.get("estimatedCost"),
                    "latest_session_audit": audit,
                }
            )
        finally:
            log_event(
                "generate.stream.finished",
                username=parsed.username,
                repo=parsed.repo,
                elapsed_ms=timer.elapsed_ms(),
                model=model,
            )
            if quota_reservation is not None:
                actual_committed_tokens = (
                    sum_generation_usage(*actual_usages).total_tokens
                    if has_complete_measured_usage
                    else quota_reservation.reserved_tokens
                )
                audit = {
                    **audit,
                    "quotaStatus": "finalized",
                    "quotaBucket": quota_reservation.quota_bucket,
                    "quotaDateUtc": quota_reservation.quota_date_utc,
                    "reservedTokens": quota_reservation.reserved_tokens,
                    "actualCommittedTokens": actual_committed_tokens,
                    "quotaResetAt": quota_reservation.quota_reset_at,
                }
                try:
                    await asyncio.to_thread(
                        finalize_complimentary_quota,
                        repository=diagram_state_repository,
                        reservation=quota_reservation,
                        committed_tokens=actual_committed_tokens,
                    )
                    await persist_audit()
                except Exception:
                    pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")
