from __future__ import annotations

import base64
import os
from datetime import UTC, datetime, timedelta
from dataclasses import dataclass

import jwt
import requests

EXCLUDED_PATTERNS = [
    "node_modules/",
    "vendor/",
    "venv/",
    ".min.",
    ".pyc",
    ".pyo",
    ".pyd",
    ".so",
    ".dll",
    ".class",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".ico",
    ".svg",
    ".ttf",
    ".woff",
    ".webp",
    "__pycache__/",
    ".cache/",
    ".tmp/",
    "yarn.lock",
    "poetry.lock",
    "*.log",
    ".vscode/",
    ".idea/",
]


@dataclass(frozen=True)
class GithubData:
    default_branch: str
    file_tree: str
    readme: str
    is_private: bool
    stargazer_count: int | None


def _should_include_file(path: str) -> bool:
    lower_path = path.lower()
    return not any(pattern in lower_path for pattern in EXCLUDED_PATTERNS)


def _fetch_json(url: str, headers: dict[str, str], not_found_message: str) -> dict:
    response = requests.get(url, headers=headers, timeout=30)
    if response.status_code == 404:
        raise ValueError(not_found_message)
    if not response.ok:
        raise ValueError(f"GitHub request failed ({response.status_code}): {response.text}")
    return response.json()


class GitHubService:
    def __init__(self, pat: str | None = None):
        # Request-provided PAT (or env PAT) has top priority.
        self.github_token = (pat or os.getenv("GITHUB_PAT") or "").strip() or None

        # GitHub App credentials are used when PAT is unavailable.
        self.client_id = (os.getenv("GITHUB_CLIENT_ID") or "").strip() or None
        self.private_key = (os.getenv("GITHUB_PRIVATE_KEY") or "").strip() or None
        self.installation_id = (os.getenv("GITHUB_INSTALLATION_ID") or "").strip() or None

        self.access_token: str | None = None
        self.token_expires_at: datetime | None = None

    def _normalize_private_key(self) -> str:
        if not self.private_key:
            raise ValueError("Missing GITHUB_PRIVATE_KEY.")
        # Supports both literal newlines and escaped \\n forms.
        return self.private_key.replace("\\n", "\n")

    def _can_use_app_auth(self) -> bool:
        return bool(self.client_id and self.private_key and self.installation_id)

    def _generate_jwt(self) -> str:
        if not self.client_id:
            raise ValueError("Missing GITHUB_CLIENT_ID.")
        now = int(datetime.now(UTC).timestamp())
        payload = {
            "iat": now,
            "exp": now + (10 * 60),
            "iss": self.client_id,
        }
        return jwt.encode(payload, self._normalize_private_key(), algorithm="RS256")

    def _get_installation_token(self) -> str:
        if self.access_token and self.token_expires_at and self.token_expires_at > datetime.now(UTC):
            return self.access_token

        if not self.installation_id:
            raise ValueError("Missing GITHUB_INSTALLATION_ID.")

        jwt_token = self._generate_jwt()
        response = requests.post(
            f"https://api.github.com/app/installations/{self.installation_id}/access_tokens",
            headers={
                "Authorization": f"Bearer {jwt_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30,
        )
        if not response.ok:
            raise ValueError(
                f"GitHub app token request failed ({response.status_code}): {response.text}"
            )

        payload = response.json()
        token = payload.get("token")
        if not isinstance(token, str) or not token:
            raise ValueError("GitHub app token response missing token.")

        expires_at_raw = payload.get("expires_at")
        if isinstance(expires_at_raw, str):
            try:
                expires_at = datetime.fromisoformat(expires_at_raw.replace("Z", "+00:00"))
            except ValueError:
                expires_at = datetime.now(UTC) + timedelta(minutes=50)
        else:
            expires_at = datetime.now(UTC) + timedelta(minutes=50)

        self.access_token = token
        self.token_expires_at = expires_at
        return token

    def _get_headers(self) -> dict[str, str]:
        if self.github_token:
            return {
                "Authorization": f"token {self.github_token}",
                "Accept": "application/vnd.github+json",
            }

        if self._can_use_app_auth():
            token = self._get_installation_token()
            return {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

        return {"Accept": "application/vnd.github+json"}

    def get_repo_metadata(self, username: str, repo: str) -> tuple[str, bool, int | None]:
        data = _fetch_json(
            f"https://api.github.com/repos/{username}/{repo}",
            self._get_headers(),
            "Repository not found.",
        )
        stargazer_count = data.get("stargazers_count")
        if not isinstance(stargazer_count, int):
            stargazer_count = None
        return data.get("default_branch") or "main", bool(data.get("private")), stargazer_count

    def get_github_file_paths_as_list(self, username: str, repo: str, branch: str) -> str:
        data = _fetch_json(
            f"https://api.github.com/repos/{username}/{repo}/git/trees/{branch}?recursive=1",
            self._get_headers(),
            "Could not fetch repository file tree.",
        )
        paths = [
            item.get("path")
            for item in (data.get("tree") or [])
            if isinstance(item.get("path"), str) and _should_include_file(item["path"])
        ]
        if not paths:
            raise ValueError(
                "Could not fetch repository file tree. Repository might be empty or inaccessible."
            )
        return "\n".join(paths)

    def get_github_readme(self, username: str, repo: str) -> str:
        data = _fetch_json(
            f"https://api.github.com/repos/{username}/{repo}/readme",
            self._get_headers(),
            "No README found for the specified repository.",
        )
        content = data.get("content")
        if not isinstance(content, str) or not content:
            raise ValueError("No README found for the specified repository.")

        encoding = data.get("encoding")
        if encoding == "base64":
            return base64.b64decode(content).decode("utf-8")
        return content

    def get_github_data(self, username: str, repo: str) -> GithubData:
        default_branch, is_private, stargazer_count = self.get_repo_metadata(username, repo)
        file_tree = self.get_github_file_paths_as_list(username, repo, default_branch)
        readme = self.get_github_readme(username, repo)
        return GithubData(
            default_branch=default_branch,
            file_tree=file_tree,
            readme=readme,
            is_private=is_private,
            stargazer_count=stargazer_count,
        )
