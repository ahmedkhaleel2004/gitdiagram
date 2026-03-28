from __future__ import annotations

import json
import os
from typing import Any

import psycopg


class DiagramStateRepository:
    def __init__(self) -> None:
        self.database_url = (os.getenv("POSTGRES_URL") or "").strip()

    def is_configured(self) -> bool:
        return bool(self.database_url)

    def _connect(self):
        if not self.database_url:
            raise ValueError("Missing POSTGRES_URL for diagram state persistence.")
        return psycopg.connect(self.database_url)

    def upsert_latest_session_audit(self, *, username: str, repo: str, audit: dict[str, Any]) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO gitdiagram_diagram_cache (
                  username,
                  repo,
                  latest_session_id,
                  latest_session_status,
                  latest_session_stage,
                  latest_session_provider,
                  latest_session_model,
                  latest_session_audit
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (username, repo) DO UPDATE SET
                  latest_session_id = EXCLUDED.latest_session_id,
                  latest_session_status = EXCLUDED.latest_session_status,
                  latest_session_stage = EXCLUDED.latest_session_stage,
                  latest_session_provider = EXCLUDED.latest_session_provider,
                  latest_session_model = EXCLUDED.latest_session_model,
                  latest_session_audit = EXCLUDED.latest_session_audit,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    username,
                    repo,
                    audit.get("sessionId"),
                    audit.get("status"),
                    audit.get("stage"),
                    audit.get("provider"),
                    audit.get("model"),
                    json.dumps(audit),
                ),
            )

    def save_successful_diagram_state(
        self,
        *,
        username: str,
        repo: str,
        explanation: str,
        graph: dict[str, Any],
        diagram: str,
        audit: dict[str, Any],
        used_own_key: bool,
    ) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO gitdiagram_diagram_cache (
                  username,
                  repo,
                  diagram,
                  explanation,
                  graph,
                  latest_session_id,
                  latest_session_status,
                  latest_session_stage,
                  latest_session_provider,
                  latest_session_model,
                  latest_session_audit,
                  last_successful_at,
                  used_own_key
                )
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s::jsonb, CURRENT_TIMESTAMP, %s)
                ON CONFLICT (username, repo) DO UPDATE SET
                  diagram = EXCLUDED.diagram,
                  explanation = EXCLUDED.explanation,
                  graph = EXCLUDED.graph,
                  latest_session_id = EXCLUDED.latest_session_id,
                  latest_session_status = EXCLUDED.latest_session_status,
                  latest_session_stage = EXCLUDED.latest_session_stage,
                  latest_session_provider = EXCLUDED.latest_session_provider,
                  latest_session_model = EXCLUDED.latest_session_model,
                  latest_session_audit = EXCLUDED.latest_session_audit,
                  last_successful_at = CURRENT_TIMESTAMP,
                  used_own_key = EXCLUDED.used_own_key,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    username,
                    repo,
                    diagram,
                    explanation,
                    json.dumps(graph),
                    audit.get("sessionId"),
                    audit.get("status"),
                    audit.get("stage"),
                    audit.get("provider"),
                    audit.get("model"),
                    json.dumps(audit),
                    used_own_key,
                ),
            )

    def reserve_complimentary_quota(
        self,
        *,
        quota_date_utc: str,
        quota_bucket: str,
        token_limit: int,
        reservation_tokens: int,
    ) -> tuple[bool, int, int]:
        with self._connect() as conn, conn.cursor() as cur, conn.transaction():
            cur.execute(
                """
                INSERT INTO gitdiagram_openai_daily_quota (
                  quota_date_utc,
                  quota_bucket,
                  used_tokens,
                  reserved_tokens
                )
                VALUES (%s, %s, 0, 0)
                ON CONFLICT (quota_date_utc, quota_bucket) DO NOTHING
                """,
                (quota_date_utc, quota_bucket),
            )
            cur.execute(
                """
                SELECT used_tokens, reserved_tokens
                FROM gitdiagram_openai_daily_quota
                WHERE quota_date_utc = %s AND quota_bucket = %s
                FOR UPDATE
                """,
                (quota_date_utc, quota_bucket),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Complimentary quota row could not be loaded.")

            used_tokens, reserved_tokens = row
            next_reserved_tokens = reserved_tokens + reservation_tokens
            if used_tokens + reserved_tokens + reservation_tokens > token_limit:
                return False, used_tokens, reserved_tokens

            cur.execute(
                """
                UPDATE gitdiagram_openai_daily_quota
                SET reserved_tokens = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE quota_date_utc = %s AND quota_bucket = %s
                """,
                (next_reserved_tokens, quota_date_utc, quota_bucket),
            )
            return True, used_tokens, next_reserved_tokens

    def finalize_complimentary_quota(
        self,
        *,
        quota_date_utc: str,
        quota_bucket: str,
        reservation_tokens: int,
        committed_tokens: int,
    ) -> tuple[int, int]:
        with self._connect() as conn, conn.cursor() as cur, conn.transaction():
            cur.execute(
                """
                INSERT INTO gitdiagram_openai_daily_quota (
                  quota_date_utc,
                  quota_bucket,
                  used_tokens,
                  reserved_tokens
                )
                VALUES (%s, %s, 0, 0)
                ON CONFLICT (quota_date_utc, quota_bucket) DO NOTHING
                """,
                (quota_date_utc, quota_bucket),
            )
            cur.execute(
                """
                SELECT used_tokens, reserved_tokens
                FROM gitdiagram_openai_daily_quota
                WHERE quota_date_utc = %s AND quota_bucket = %s
                FOR UPDATE
                """,
                (quota_date_utc, quota_bucket),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Complimentary quota row could not be loaded.")

            used_tokens, reserved_tokens = row
            next_used_tokens = used_tokens + max(committed_tokens, 0)
            next_reserved_tokens = max(reserved_tokens - reservation_tokens, 0)

            cur.execute(
                """
                UPDATE gitdiagram_openai_daily_quota
                SET used_tokens = %s,
                    reserved_tokens = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE quota_date_utc = %s AND quota_bucket = %s
                """,
                (
                    next_used_tokens,
                    next_reserved_tokens,
                    quota_date_utc,
                    quota_bucket,
                ),
            )
            return next_used_tokens, next_reserved_tokens
