from __future__ import annotations

import json
import logging
import time


logger = logging.getLogger("gitdiagram.api")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def log_event(event: str, **fields):
    logger.info(
        json.dumps(
            {
                "event": event,
                **fields,
            },
            default=str,
        )
    )


class Timer:
    def __init__(self):
        self.start = time.perf_counter()

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self.start) * 1000)
