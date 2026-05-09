import subprocess

from app.services import mermaid_service


def test_mermaid_validation_times_out(monkeypatch):
    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=kwargs["timeout"])

    monkeypatch.setattr(mermaid_service.subprocess, "run", fake_run)

    result = mermaid_service.validate_mermaid_syntax("flowchart TD\nA-->B")

    assert result.valid is False
    assert "timed out" in (result.message or "")
