from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass


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
        proc = subprocess.run(
            ["bun", "scripts/validate_mermaid.mjs"],
            input=diagram,
            text=True,
            capture_output=True,
            check=False,
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


def format_validation_feedback(result: MermaidValidationResult) -> str:
    if result.valid:
        return "No syntax errors found."

    details = [f"message: {result.message or 'unknown parse error'}"]
    if isinstance(result.line, int):
        details.append(f"line: {result.line}")
    if result.token:
        details.append(f"token: {result.token}")
    if result.expected:
        details.append(f"expected: {', '.join(result.expected)}")

    return "\n".join(details)
