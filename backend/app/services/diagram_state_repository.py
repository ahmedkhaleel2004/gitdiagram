from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any, Literal
from urllib.parse import quote

import boto3
import psycopg
import requests
from botocore.exceptions import ClientError

ArtifactVisibility = Literal["public", "private"]

STATUS_TTL_SECONDS = 3 * 24 * 60 * 60
QUOTA_TTL_SECONDS = 3 * 24 * 60 * 60

RESERVE_QUOTA_SCRIPT = """
local key = KEYS[1]
local token_limit = tonumber(ARGV[1])
local reservation_tokens = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")

if used_tokens + reserved_tokens + reservation_tokens > token_limit then
  return {0, used_tokens, reserved_tokens}
end

local next_reserved_tokens = reserved_tokens + reservation_tokens
redis.call("HSET", key, "used_tokens", used_tokens, "reserved_tokens", next_reserved_tokens)
redis.call("EXPIRE", key, ttl)

return {1, used_tokens, next_reserved_tokens}
"""

FINALIZE_QUOTA_SCRIPT = """
local key = KEYS[1]
local reservation_tokens = tonumber(ARGV[1])
local committed_tokens = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local used_tokens = tonumber(redis.call("HGET", key, "used_tokens") or "0")
local reserved_tokens = tonumber(redis.call("HGET", key, "reserved_tokens") or "0")

local next_reserved_tokens = reserved_tokens - reservation_tokens
if next_reserved_tokens < 0 then
  next_reserved_tokens = 0
end

local next_used_tokens = used_tokens + math.max(committed_tokens, 0)
redis.call("HSET", key, "used_tokens", next_used_tokens, "reserved_tokens", next_reserved_tokens)
redis.call("EXPIRE", key, ttl)

return {next_used_tokens, next_reserved_tokens}
"""


def _read_env(name: str) -> str | None:
    value = (os.getenv(name) or "").strip()
    return value or None


def _read_flag(name: str, default: bool = False) -> bool:
    value = _read_env(name)
    if value is None:
      return default
    return value.lower() in {"1", "true", "yes", "on"}


def _normalize_segment(value: str) -> str:
    return quote(value.strip().lower(), safe="")


class DiagramStateRepository:
    def __init__(self) -> None:
        self.database_url = _read_env("POSTGRES_URL") or ""
        self.r2_account_id = _read_env("R2_ACCOUNT_ID")
        self.r2_access_key_id = _read_env("R2_ACCESS_KEY_ID")
        self.r2_secret_access_key = _read_env("R2_SECRET_ACCESS_KEY")
        self.r2_public_bucket = _read_env("R2_PUBLIC_BUCKET")
        self.r2_private_bucket = _read_env("R2_PRIVATE_BUCKET")
        self.cache_key_secret = _read_env("CACHE_KEY_SECRET")
        self.upstash_url = _read_env("UPSTASH_REDIS_REST_URL")
        self.upstash_token = _read_env("UPSTASH_REDIS_REST_TOKEN")
        self.cache_backend = (_read_env("DIAGRAM_CACHE_BACKEND") or ("object" if self._has_r2_config() else "postgres")).lower()
        self.quota_backend = (_read_env("QUOTA_BACKEND") or ("upstash" if self._has_upstash_config() else "postgres")).lower()
        self.postgres_fallback_enabled = _read_flag("POSTGRES_FALLBACK_ENABLED", False)
        self._s3_client = None

    def _has_r2_config(self) -> bool:
        return bool(
            self.r2_account_id
            and self.r2_access_key_id
            and self.r2_secret_access_key
            and self.r2_public_bucket
            and self.r2_private_bucket
        )

    def _has_upstash_config(self) -> bool:
        return bool(self.upstash_url and self.upstash_token)

    def _should_use_object_storage(self) -> bool:
        return self.cache_backend in {"dual", "object"}

    def _should_dual_write_postgres(self) -> bool:
        return self.cache_backend == "dual" and bool(self.database_url)

    def is_configured(self) -> bool:
        return bool(self.database_url) or self._has_r2_config() or self._has_upstash_config()

    def quota_is_configured(self) -> bool:
        if self.quota_backend == "upstash":
            return self._has_upstash_config()
        return bool(self.database_url)

    def _connect(self):
        if not self.database_url:
            raise ValueError("Missing POSTGRES_URL for diagram state persistence.")
        return psycopg.connect(self.database_url)

    def _get_s3_client(self):
        if self._s3_client is not None:
            return self._s3_client
        if not self._has_r2_config():
            raise ValueError("Missing R2 configuration.")
        self._s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://{self.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=self.r2_access_key_id,
            aws_secret_access_key=self.r2_secret_access_key,
            region_name="auto",
        )
        return self._s3_client

    def _upstash_headers(self) -> dict[str, str]:
        if not self._has_upstash_config():
            raise ValueError("Missing Upstash configuration.")
        return {
            "Authorization": f"Bearer {self.upstash_token}",
            "Content-Type": "application/json",
        }

    def _upstash_command(self, command: list[Any]) -> Any:
        if not self.upstash_url:
            raise ValueError("Missing Upstash configuration.")
        response = requests.post(
            self.upstash_url.rstrip("/"),
            headers=self._upstash_headers(),
            json=command,
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise ValueError(f"Upstash command failed: {payload['error']}")
        return payload.get("result")

    def _upstash_eval(self, *, script: str, keys: list[str], args: list[Any]) -> Any:
        if not self.upstash_url:
            raise ValueError("Missing Upstash configuration.")
        response = requests.post(
            f"{self.upstash_url.rstrip('/')}/eval",
            headers=self._upstash_headers(),
            json={"script": script, "keys": keys, "args": args},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise ValueError(f"Upstash eval failed: {payload['error']}")
        return payload.get("result")

    def _pat_namespace(self, github_pat: str) -> str:
        if not self.cache_key_secret:
            raise ValueError("Missing CACHE_KEY_SECRET.")
        return hmac.new(
            self.cache_key_secret.encode("utf-8"),
            github_pat.strip().encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _resolve_visibility(
        self,
        *,
        visibility: ArtifactVisibility | None,
        github_pat: str | None,
    ) -> ArtifactVisibility:
        if visibility:
            return visibility
        return "private" if (github_pat or "").strip() else "public"

    def _resolve_location(
        self,
        *,
        username: str,
        repo: str,
        visibility: ArtifactVisibility,
        github_pat: str | None = None,
    ) -> tuple[str, str, str]:
        normalized_username = _normalize_segment(username)
        normalized_repo = _normalize_segment(repo)

        if visibility == "private":
            if not github_pat:
                raise ValueError("github_pat is required for private artifact keys.")
            namespace = self._pat_namespace(github_pat)
            if not self.r2_private_bucket:
                raise ValueError("Missing R2_PRIVATE_BUCKET.")
            return (
                self.r2_private_bucket,
                f"private/v1/{namespace}/{normalized_username}/{normalized_repo}.json",
                f"status:v1:private:{namespace}:{normalized_username}:{normalized_repo}",
            )

        if not self.r2_public_bucket:
            raise ValueError("Missing R2_PUBLIC_BUCKET.")
        return (
            self.r2_public_bucket,
            f"public/v1/{normalized_username}/{normalized_repo}.json",
            f"status:v1:public:{normalized_username}:{normalized_repo}",
        )

    def _slim_audit(self, audit: dict[str, Any]) -> dict[str, Any]:
        return {
            "sessionId": audit.get("sessionId"),
            "status": audit.get("status"),
            "stage": audit.get("stage"),
            "provider": audit.get("provider"),
            "model": audit.get("model"),
            "quotaStatus": audit.get("quotaStatus"),
            "quotaBucket": audit.get("quotaBucket"),
            "quotaDateUtc": audit.get("quotaDateUtc"),
            "reservedTokens": audit.get("reservedTokens"),
            "actualCommittedTokens": audit.get("actualCommittedTokens"),
            "quotaResetAt": audit.get("quotaResetAt"),
            "estimatedCost": audit.get("estimatedCost"),
            "finalCost": audit.get("finalCost"),
            "graph": audit.get("graph"),
            "graphAttempts": audit.get("graphAttempts", []) if audit.get("status") == "failed" else [],
            "stageUsages": [],
            "validationError": audit.get("validationError"),
            "failureStage": audit.get("failureStage"),
            "compilerError": audit.get("compilerError"),
            "renderError": audit.get("renderError"),
            "timeline": [],
            "createdAt": audit.get("createdAt"),
            "updatedAt": audit.get("updatedAt"),
        }

    def _get_json_object(self, bucket: str, key: str) -> dict[str, Any] | None:
        try:
            response = self._get_s3_client().get_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code in {"NoSuchKey", "404", "NotFound"}:
                return None
            raise

        body = response["Body"].read()
        if not body:
            return None
        return json.loads(body.decode("utf-8"))

    def _put_json_object(self, bucket: str, key: str, payload: dict[str, Any]) -> None:
        self._get_s3_client().put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(payload).encode("utf-8"),
            ContentType="application/json",
        )

    def _clear_failure_summary(self, status_key: str) -> None:
        self._upstash_command(["DEL", status_key])

    def _write_failure_summary(
        self,
        *,
        username: str,
        repo: str,
        visibility: ArtifactVisibility,
        latest_session_summary: dict[str, Any],
        github_pat: str | None = None,
    ) -> None:
        _bucket, _artifact_key, status_key = self._resolve_location(
            username=username,
            repo=repo,
            visibility=visibility,
            github_pat=github_pat,
        )
        payload = {
            "version": 1,
            "visibility": visibility,
            "username": username,
            "repo": repo,
            "latestSessionSummary": latest_session_summary,
        }
        self._upstash_command([
            "SET",
            status_key,
            json.dumps(payload),
            "EX",
            STATUS_TTL_SECONDS,
        ])

    def _update_artifact_latest_session_summary(
        self,
        *,
        username: str,
        repo: str,
        visibility: ArtifactVisibility,
        latest_session_summary: dict[str, Any],
        github_pat: str | None = None,
    ) -> bool:
        bucket, artifact_key, _status_key = self._resolve_location(
            username=username,
            repo=repo,
            visibility=visibility,
            github_pat=github_pat,
        )
        artifact = self._get_json_object(bucket, artifact_key)
        if not artifact:
            return False

        artifact["latestSessionSummary"] = latest_session_summary
        self._put_json_object(bucket, artifact_key, artifact)
        return True

    def _upsert_latest_session_audit_postgres(
        self,
        *,
        username: str,
        repo: str,
        audit: dict[str, Any],
    ) -> None:
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

    def upsert_latest_session_audit(
        self,
        *,
        username: str,
        repo: str,
        audit: dict[str, Any],
        visibility: ArtifactVisibility | None = None,
        github_pat: str | None = None,
    ) -> None:
        resolved_visibility = self._resolve_visibility(
            visibility=visibility,
            github_pat=github_pat,
        )

        if self.cache_backend == "postgres":
            self._upsert_latest_session_audit_postgres(
                username=username,
                repo=repo,
                audit=audit,
            )
            return

        if audit.get("status") == "failed":
            latest_session_summary = self._slim_audit(audit)
            artifact_updated = self._update_artifact_latest_session_summary(
                username=username,
                repo=repo,
                visibility=resolved_visibility,
                github_pat=github_pat,
                latest_session_summary=latest_session_summary,
            )
            if artifact_updated:
                self._clear_failure_summary(
                    self._resolve_location(
                        username=username,
                        repo=repo,
                        visibility=resolved_visibility,
                        github_pat=github_pat,
                    )[2]
                )
            else:
                self._write_failure_summary(
                    username=username,
                    repo=repo,
                    visibility=resolved_visibility,
                    github_pat=github_pat,
                    latest_session_summary=latest_session_summary,
                )

        if self._should_dual_write_postgres() and audit.get("status") != "running":
            self._upsert_latest_session_audit_postgres(
                username=username,
                repo=repo,
                audit=audit,
            )

    def _save_successful_diagram_state_postgres(
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
        visibility: ArtifactVisibility = "public",
        github_pat: str | None = None,
    ) -> None:
        if self._should_use_object_storage():
            bucket, artifact_key, status_key = self._resolve_location(
                username=username,
                repo=repo,
                visibility=visibility,
                github_pat=github_pat,
            )
            latest_session_summary = self._slim_audit(audit)
            updated_at = str(audit.get("updatedAt") or audit.get("createdAt") or "")
            payload = {
                "version": 1,
                "visibility": visibility,
                "username": username,
                "repo": repo,
                "diagram": diagram,
                "explanation": explanation,
                "graph": graph,
                "generatedAt": updated_at,
                "usedOwnKey": used_own_key,
                "latestSessionSummary": latest_session_summary,
                "lastSuccessfulAt": updated_at,
            }
            self._put_json_object(bucket, artifact_key, payload)
            self._clear_failure_summary(status_key)

        if self.cache_backend == "postgres" or self._should_dual_write_postgres():
            self._save_successful_diagram_state_postgres(
                username=username,
                repo=repo,
                explanation=explanation,
                graph=graph,
                diagram=diagram,
                audit=audit,
                used_own_key=used_own_key,
            )

    def _quota_key(self, quota_date_utc: str, quota_bucket: str) -> str:
        pricing_model = quota_bucket.split(":")[1] if ":" in quota_bucket else quota_bucket
        return f"quota:v1:{quota_date_utc}:{pricing_model}"

    def _reserve_complimentary_quota_postgres(
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

    def _finalize_complimentary_quota_postgres(
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

    def reserve_complimentary_quota(
        self,
        *,
        quota_date_utc: str,
        quota_bucket: str,
        token_limit: int,
        reservation_tokens: int,
    ) -> tuple[bool, int, int]:
        if self.quota_backend == "upstash":
            result = self._upstash_eval(
                script=RESERVE_QUOTA_SCRIPT,
                keys=[self._quota_key(quota_date_utc, quota_bucket)],
                args=[token_limit, reservation_tokens, QUOTA_TTL_SECONDS],
            )
            return bool(result[0] == 1), int(result[1] or 0), int(result[2] or 0)

        return self._reserve_complimentary_quota_postgres(
            quota_date_utc=quota_date_utc,
            quota_bucket=quota_bucket,
            token_limit=token_limit,
            reservation_tokens=reservation_tokens,
        )

    def finalize_complimentary_quota(
        self,
        *,
        quota_date_utc: str,
        quota_bucket: str,
        reservation_tokens: int,
        committed_tokens: int,
    ) -> tuple[int, int]:
        if self.quota_backend == "upstash":
            result = self._upstash_eval(
                script=FINALIZE_QUOTA_SCRIPT,
                keys=[self._quota_key(quota_date_utc, quota_bucket)],
                args=[reservation_tokens, committed_tokens, QUOTA_TTL_SECONDS],
            )
            return int(result[0] or 0), int(result[1] or 0)

        return self._finalize_complimentary_quota_postgres(
            quota_date_utc=quota_date_utc,
            quota_bucket=quota_bucket,
            reservation_tokens=reservation_tokens,
            committed_tokens=committed_tokens,
        )
