from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.services.diagram_state_repository import DiagramStateRepository
from app.services.graph_service import MAX_GRAPH_ATTEMPTS
from app.services.model_config import AIProvider
from app.services.pricing import (
    EXPLANATION_MAX_OUTPUT_TOKENS,
    GRAPH_MAX_OUTPUT_TOKENS,
    resolve_pricing_model,
)

DEFAULT_DAILY_LIMIT_TOKENS = 10_000_000
DEFAULT_MODEL_FAMILY = "gpt-5.4-mini"
RETRY_INPUT_BUFFER_TOKENS = 2_000
DEFAULT_DENIAL_MESSAGE = (
    "GitDiagram's free daily OpenAI capacity is used up for now. "
    "I'm a solo student engineer running this free and open source, "
    "so please try again after 00:00 UTC or use your own OpenAI API key."
)
DEFAULT_PROVIDER_MISMATCH_MESSAGE = (
    "GitDiagram's complimentary-only mode requires AI_PROVIDER=openai on the "
    "default server key. I'm a solo student engineer running this free and open "
    "source, so please either switch the server back to OpenAI mini or use your own API key."
)
DEFAULT_MODEL_MISMATCH_MESSAGE = (
    "GitDiagram's complimentary-only mode requires the gpt-5.4-mini model family "
    "on the default server key. I'm a solo student engineer running this free and open "
    "source, so please switch the server back to OpenAI mini or use your own API key."
)
@dataclass(frozen=True)
class ComplimentaryQuotaReservation:
    quota_bucket: str
    quota_date_utc: str
    quota_reset_at: str


def _read_flag(name: str) -> bool:
    value = (os.getenv(name) or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _read_int(name: str, fallback: int) -> int:
    raw_value = (os.getenv(name) or "").strip()
    if not raw_value:
        return fallback

    try:
        parsed = int(raw_value)
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback


def _read_str(name: str, fallback: str) -> str:
    value = (os.getenv(name) or "").strip().lower()
    return value or fallback


def is_complimentary_gate_enabled() -> bool:
    return _read_flag("OPENAI_COMPLIMENTARY_GATE_ENABLED")


def should_apply_complimentary_gate(
    *,
    provider: AIProvider,
    model: str,
    api_key: str | None,
) -> bool:
    if not is_complimentary_gate_enabled():
        return False
    if provider != "openai":
        return False
    return not api_key


def get_complimentary_model_family() -> str:
    return resolve_pricing_model(
        _read_str("OPENAI_COMPLIMENTARY_MODEL_FAMILY", DEFAULT_MODEL_FAMILY)
    )


def model_matches_complimentary_family(model: str) -> bool:
    return resolve_pricing_model(model) == get_complimentary_model_family()


def get_complimentary_daily_limit_tokens() -> int:
    return _read_int(
        "OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS",
        DEFAULT_DAILY_LIMIT_TOKENS,
    )


def get_complimentary_quota_date_utc(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    return current.date().isoformat()


def get_complimentary_quota_reset_at(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    next_reset = datetime.combine(
        current.date() + timedelta(days=1),
        datetime.min.time(),
        tzinfo=timezone.utc,
    )
    return next_reset.isoformat()


def get_complimentary_quota_bucket(model: str) -> str:
    return f"openai:{resolve_pricing_model(model)}:complimentary"


def build_complimentary_admission_tokens(
    *,
    explanation_input_tokens: int,
    graph_static_input_tokens: int,
) -> int:
    explanation_stage_tokens = explanation_input_tokens + EXPLANATION_MAX_OUTPUT_TOKENS
    first_graph_attempt_tokens = (
        graph_static_input_tokens
        + EXPLANATION_MAX_OUTPUT_TOKENS
        + GRAPH_MAX_OUTPUT_TOKENS
    )
    retry_graph_attempt_tokens = (
        graph_static_input_tokens
        + EXPLANATION_MAX_OUTPUT_TOKENS
        + GRAPH_MAX_OUTPUT_TOKENS
        + RETRY_INPUT_BUFFER_TOKENS
        + GRAPH_MAX_OUTPUT_TOKENS
    )
    return (
        explanation_stage_tokens
        + first_graph_attempt_tokens
        + retry_graph_attempt_tokens * max(MAX_GRAPH_ATTEMPTS - 1, 0)
    )


def get_complimentary_denial_message() -> str:
    return DEFAULT_DENIAL_MESSAGE


def get_complimentary_provider_mismatch_message() -> str:
    return DEFAULT_PROVIDER_MISMATCH_MESSAGE


def get_complimentary_model_mismatch_message() -> str:
    return DEFAULT_MODEL_MISMATCH_MESSAGE


def admit_complimentary_quota(
    *,
    repository: DiagramStateRepository,
    model: str,
    requested_tokens: int,
    now: datetime | None = None,
) -> tuple[bool, ComplimentaryQuotaReservation | None, str]:
    current = now or datetime.now(timezone.utc)
    quota_date_utc = get_complimentary_quota_date_utc(current)
    quota_reset_at = get_complimentary_quota_reset_at(current)
    quota_bucket = get_complimentary_quota_bucket(model)
    admitted, _used_tokens = repository.reserve_complimentary_quota(
        quota_date_utc=quota_date_utc,
        quota_bucket=quota_bucket,
        token_limit=get_complimentary_daily_limit_tokens(),
        requested_tokens=requested_tokens,
    )
    if not admitted:
        return False, None, quota_reset_at

    return (
        True,
        ComplimentaryQuotaReservation(
            quota_bucket=quota_bucket,
            quota_date_utc=quota_date_utc,
            quota_reset_at=quota_reset_at,
        ),
        quota_reset_at,
    )


def finalize_complimentary_quota(
    *,
    repository: DiagramStateRepository,
    reservation: ComplimentaryQuotaReservation,
    committed_tokens: int,
) -> None:
    repository.finalize_complimentary_quota(
        quota_date_utc=reservation.quota_date_utc,
        quota_bucket=reservation.quota_bucket,
        committed_tokens=committed_tokens,
    )
