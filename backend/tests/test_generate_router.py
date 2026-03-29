import asyncio
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routers import generate
from app.services.complimentary_gate import ComplimentaryQuotaReservation
from app.services.mermaid_service import MermaidValidationResult
from app.services.pricing import GenerationTokenUsage

client = TestClient(app)


def parse_sse_payloads(response_text: str) -> list[dict]:
    payloads = []
    for block in response_text.split("\n\n"):
        if not block.startswith("data: "):
            continue
        payloads.append(json.loads(block[6:]))
    return payloads


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

    async def fake_estimate_generation_cost(**kwargs):
        return {
            "cost_summary": {"kind": "estimate", "display": "$0.01 USD"},
            "pricing": SimpleNamespace(input_per_million_usd=0.75, output_per_million_usd=4.5),
            "pricing_model": "gpt-5.4-mini",
            "estimated_input_tokens": 1000,
            "estimated_output_tokens": 10_000,
            "explanation_input_tokens": 1000,
            "graph_static_input_tokens": 200,
        }

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

    monkeypatch.setattr(generate, "estimate_generation_cost", fake_estimate_generation_cost)
    monkeypatch.setattr(generate, "should_apply_complimentary_gate", lambda **kwargs: False)
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(generate.openai_service, "generate_structured_output", fake_generate_structured_output)
    monkeypatch.setattr(
        generate,
        "validate_mermaid_syntax",
        lambda diagram: MermaidValidationResult(valid=True),
    )

    response = client.post("/generate/stream", json={"username": "acme", "repo": "demo"})

    assert response.status_code == 200
    payloads = parse_sse_payloads(response.text)
    events = [payload["status"] for payload in payloads if "status" in payload]

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


def test_generate_stream_blocks_when_daily_free_quota_is_exhausted(monkeypatch):
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
    monkeypatch.setattr(generate.diagram_state_repository, "is_configured", lambda: True)
    monkeypatch.setattr(generate.diagram_state_repository, "quota_is_configured", lambda: True)
    monkeypatch.setattr(
        generate.diagram_state_repository,
        "upsert_latest_session_audit",
        lambda username, repo, audit: None,
    )

    async def fake_estimate_generation_cost(**kwargs):
        return {
            "cost_summary": {"kind": "estimate", "display": "$0.01 USD"},
            "pricing": SimpleNamespace(input_per_million_usd=0.75, output_per_million_usd=4.5),
            "pricing_model": "gpt-5.4-mini",
            "estimated_input_tokens": 100,
            "estimated_output_tokens": 10_000,
            "explanation_input_tokens": 100,
            "graph_static_input_tokens": 200,
        }

    monkeypatch.setattr(generate, "estimate_generation_cost", fake_estimate_generation_cost)
    monkeypatch.setattr(generate, "should_apply_complimentary_gate", lambda **kwargs: True)
    monkeypatch.setattr(generate, "model_matches_complimentary_family", lambda model: True)
    monkeypatch.setattr(
        generate,
        "reserve_complimentary_quota",
        lambda **kwargs: (False, None, "2026-03-29T00:00:00+00:00"),
    )

    response = client.post("/generate/stream", json={"username": "acme", "repo": "demo"})

    assert response.status_code == 200
    payloads = parse_sse_payloads(response.text)
    assert payloads[-1]["status"] == "error"
    assert payloads[-1]["error_code"] == "DAILY_FREE_TOKEN_LIMIT_REACHED"
    assert payloads[-1]["quota_reset_at"] == "2026-03-29T00:00:00+00:00"


def test_generate_stream_bypasses_quota_gate_for_user_api_keys(monkeypatch):
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

    async def fake_estimate_generation_cost(**kwargs):
        return {
            "cost_summary": {"kind": "estimate", "display": "$0.01 USD"},
            "pricing": SimpleNamespace(input_per_million_usd=0.75, output_per_million_usd=4.5),
            "pricing_model": "gpt-5.4-mini",
            "estimated_input_tokens": 100,
            "estimated_output_tokens": 10_000,
            "explanation_input_tokens": 100,
            "graph_static_input_tokens": 200,
        }

    async def fake_stream_completion(**kwargs):
        async def generator():
            yield "<explanation>Repo explanation</explanation>"

        future = asyncio.get_running_loop().create_future()
        future.set_result(
            GenerationTokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        )
        return generator(), future

    async def fake_generate_structured_output(**kwargs):
        return (
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
            GenerationTokenUsage(input_tokens=60, output_tokens=30, total_tokens=90),
        )

    monkeypatch.setattr(generate, "estimate_generation_cost", fake_estimate_generation_cost)
    monkeypatch.setattr(
        generate,
        "should_apply_complimentary_gate",
        lambda **kwargs: not kwargs.get("api_key"),
    )
    monkeypatch.setattr(
        generate,
        "reserve_complimentary_quota",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("quota gate should be bypassed")),
    )
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(generate.openai_service, "generate_structured_output", fake_generate_structured_output)
    monkeypatch.setattr(
        generate,
        "validate_mermaid_syntax",
        lambda diagram: MermaidValidationResult(valid=True),
    )

    response = client.post(
        "/generate/stream",
        json={"username": "acme", "repo": "demo", "api_key": "sk-user"},
    )

    assert response.status_code == 200
    payloads = parse_sse_payloads(response.text)
    assert payloads[-1]["status"] == "complete"


def test_generate_stream_completes_without_storage_when_quota_gate_disabled(monkeypatch):
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
    monkeypatch.setattr(generate.diagram_state_repository, "is_configured", lambda: False)
    monkeypatch.setattr(
        generate.diagram_state_repository,
        "upsert_latest_session_audit",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("audit persistence should be skipped")),
    )
    monkeypatch.setattr(
        generate.diagram_state_repository,
        "save_successful_diagram_state",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("state persistence should be skipped")),
    )

    async def fake_estimate_generation_cost(**kwargs):
        return {
            "cost_summary": {"kind": "estimate", "display": "$0.01 USD"},
            "pricing": SimpleNamespace(input_per_million_usd=0.75, output_per_million_usd=4.5),
            "pricing_model": "gpt-5.4-mini",
            "estimated_input_tokens": 100,
            "estimated_output_tokens": 10_000,
            "explanation_input_tokens": 100,
            "graph_static_input_tokens": 200,
        }

    async def fake_stream_completion(**kwargs):
        async def generator():
            yield "<explanation>Repo explanation</explanation>"

        future = asyncio.get_running_loop().create_future()
        future.set_result(
            GenerationTokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        )
        return generator(), future

    async def fake_generate_structured_output(**kwargs):
        return (
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
            GenerationTokenUsage(input_tokens=60, output_tokens=30, total_tokens=90),
        )

    monkeypatch.setattr(generate, "estimate_generation_cost", fake_estimate_generation_cost)
    monkeypatch.setattr(generate, "should_apply_complimentary_gate", lambda **kwargs: False)
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(generate.openai_service, "generate_structured_output", fake_generate_structured_output)
    monkeypatch.setattr(
        generate,
        "validate_mermaid_syntax",
        lambda diagram: MermaidValidationResult(valid=True),
    )

    response = client.post("/generate/stream", json={"username": "acme", "repo": "demo"})

    assert response.status_code == 200
    payloads = parse_sse_payloads(response.text)
    assert payloads[-1]["status"] == "complete"


def test_generate_stream_errors_when_quota_gate_enabled_without_upstash(monkeypatch):
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
    monkeypatch.setattr(generate.diagram_state_repository, "quota_is_configured", lambda: False)
    monkeypatch.setattr(
        generate,
        "reserve_complimentary_quota",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("quota reservation should not run")),
    )

    async def fake_estimate_generation_cost(**kwargs):
        return {
            "cost_summary": {"kind": "estimate", "display": "$0.01 USD"},
            "pricing": SimpleNamespace(input_per_million_usd=0.75, output_per_million_usd=4.5),
            "pricing_model": "gpt-5.4-mini",
            "estimated_input_tokens": 100,
            "estimated_output_tokens": 10_000,
            "explanation_input_tokens": 100,
            "graph_static_input_tokens": 200,
        }

    monkeypatch.setattr(generate, "estimate_generation_cost", fake_estimate_generation_cost)
    monkeypatch.setattr(generate, "should_apply_complimentary_gate", lambda **kwargs: True)

    response = client.post("/generate/stream", json={"username": "acme", "repo": "demo"})

    assert response.status_code == 200
    payloads = parse_sse_payloads(response.text)
    assert payloads[-1]["status"] == "error"
    assert payloads[-1]["error_code"] == "COMPLIMENTARY_GATE_STORAGE_UNAVAILABLE"
    assert "Upstash Redis REST configuration" in payloads[-1]["error"]


def test_generate_stream_finalizes_quota_with_exact_usage(monkeypatch):
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
    monkeypatch.setattr(generate.diagram_state_repository, "is_configured", lambda: True)
    monkeypatch.setattr(generate.diagram_state_repository, "quota_is_configured", lambda: True)
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

    async def fake_estimate_generation_cost(**kwargs):
        return {
            "cost_summary": {"kind": "estimate", "display": "$0.01 USD"},
            "pricing": SimpleNamespace(input_per_million_usd=0.75, output_per_million_usd=4.5),
            "pricing_model": "gpt-5.4-mini",
            "estimated_input_tokens": 100,
            "estimated_output_tokens": 10_000,
            "explanation_input_tokens": 100,
            "graph_static_input_tokens": 200,
        }

    async def fake_stream_completion(**kwargs):
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

    finalized = {}

    async def fake_generate_structured_output(**kwargs):
        return next(graph_outputs)

    monkeypatch.setattr(generate, "estimate_generation_cost", fake_estimate_generation_cost)
    monkeypatch.setattr(generate, "should_apply_complimentary_gate", lambda **kwargs: True)
    monkeypatch.setattr(generate, "model_matches_complimentary_family", lambda model: True)
    monkeypatch.setattr(
        generate,
        "reserve_complimentary_quota",
        lambda **kwargs: (
            True,
            ComplimentaryQuotaReservation(
                quota_bucket="openai:gpt-5.4-mini:complimentary",
                quota_date_utc="2026-03-28",
                quota_reset_at="2026-03-29T00:00:00+00:00",
                reserved_tokens=50_700,
            ),
            "2026-03-29T00:00:00+00:00",
        ),
    )
    monkeypatch.setattr(
        generate,
        "finalize_complimentary_quota",
        lambda **kwargs: finalized.update(kwargs),
    )
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(generate.openai_service, "generate_structured_output", fake_generate_structured_output)
    monkeypatch.setattr(
        generate,
        "validate_mermaid_syntax",
        lambda diagram: MermaidValidationResult(valid=True),
    )

    response = client.post("/generate/stream", json={"username": "acme", "repo": "demo"})

    assert response.status_code == 200
    payloads = parse_sse_payloads(response.text)
    assert payloads[-1]["status"] == "complete"
    assert finalized["committed_tokens"] == 345


def test_generate_stream_finalizes_with_reserved_tokens_after_failure(monkeypatch):
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
    monkeypatch.setattr(generate.diagram_state_repository, "is_configured", lambda: True)
    monkeypatch.setattr(generate.diagram_state_repository, "quota_is_configured", lambda: True)
    monkeypatch.setattr(
        generate.diagram_state_repository,
        "upsert_latest_session_audit",
        lambda username, repo, audit: None,
    )

    async def fake_estimate_generation_cost(**kwargs):
        return {
            "cost_summary": {"kind": "estimate", "display": "$0.01 USD"},
            "pricing": SimpleNamespace(input_per_million_usd=0.75, output_per_million_usd=4.5),
            "pricing_model": "gpt-5.4-mini",
            "estimated_input_tokens": 100,
            "estimated_output_tokens": 10_000,
            "explanation_input_tokens": 100,
            "graph_static_input_tokens": 200,
        }

    async def fake_stream_completion(**kwargs):
        async def generator():
            yield "<explanation>Repo explanation</explanation>"

        future = asyncio.get_running_loop().create_future()
        future.set_result(
            GenerationTokenUsage(input_tokens=100, output_tokens=50, total_tokens=150)
        )
        return generator(), future

    finalized = {}

    async def fake_generate_structured_output(**kwargs):
        raise RuntimeError("graph planning blew up")

    monkeypatch.setattr(generate, "estimate_generation_cost", fake_estimate_generation_cost)
    monkeypatch.setattr(generate, "should_apply_complimentary_gate", lambda **kwargs: True)
    monkeypatch.setattr(generate, "model_matches_complimentary_family", lambda model: True)
    monkeypatch.setattr(
        generate,
        "reserve_complimentary_quota",
        lambda **kwargs: (
            True,
            ComplimentaryQuotaReservation(
                quota_bucket="openai:gpt-5.4-mini:complimentary",
                quota_date_utc="2026-03-28",
                quota_reset_at="2026-03-29T00:00:00+00:00",
                reserved_tokens=50_700,
            ),
            "2026-03-29T00:00:00+00:00",
        ),
    )
    monkeypatch.setattr(
        generate,
        "finalize_complimentary_quota",
        lambda **kwargs: finalized.update(kwargs),
    )
    monkeypatch.setattr(generate.openai_service, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(generate.openai_service, "generate_structured_output", fake_generate_structured_output)

    response = client.post("/generate/stream", json={"username": "acme", "repo": "demo"})

    assert response.status_code == 200
    payloads = parse_sse_payloads(response.text)
    assert payloads[-1]["status"] == "error"
    assert payloads[-1]["error_code"] == "STREAM_FAILED"
    assert finalized["committed_tokens"] == 50_700


def test_modify_route_removed():
    response = client.post("/modify", json={})
    assert response.status_code == 404
