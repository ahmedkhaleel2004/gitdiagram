from __future__ import annotations

import os

DEFAULT_MODEL = "gpt-5.4-mini"


def get_model() -> str:
    model = os.getenv("OPENAI_MODEL", "").strip()
    return model or DEFAULT_MODEL
