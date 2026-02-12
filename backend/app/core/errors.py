from __future__ import annotations


def api_error(code: str, message: str, **extra):
    payload = {
        "ok": False,
        "error": message,
        "error_code": code,
    }
    payload.update(extra)
    return payload


def api_success(**data):
    payload = {"ok": True}
    payload.update(data)
    return payload
