from datetime import datetime, timezone

from app.services.complimentary_gate import (
    admit_complimentary_quota,
    build_complimentary_admission_tokens,
    finalize_complimentary_quota,
    get_complimentary_model_family,
    model_matches_complimentary_family,
)


class FakeQuotaRepository:
    def __init__(self):
        self.reserved = None
        self.finalized = None

    def reserve_complimentary_quota(self, **kwargs):
        self.reserved = kwargs
        return True, 1_000

    def finalize_complimentary_quota(self, **kwargs):
        self.finalized = kwargs
        return kwargs["committed_tokens"]


def test_get_complimentary_model_family_normalizes_snapshot(monkeypatch):
    monkeypatch.setenv(
        "OPENAI_COMPLIMENTARY_MODEL_FAMILY",
        "gpt-5.6-terra-2026-07-09",
    )

    assert get_complimentary_model_family() == "gpt-5.6-terra"
    assert model_matches_complimentary_family("not-a-real-model") is False


def test_build_complimentary_admission_tokens_uses_repair_static_input_for_retries():
    assert (
        build_complimentary_admission_tokens(
            explanation_input_tokens=100,
            graph_static_input_tokens=200,
            graph_repair_static_input_tokens=300,
        )
        == 58_900
    )


def test_reservation_tokens_are_released_during_finalization():
    repository = FakeQuotaRepository()
    admitted, reservation, _quota_reset_at = admit_complimentary_quota(
        repository=repository,
        model="gpt-5.6-terra",
        requested_tokens=82_700,
        now=datetime(2026, 3, 28, 12, 34, 56, tzinfo=timezone.utc),
    )

    assert admitted is True
    assert reservation is not None
    assert reservation.reserved_tokens == 82_700
    assert repository.reserved == {
        "quota_date_utc": "2026-03-28",
        "quota_bucket": "openai-complimentary-small-models",
        "token_limit": 10_000_000,
        "requested_tokens": 82_700,
    }

    finalize_complimentary_quota(
        repository=repository,
        reservation=reservation,
        committed_tokens=345,
    )

    assert repository.finalized == {
        "quota_date_utc": "2026-03-28",
        "quota_bucket": "openai-complimentary-small-models",
        "committed_tokens": 345,
        "reservation_tokens": 82_700,
    }
