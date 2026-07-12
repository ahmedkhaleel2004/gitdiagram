import asyncio

from app.services import cost_estimator


def test_estimate_generation_cost_separates_first_pass_and_repair_inputs(monkeypatch):
    calls: list[dict] = []

    async def fake_count_input_tokens(**kwargs):
        calls.append(kwargs)
        data = kwargs["data"]
        if "readme" in data:
            return 100
        if "file_tree" in data:
            return 300
        return 200

    monkeypatch.setattr(
        cost_estimator.openai_service,
        "count_input_tokens",
        fake_count_input_tokens,
    )

    result = asyncio.run(
        cost_estimator.estimate_generation_cost(
            provider="openai",
            model="gpt-5.6-terra",
            file_tree="src/main.py\nsrc/worker.py",
            readme="# Demo",
            username="acme",
            repo="demo",
            api_key="sk-user",
        )
    )

    assert result["explanation_input_tokens"] == 100
    assert result["graph_static_input_tokens"] == 200
    assert result["graph_repair_static_input_tokens"] == 300
    assert result["estimated_input_tokens"] == 6_300
    assert result["estimated_output_tokens"] == 12_000

    assert len(calls) == 3
    explanation_call = next(call for call in calls if "readme" in call["data"])
    first_graph_call = next(
        call
        for call in calls
        if "explanation" in call["data"] and "file_tree" not in call["data"]
    )
    repair_graph_call = next(
        call
        for call in calls
        if "explanation" in call["data"] and "file_tree" in call["data"]
    )

    assert explanation_call["reasoning_effort"] == "medium"
    assert first_graph_call["reasoning_effort"] == "low"
    assert repair_graph_call["reasoning_effort"] == "low"
    assert "repo_owner" not in first_graph_call["data"]
    assert "repo_name" not in first_graph_call["data"]
    assert set(first_graph_call["data"]) == {"explanation"}
    assert repair_graph_call["data"]["file_tree"] == "src/main.py\nsrc/worker.py"
