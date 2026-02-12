import json

from fastapi.testclient import TestClient

from app.main import app
from app.routers import generate

client = TestClient(app)


def test_healthz_ok():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "ok"}


def test_generate_cost_success(monkeypatch):
    def fake_cached_data(username, repo, github_pat=None):
        return {
            "default_branch": "main",
            "file_tree": "src/main.py",
            "readme": "# readme",
        }

    monkeypatch.setattr(generate, "get_cached_github_data", fake_cached_data)
    monkeypatch.setattr(generate.openai_service, "count_tokens", lambda _: 100)

    response = client.post(
        "/generate/cost",
        json={"username": "acme", "repo": "demo"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["cost"].endswith("USD")


def test_generate_cost_error(monkeypatch):
    def fail_cached_data(username, repo, github_pat=None):
        raise ValueError("repo not found")

    monkeypatch.setattr(generate, "get_cached_github_data", fail_cached_data)

    response = client.post(
        "/generate/cost",
        json={"username": "acme", "repo": "missing"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["error_code"] == "COST_ESTIMATION_FAILED"


def test_generate_stream_event_order(monkeypatch):
    def fake_cached_data(username, repo, github_pat=None):
        return {
            "default_branch": "main",
            "file_tree": "src/main.py",
            "readme": "# readme",
        }

    async def fake_stream_completion(*, model, system_prompt, data, api_key=None, reasoning_effort=None):
        if "explaining to a principal" in system_prompt:
            yield "<explanation>Repo explanation</explanation>"
            return
        if "mapping key components" in system_prompt:
            yield "<component_mapping>"
            yield "1. API: src/main.py"
            yield "</component_mapping>"
            return
        yield 'flowchart TD\nA["API"] --> B["Worker"]\nclick A "src/main.py"'

    monkeypatch.setattr(generate, "get_cached_github_data", fake_cached_data)
    monkeypatch.setattr(generate.openai_service, "count_tokens", lambda _: 1000)
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)

    response = client.post(
        "/generate/stream",
        json={"username": "acme", "repo": "demo"},
    )

    assert response.status_code == 200
    events = []
    for block in response.text.split("\n\n"):
        if not block.startswith("data: "):
            continue
        payload = json.loads(block[6:])
        if "status" in payload:
            events.append(payload["status"])

    assert "started" in events
    assert "explanation_sent" in events
    assert "mapping_sent" in events
    assert "diagram_sent" in events
    assert events[-1] == "complete"


def test_modify_route_removed():
    response = client.post("/modify", json={})
    assert response.status_code == 404
