import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routers import generate
from app.services.mermaid_service import MermaidValidationResult

client = TestClient(app)


def test_healthz_ok():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "ok"}


def test_generate_cost_success(monkeypatch):
    monkeypatch.setattr(
        generate,
        "_get_github_data",
        lambda username, repo, github_pat=None: SimpleNamespace(
            default_branch="main",
            file_tree="src/main.py",
            readme="# readme",
        ),
    )
    monkeypatch.setattr(generate, "get_model", lambda: "gpt-5-mini")

    async def fake_count_input_tokens(*, model, system_prompt, data, api_key=None, reasoning_effort=None):
        return 100

    monkeypatch.setattr(generate.openai_service, "count_input_tokens", fake_count_input_tokens)

    response = client.post(
        "/generate/cost",
        json={"username": "acme", "repo": "demo"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["cost"].endswith("USD")
    assert data["model"] == "gpt-5-mini"
    assert data["pricing_model"] == "gpt-5-mini"
    assert "estimated_input_tokens" in data
    assert "estimated_output_tokens" in data


def test_generate_cost_error(monkeypatch):
    def fail_github_data(username, repo, github_pat=None):
        raise ValueError("repo not found")

    monkeypatch.setattr(generate, "_get_github_data", fail_github_data)

    response = client.post(
        "/generate/cost",
        json={"username": "acme", "repo": "missing"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False
    assert data["error_code"] == "COST_ESTIMATION_FAILED"


def test_generate_stream_event_order_with_fix_loop(monkeypatch):
    monkeypatch.setattr(
        generate,
        "_get_github_data",
        lambda username, repo, github_pat=None: SimpleNamespace(
            default_branch="main",
            file_tree="src/main.py",
            readme="# readme",
        ),
    )
    monkeypatch.setattr(generate, "get_model", lambda: "gpt-5-mini")

    async def fake_estimate_repo_input_tokens(model, file_tree, readme, api_key=None):
        return 1000

    async def fake_stream_completion(*, model, system_prompt, data, api_key=None, reasoning_effort=None, max_output_tokens=None):
        if "explaining to a principal" in system_prompt:
            yield "<explanation>Repo explanation</explanation>"
            return
        if "mapping key components" in system_prompt:
            yield "<component_mapping>"
            yield "1. API: src/main.py"
            yield "</component_mapping>"
            return
        if "syntax repair specialist" in system_prompt:
            yield 'flowchart TD\nA["API"] --> B["Worker"]\nclick A "src/main.py"'
            return
        yield 'flowchart TD\nA["API"] --> B["Worker"]\nclick A "src/main.py"'

    validation_results = iter(
        [
            MermaidValidationResult(valid=False, message="bad syntax"),
            MermaidValidationResult(valid=True),
        ]
    )

    monkeypatch.setattr(generate, "_estimate_repo_input_tokens", fake_estimate_repo_input_tokens)
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(generate, "validate_mermaid_syntax", lambda diagram: next(validation_results))

    response = client.post(
        "/generate/stream",
        json={"username": "acme", "repo": "demo"},
    )

    assert response.status_code == 200
    events = []
    payloads = []
    for block in response.text.split("\n\n"):
        if not block.startswith("data: "):
            continue
        payload = json.loads(block[6:])
        payloads.append(payload)
        if "status" in payload:
            events.append(payload["status"])

    assert "started" in events
    assert "explanation_sent" in events
    assert "mapping_sent" in events
    assert "diagram_sent" in events
    assert "diagram_fixing" in events
    assert "diagram_fix_attempt" in events
    assert "diagram_fix_validating" in events
    assert events[-1] == "complete"
    complete_payload = payloads[-1]
    assert complete_payload["status"] == "complete"
    assert "https://github.com/acme/demo/blob/main/src/main.py" in complete_payload["diagram"]


def test_modify_route_removed():
    response = client.post("/modify", json={})
    assert response.status_code == 404
