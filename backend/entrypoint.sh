#!/bin/bash

set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-production}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
WEB_CONCURRENCY="${WEB_CONCURRENCY:-2}"

echo "Current ENVIRONMENT: ${ENVIRONMENT}"
echo "Binding to ${HOST}:${PORT}"

if [ "${ENVIRONMENT}" = "development" ]; then
    echo "Starting in development mode with hot reload..."
    exec uv run --no-dev uvicorn app.main:app --host "${HOST}" --port "${PORT}" --reload
fi

echo "Starting in production mode..."
exec uv run --no-dev uvicorn app.main:app \
    --host "${HOST}" \
    --port "${PORT}" \
    --timeout-keep-alive 300 \
    --workers "${WEB_CONCURRENCY}" \
    --loop uvloop \
    --http httptools
