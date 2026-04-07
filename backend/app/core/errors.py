from __future__ import annotations


def api_success(**data):
    payload = {"ok": True}
    payload.update(data)
    return payload
