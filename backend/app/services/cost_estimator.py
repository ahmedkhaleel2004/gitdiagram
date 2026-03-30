from __future__ import annotations

from app.prompts import SYSTEM_FIRST_PROMPT, SYSTEM_GRAPH_PROMPT
from app.services.model_config import AIProvider, supports_exact_input_token_count
from app.services.openai_service import OpenAIService
from app.services.pricing import (
    EXPLANATION_MAX_OUTPUT_TOKENS,
    GRAPH_MAX_OUTPUT_TOKENS,
    create_estimate_cost_summary,
    estimate_text_token_cost_usd,
)
from app.utils.format_message import format_user_message

openai_service = OpenAIService()


async def _count_prompt_input_tokens(
    *,
    provider: AIProvider,
    model: str,
    system_prompt: str,
    data: dict[str, str | None],
    api_key: str | None = None,
    reasoning_effort: str | None = None,
    prefer_exact_input_token_count: bool = True,
) -> tuple[int, bool]:
    user_prompt = format_user_message(data)
    if not prefer_exact_input_token_count or not supports_exact_input_token_count(provider):
        return openai_service.estimate_tokens(f"{system_prompt}\n{user_prompt}"), True

    try:
        count = await openai_service.count_input_tokens(
            provider=provider,
            model=model,
            system_prompt=system_prompt,
            data=data,
            api_key=api_key,
            reasoning_effort=reasoning_effort,
        )
        return count, False
    except Exception:
        return openai_service.estimate_tokens(f"{system_prompt}\n{user_prompt}"), True


async def estimate_generation_cost(
    *,
    provider: AIProvider,
    model: str,
    file_tree: str,
    readme: str,
    username: str,
    repo: str,
    api_key: str | None = None,
    prefer_exact_input_token_count: bool = True,
) -> dict[str, object]:
    explanation_count, explanation_used_fallback = await _count_prompt_input_tokens(
        provider=provider,
        model=model,
        system_prompt=SYSTEM_FIRST_PROMPT,
        data={
            "file_tree": file_tree,
            "readme": readme,
        },
        api_key=api_key,
        reasoning_effort="medium",
        prefer_exact_input_token_count=prefer_exact_input_token_count,
    )
    graph_static_count, graph_used_fallback = await _count_prompt_input_tokens(
        provider=provider,
        model=model,
        system_prompt=SYSTEM_GRAPH_PROMPT,
        data={
            "explanation": "",
            "file_tree": file_tree,
            "repo_owner": username,
            "repo_name": repo,
            "previous_graph": "",
            "validation_feedback": "",
        },
        api_key=api_key,
        reasoning_effort="low",
        prefer_exact_input_token_count=prefer_exact_input_token_count,
    )

    note_parts = [
        "Estimate assumes one graph-planning attempt and the configured output caps."
    ]
    if explanation_used_fallback or graph_used_fallback:
        note_parts.append("Some input tokens were approximated with a conservative local fallback.")

    cost_summary = create_estimate_cost_summary(
        model=model,
        explanation_input_tokens=explanation_count,
        graph_static_input_tokens=graph_static_count,
        approximate=True,
        note=" ".join(note_parts),
    )
    _cost_usd, pricing_model, pricing = estimate_text_token_cost_usd(
        model=model,
        input_tokens=cost_summary["usage"]["inputTokens"],
        output_tokens=cost_summary["usage"]["outputTokens"],
    )

    return {
        "cost_summary": cost_summary,
        "estimated_input_tokens": cost_summary["usage"]["inputTokens"],
        "estimated_output_tokens": EXPLANATION_MAX_OUTPUT_TOKENS
        + GRAPH_MAX_OUTPUT_TOKENS,
        "pricing_model": pricing_model,
        "pricing": pricing,
        "explanation_input_tokens": explanation_count,
        "graph_static_input_tokens": graph_static_count,
    }
