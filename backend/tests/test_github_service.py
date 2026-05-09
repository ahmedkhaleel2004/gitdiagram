import pytest

from app.services import github_service
from app.services.github_service import GitHubService


def test_github_service_rejects_truncated_recursive_tree(monkeypatch):
    service = GitHubService()
    monkeypatch.setattr(service, "_get_headers", lambda: {})

    def fake_fetch_json(url, headers, not_found_message):
        if url.endswith("/repos/acme/demo"):
            return {"default_branch": "main", "private": False, "stargazers_count": 42}
        if "/git/trees/" in url:
            return {"truncated": True, "tree": [{"path": "src/main.py"}]}
        raise AssertionError("README should not be fetched for truncated trees")

    monkeypatch.setattr(github_service, "_fetch_json", fake_fetch_json)

    with pytest.raises(ValueError, match="Repository is too large"):
        service.get_github_data("acme", "demo")


def test_github_service_rejects_oversized_file_tree_before_readme(monkeypatch):
    service = GitHubService()
    monkeypatch.setattr(service, "_get_headers", lambda: {})
    monkeypatch.setattr(github_service, "MAX_INCLUDED_FILE_TREE_CHARACTERS", 10)

    def fake_fetch_json(url, headers, not_found_message):
        if url.endswith("/repos/acme/demo"):
            return {"default_branch": "main", "private": False, "stargazers_count": 42}
        if "/git/trees/" in url:
            return {
                "truncated": False,
                "tree": [{"path": "src/main.py"}, {"path": "src/other.py"}],
            }
        raise AssertionError("README should not be fetched after oversized tree")

    monkeypatch.setattr(github_service, "_fetch_json", fake_fetch_json)

    with pytest.raises(ValueError, match="Repository is too large"):
        service.get_github_data("acme", "demo")


def test_github_service_rejects_oversized_readme_metadata(monkeypatch):
    service = GitHubService()
    monkeypatch.setattr(service, "_get_headers", lambda: {})
    monkeypatch.setattr(github_service, "MAX_README_BYTES", 10)

    def fake_fetch_json(url, headers, not_found_message):
        if url.endswith("/repos/acme/demo"):
            return {"default_branch": "main", "private": False, "stargazers_count": 42}
        if "/git/trees/" in url:
            return {"truncated": False, "tree": [{"path": "src/main.py"}]}
        if url.endswith("/readme"):
            return {"size": 11, "content": "IyByZWFkbWU=", "encoding": "base64"}
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(github_service, "_fetch_json", fake_fetch_json)

    with pytest.raises(ValueError, match="Repository is too large"):
        service.get_github_data("acme", "demo")
