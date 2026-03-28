import asyncio
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routers import generate
from app.services.mermaid_service import MermaidValidationResult
from app.services.pricing import GenerationTokenUsage

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
    monkeypatch.setattr(generate, "get_provider", lambda: "openai")
    monkeypatch.setattr(generate, "get_model", lambda provider=None: "gpt-5.4-mini")

    async def fake_count_input_tokens(
        *,
        provider,
        model,
        system_prompt,
        data,
        api_key=None,
        reasoning_effort=None,
    ):
        assert provider == "openai"
        return 100

    monkeypatch.setattr(generate.openai_service, "count_input_tokens", fake_count_input_tokens)

    response = client.post("/generate/cost", json={"username": "acme", "repo": "demo"})

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["model"] == "gpt-5.4-mini"
    assert data["pricing_model"] == "gpt-5.4-mini"
    assert data["cost_summary"]["kind"] == "estimate"
    assert data["cost"] == data["cost_summary"]["display"]


def test_generate_stream_retries_invalid_graph_once(monkeypatch):
    monkeypatch.setattr(
        generate,
        "_get_github_data",
        lambda username, repo, github_pat=None: SimpleNamespace(
            default_branch="main",
            file_tree="src/main.py",
            readme="# readme",
        ),
    )
    monkeypatch.setattr(generate, "get_provider", lambda: "openai")
    monkeypatch.setattr(generate, "get_model", lambda provider=None: "gpt-5.4-mini")
    monkeypatch.setattr(
        generate.diagram_state_repository,
        "upsert_latest_session_audit",
        lambda username, repo, audit: None,
    )
    monkeypatch.setattr(
        generate.diagram_state_repository,
        "save_successful_diagram_state",
        lambda **kwargs: None,
    )

    async def fake_estimate_repo_input_tokens(provider, model, file_tree, readme, api_key=None):
        assert provider == "openai"
        return 1000

    async def fake_stream_completion(
        *,
        provider,
        model,
        system_prompt,
        data,
        api_key=None,
        reasoning_effort=None,
        max_output_tokens=None,
    ):
        assert "explain its architecture clearly" in system_prompt

        async def generator():
            yield "<explanation>Repo explanation</explanation>"

        future = asyncio.get_running_loop().create_future()
        future.set_result(
            GenerationTokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        )
        return generator(), future

    graph_outputs = iter(
        [
            (
                generate.DiagramGraph.model_validate(
                    {
                        "groups": [],
                        "nodes": [{
                            "id": "api",
                            "label": "API",
                            "type": "service",
                            "description": None,
                            "groupId": None,
                            "path": "missing.py",
                            "shape": None,
                        }],
                        "edges": [],
                    }
                ),
                '{"groups":[],"nodes":[{"id":"api","label":"API","type":"service","path":"missing.py"}],"edges":[]}',
                GenerationTokenUsage(input_tokens=60, output_tokens=30, total_tokens=90),
            ),
            (
                generate.DiagramGraph.model_validate(
                    {
                        "groups": [],
                        "nodes": [{
                            "id": "api",
                            "label": "API",
                            "type": "service",
                            "description": None,
                            "groupId": None,
                            "path": "src/main.py",
                            "shape": None,
                        }],
                        "edges": [],
                    }
                ),
                '{"groups":[],"nodes":[{"id":"api","label":"API","type":"service","path":"src/main.py"}],"edges":[]}',
                GenerationTokenUsage(input_tokens=70, output_tokens=35, total_tokens=105),
            ),
        ]
    )

    async def fake_generate_structured_output(**kwargs):
        return next(graph_outputs)

    monkeypatch.setattr(generate, "_estimate_repo_input_tokens", fake_estimate_repo_input_tokens)
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(generate.openai_service, "generate_structured_output", fake_generate_structured_output)
    monkeypatch.setattr(
        generate,
        "validate_mermaid_syntax",
        lambda diagram: MermaidValidationResult(valid=True),
    )

    response = client.post("/generate/stream", json={"username": "acme", "repo": "demo"})

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
    assert "graph_sent" in events
    assert "graph" in events
    assert "graph_retry" in events
    assert "graph_validating" in events
    assert "diagram_compiling" in events
    assert events[-1] == "complete"
    assert payloads[-1]["graph"]["nodes"][0]["path"] == "src/main.py"
    assert payloads[0]["cost_summary"]["kind"] == "estimate"
    assert payloads[-1]["cost_summary"]["kind"] == "actual"


def test_modify_route_removed():
    response = client.post("/modify", json={})
    assert response.status_code == 404
