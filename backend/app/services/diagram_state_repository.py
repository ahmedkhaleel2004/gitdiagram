from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any, Literal
from urllib.parse import quote

import boto3
import requests
from botocore.exceptions import ClientError

ArtifactVisibility = Literal["public", "private"]

STATUS_TTL_SECONDS = 3 * 24 * 60 * 60
QUOTA_TTL_SECONDS = 3 * 24 * 60 * 60
PUBLIC_BROWSE_INDEX_KEY = "public/v1/_meta/browse-index.json"

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


def _normalize_segment(value: str) -> str:
    return quote(value.strip().lower(), safe="")


def _repo_key(username: str, repo: str) -> str:
    return f"{username.strip().lower()}/{repo.strip().lower()}"


class _ArtifactLocator:
    def __init__(
        self,
        *,
        public_bucket: str | None,
        private_bucket: str | None,
        cache_key_secret: str | None,
    ) -> None:
        self.public_bucket = public_bucket
        self.private_bucket = private_bucket
        self.cache_key_secret = cache_key_secret

    def is_configured(self) -> bool:
        return bool(self.public_bucket and self.private_bucket and self.cache_key_secret)

    def _pat_namespace(self, github_pat: str) -> str:
        if not self.cache_key_secret:
            raise ValueError("Missing CACHE_KEY_SECRET.")
        return hmac.new(
            self.cache_key_secret.encode("utf-8"),
            github_pat.strip().encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def resolve_visibility(
        self,
        *,
        visibility: ArtifactVisibility | None,
        github_pat: str | None,
    ) -> ArtifactVisibility:
        if visibility:
            return visibility
        return "private" if (github_pat or "").strip() else "public"

    def resolve_location(
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
            if not self.private_bucket:
                raise ValueError("Missing R2_PRIVATE_BUCKET.")
            return (
                self.private_bucket,
                f"private/v1/{namespace}/{normalized_username}/{normalized_repo}.json",
                f"status:v1:private:{namespace}:{normalized_username}:{normalized_repo}",
            )

        if not self.public_bucket:
            raise ValueError("Missing R2_PUBLIC_BUCKET.")
        return (
            self.public_bucket,
            f"public/v1/{normalized_username}/{normalized_repo}.json",
            f"status:v1:public:{normalized_username}:{normalized_repo}",
        )


class _R2ArtifactStore:
    def __init__(
        self,
        *,
        account_id: str | None,
        access_key_id: str | None,
        secret_access_key: str | None,
        locator: _ArtifactLocator,
    ) -> None:
        self.account_id = account_id
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.locator = locator
        self._s3_client = None

    def is_configured(self) -> bool:
        return bool(
            self.account_id
            and self.access_key_id
            and self.secret_access_key
            and self.locator.is_configured()
        )

    def _get_client(self):
        if self._s3_client is not None:
            return self._s3_client
        if not self.is_configured():
            raise ValueError("Missing R2 configuration.")
        self._s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://{self.account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            region_name="auto",
        )
        return self._s3_client

    def get_json_object(self, bucket: str, key: str) -> dict[str, Any] | None:
        try:
            response = self._get_client().get_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code")
            if error_code in {"NoSuchKey", "404", "NotFound"}:
                return None
            raise

        body = response["Body"].read()
        if not body:
            return None
        return json.loads(body.decode("utf-8"))

    def put_json_object(self, bucket: str, key: str, payload: dict[str, Any]) -> None:
        self._get_client().put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(payload).encode("utf-8"),
            ContentType="application/json",
        )

    def _normalize_browse_index_entries(
        self,
        entries: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        deduped: dict[str, dict[str, Any]] = {}

        for raw_entry in entries:
            username = str(raw_entry.get("username") or "").strip().lower()
            repo = str(raw_entry.get("repo") or "").strip().lower()
            last_successful_at = str(raw_entry.get("lastSuccessfulAt") or "")
            stargazer_count = raw_entry.get("stargazerCount")

            if not username or not repo or not last_successful_at:
                continue

            normalized_entry = {
                "username": username,
                "repo": repo,
                "lastSuccessfulAt": last_successful_at,
                "stargazerCount": stargazer_count if isinstance(stargazer_count, int) else None,
            }
            repo_key = _repo_key(username, repo)
            existing = deduped.get(repo_key)

            if existing is None:
                deduped[repo_key] = normalized_entry
                continue

            existing_time = str(existing.get("lastSuccessfulAt") or "")
            incoming_time = normalized_entry["lastSuccessfulAt"]
            if incoming_time > existing_time:
                deduped[repo_key] = normalized_entry
                continue

            if (
                incoming_time == existing_time
                and existing.get("stargazerCount") is None
                and normalized_entry.get("stargazerCount") is not None
            ):
                deduped[repo_key] = normalized_entry

        return sorted(
            deduped.values(),
            key=lambda entry: (str(entry["lastSuccessfulAt"]), _repo_key(entry["username"], entry["repo"])),
            reverse=True,
        )

    def upsert_browse_index_entry(
        self,
        *,
        username: str,
        repo: str,
        last_successful_at: str,
        stargazer_count: int | None,
    ) -> None:
        if not self.locator.public_bucket:
            raise ValueError("Missing R2_PUBLIC_BUCKET.")

        existing_index = self.get_json_object(self.locator.public_bucket, PUBLIC_BROWSE_INDEX_KEY) or {
            "version": 1,
            "entries": [],
        }
        existing_entries = existing_index.get("entries")
        if not isinstance(existing_entries, list):
            existing_entries = []

        updated_entries = self._normalize_browse_index_entries(
            [
                *existing_entries,
                {
                    "username": username,
                    "repo": repo,
                    "lastSuccessfulAt": last_successful_at,
                    "stargazerCount": stargazer_count,
                },
            ]
        )

        self.put_json_object(
            self.locator.public_bucket,
            PUBLIC_BROWSE_INDEX_KEY,
            {
                "version": 1,
                "updatedAt": last_successful_at,
                "entries": updated_entries,
            },
        )

    def update_artifact_latest_session_summary(
        self,
        *,
        username: str,
        repo: str,
        visibility: ArtifactVisibility,
        latest_session_summary: dict[str, Any],
        github_pat: str | None = None,
    ) -> bool:
        bucket, artifact_key, _status_key = self.locator.resolve_location(
            username=username,
            repo=repo,
            visibility=visibility,
            github_pat=github_pat,
        )
        artifact = self.get_json_object(bucket, artifact_key)
        if not artifact:
            return False

        artifact["latestSessionSummary"] = latest_session_summary
        self.put_json_object(bucket, artifact_key, artifact)
        return True

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
        stargazer_count: int | None,
        visibility: ArtifactVisibility,
        github_pat: str | None = None,
        slim_audit: dict[str, Any],
    ) -> tuple[str, str, str]:
        bucket, artifact_key, status_key = self.locator.resolve_location(
            username=username,
            repo=repo,
            visibility=visibility,
            github_pat=github_pat,
        )
        updated_at = str(audit.get("updatedAt") or audit.get("createdAt") or "")
        payload = {
            "version": 1,
            "visibility": visibility,
            "username": username,
            "repo": repo,
            "stargazerCount": stargazer_count,
            "diagram": diagram,
            "explanation": explanation,
            "graph": graph,
            "generatedAt": updated_at,
            "usedOwnKey": used_own_key,
            "latestSessionSummary": slim_audit,
            "lastSuccessfulAt": updated_at,
        }
        self.put_json_object(bucket, artifact_key, payload)
        if visibility == "public":
            self.upsert_browse_index_entry(
                username=username,
                repo=repo,
                last_successful_at=updated_at,
                stargazer_count=stargazer_count,
            )
        return bucket, artifact_key, status_key


class _UpstashClient:
    def __init__(self, *, url: str | None, token: str | None) -> None:
        self.upstash_url = url
        self.upstash_token = token

    def is_configured(self) -> bool:
        return bool(self.upstash_url and self.upstash_token)

    def headers(self) -> dict[str, str]:
        if not self.is_configured():
            raise ValueError("Missing Upstash configuration.")
        return {
            "Authorization": f"Bearer {self.upstash_token}",
            "Content-Type": "application/json",
        }

    def command(self, command: list[Any]) -> Any:
        if not self.upstash_url:
            raise ValueError("Missing Upstash configuration.")
        response = requests.post(
            self.upstash_url.rstrip("/"),
            headers=self.headers(),
            json=command,
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise ValueError(f"Upstash command failed: {payload['error']}")
        return payload.get("result")

    def eval(self, *, script: str, keys: list[str], args: list[Any]) -> Any:
        if not self.upstash_url:
            raise ValueError("Missing Upstash configuration.")
        response = requests.post(
            self.upstash_url.rstrip("/"),
            headers=self.headers(),
            json=["EVAL", script, len(keys), *keys, *args],
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise ValueError(f"Upstash eval failed: {payload['error']}")
        return payload.get("result")


class _FailureStatusStore:
    def __init__(self, *, redis: _UpstashClient, locator: _ArtifactLocator) -> None:
        self.redis = redis
        self.locator = locator

    def is_configured(self) -> bool:
        return self.redis.is_configured()

    def clear(
        self,
        *,
        username: str,
        repo: str,
        visibility: ArtifactVisibility,
        github_pat: str | None = None,
    ) -> None:
        _bucket, _artifact_key, status_key = self.locator.resolve_location(
            username=username,
            repo=repo,
            visibility=visibility,
            github_pat=github_pat,
        )
        self.redis.command(["DEL", status_key])

    def write(
        self,
        *,
        username: str,
        repo: str,
        visibility: ArtifactVisibility,
        latest_session_summary: dict[str, Any],
        github_pat: str | None = None,
    ) -> None:
        _bucket, _artifact_key, status_key = self.locator.resolve_location(
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
        self.redis.command([
            "SET",
            status_key,
            json.dumps(payload),
            "EX",
            STATUS_TTL_SECONDS,
        ])


class _QuotaStore:
    def __init__(self, *, redis: _UpstashClient) -> None:
        self.redis = redis

    def is_configured(self) -> bool:
        return self.redis.is_configured()

    def _quota_key(self, quota_date_utc: str, quota_bucket: str) -> str:
        pricing_model = quota_bucket.split(":")[1] if ":" in quota_bucket else quota_bucket
        return f"quota:v1:{quota_date_utc}:{pricing_model}"

    def reserve(
        self,
        *,
        quota_date_utc: str,
        quota_bucket: str,
        token_limit: int,
        reservation_tokens: int,
    ) -> tuple[bool, int, int]:
        result = self.redis.eval(
            script=RESERVE_QUOTA_SCRIPT,
            keys=[self._quota_key(quota_date_utc, quota_bucket)],
            args=[token_limit, reservation_tokens, QUOTA_TTL_SECONDS],
        )
        return bool(result[0] == 1), int(result[1] or 0), int(result[2] or 0)

    def finalize(
        self,
        *,
        quota_date_utc: str,
        quota_bucket: str,
        reservation_tokens: int,
        committed_tokens: int,
    ) -> tuple[int, int]:
        result = self.redis.eval(
            script=FINALIZE_QUOTA_SCRIPT,
            keys=[self._quota_key(quota_date_utc, quota_bucket)],
            args=[reservation_tokens, committed_tokens, QUOTA_TTL_SECONDS],
        )
        return int(result[0] or 0), int(result[1] or 0)


class DiagramStateRepository:
    def __init__(self) -> None:
        locator = _ArtifactLocator(
            public_bucket=_read_env("R2_PUBLIC_BUCKET"),
            private_bucket=_read_env("R2_PRIVATE_BUCKET"),
            cache_key_secret=_read_env("CACHE_KEY_SECRET"),
        )
        self.artifact_store = _R2ArtifactStore(
            account_id=_read_env("R2_ACCOUNT_ID"),
            access_key_id=_read_env("R2_ACCESS_KEY_ID"),
            secret_access_key=_read_env("R2_SECRET_ACCESS_KEY"),
            locator=locator,
        )
        self.redis = _UpstashClient(
            url=_read_env("UPSTASH_REDIS_REST_URL"),
            token=_read_env("UPSTASH_REDIS_REST_TOKEN"),
        )
        self.status_store = _FailureStatusStore(redis=self.redis, locator=locator)
        self.quota_store = _QuotaStore(redis=self.redis)
        self.locator = locator

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

    def artifact_storage_is_configured(self) -> bool:
        return self.artifact_store.is_configured()

    def status_store_is_configured(self) -> bool:
        return self.status_store.is_configured()

    def is_configured(self) -> bool:
        return self.artifact_storage_is_configured() or self.status_store_is_configured()

    def quota_is_configured(self) -> bool:
        return self.quota_store.is_configured()

    def persist_terminal_session_audit(
        self,
        *,
        username: str,
        repo: str,
        audit: dict[str, Any],
        visibility: ArtifactVisibility | None = None,
        github_pat: str | None = None,
    ) -> None:
        if audit.get("status") not in {"failed", "succeeded"}:
            return

        resolved_visibility = self.locator.resolve_visibility(
            visibility=visibility,
            github_pat=github_pat,
        )
        latest_session_summary = self._slim_audit(audit)

        artifact_updated = False
        if self.artifact_storage_is_configured():
            artifact_updated = self.artifact_store.update_artifact_latest_session_summary(
                username=username,
                repo=repo,
                visibility=resolved_visibility,
                github_pat=github_pat,
                latest_session_summary=latest_session_summary,
            )

        if audit.get("status") == "failed" and not artifact_updated and self.status_store_is_configured():
            self.status_store.write(
                username=username,
                repo=repo,
                visibility=resolved_visibility,
                github_pat=github_pat,
                latest_session_summary=latest_session_summary,
            )
            return

        if self.status_store_is_configured():
            self.status_store.clear(
                username=username,
                repo=repo,
                visibility=resolved_visibility,
                github_pat=github_pat,
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
        stargazer_count: int | None,
        visibility: ArtifactVisibility = "public",
        github_pat: str | None = None,
    ) -> None:
        if not self.artifact_storage_is_configured():
            raise ValueError("Missing R2 configuration.")

        slim_audit = self._slim_audit(audit)
        self.artifact_store.save_successful_diagram_state(
            username=username,
            repo=repo,
            explanation=explanation,
            graph=graph,
            diagram=diagram,
            audit=audit,
            used_own_key=used_own_key,
            stargazer_count=stargazer_count,
            visibility=visibility,
            github_pat=github_pat,
            slim_audit=slim_audit,
        )
        if self.status_store_is_configured():
            self.status_store.clear(
                username=username,
                repo=repo,
                visibility=visibility,
                github_pat=github_pat,
            )

    def reserve_complimentary_quota(
        self,
        *,
        quota_date_utc: str,
        quota_bucket: str,
        token_limit: int,
        reservation_tokens: int,
    ) -> tuple[bool, int, int]:
        return self.quota_store.reserve(
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
        return self.quota_store.finalize(
            quota_date_utc=quota_date_utc,
            quota_bucket=quota_bucket,
            reservation_tokens=reservation_tokens,
            committed_tokens=committed_tokens,
        )
