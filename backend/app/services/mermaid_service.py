from __future__ import annotations

import json
import subprocess
import threading
from dataclasses import dataclass

MERMAID_VALIDATION_TIMEOUT_SECONDS = 15
_MERMAID_VALIDATION_SEMAPHORE = threading.BoundedSemaphore(value=1)


@dataclass(frozen=True)
class MermaidValidationResult:
    valid: bool
    message: str | None = None
    line: int | None = None
    token: str | None = None
    expected: list[str] | None = None


def normalize_parser_message(message: str | None) -> str:
    if not message:
        return "Mermaid syntax is invalid and could not be parsed."

    if "sanitize is not a function" in message or "__TURBOPACK__imported__module" in message:
        return "Mermaid parser runtime failed in server context (sanitizer issue)."

    return message


def validate_mermaid_syntax(diagram: str) -> MermaidValidationResult:
    try:
        with _MERMAID_VALIDATION_SEMAPHORE:
            proc = subprocess.run(
                ["bun", "scripts/validate_mermaid.mjs"],
                input=diagram,
                text=True,
                capture_output=True,
                check=False,
                timeout=MERMAID_VALIDATION_TIMEOUT_SECONDS,
            )
    except subprocess.TimeoutExpired:
        return MermaidValidationResult(
            valid=False,
            message=normalize_parser_message(
                f"Mermaid validation timed out after {MERMAID_VALIDATION_TIMEOUT_SECONDS} seconds.",
            ),
        )
    except Exception as exc:
        return MermaidValidationResult(
            valid=False,
            message=normalize_parser_message(str(exc)),
        )

    if proc.returncode != 0:
        message = proc.stderr.strip() or proc.stdout.strip() or "Mermaid validation failed."
        return MermaidValidationResult(valid=False, message=normalize_parser_message(message))

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return MermaidValidationResult(
            valid=False,
            message=normalize_parser_message("Mermaid validator returned invalid JSON."),
        )

    valid = bool(payload.get("valid"))
    message = payload.get("message")
    normalized_message = (
        normalize_parser_message(message)
        if not valid
        else (message if isinstance(message, str) else None)
    )

    return MermaidValidationResult(
        valid=valid,
        message=normalized_message,
        line=payload.get("line"),
        token=payload.get("token"),
        expected=payload.get("expected"),
    )
