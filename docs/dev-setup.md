# Local Development Setup

This project supports two explicit generation backends:
- FastAPI in `backend/` (recommended for production and Railway parity)
- Next.js Route Handlers under `/api/generate/*`

## 1) Install tool versions

Recommended versions:
- Node.js: `22.x` (see `.nvmrc`)
- pnpm: `9.13.0`
- Python: `3.12.x` (required for FastAPI backend work)
- uv: `0.5.24+` (required for FastAPI backend work)
- Docker: latest stable

Install/check:

```bash
node -v
pnpm -v
python3 --version
uv --version
docker --version
```

Expected:
- Node starts with `v22`
- pnpm prints `9.13.0` (or compatible in the same series)
- Python starts with `3.12`

## 2) Install frontend dependencies

```bash
pnpm install
```

## 3) Sync backend dependencies with uv

```bash
cd backend
uv sync --no-install-project
cd ..
```

This creates `backend/.venv` and installs pinned Python dependencies from `backend/uv.lock`.

The FastAPI backend also invokes `backend/scripts/validate_mermaid.mjs`, so the backend runtime depends on Node being available in addition to Python.

## 4) Configure environment variables

```bash
cp .env.example .env
```

Then set at least:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BUCKET`
- `R2_PRIVATE_BUCKET`
- `CACHE_KEY_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `AI_PROVIDER`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`

Optional:
- `OPENAI_MODEL` when `AI_PROVIDER=openai` (defaults to `gpt-5.4-mini`)
- `OPENAI_COMPLIMENTARY_GATE_ENABLED` to hard-stop default-key OpenAI mini usage at the configured daily free-token ceiling
- `OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS` when the complimentary gate is enabled (defaults to `10000000`)
- `OPENAI_COMPLIMENTARY_MODEL_FAMILY` when the complimentary gate is enabled (defaults to `gpt-5.4-mini`)
- `OPENROUTER_MODEL` when `AI_PROVIDER=openrouter` (defaults to `openai/gpt-5.4`)
- `OPENROUTER_SITE_URL` and `OPENROUTER_APP_NAME` for OpenRouter attribution headers
- `GITHUB_PAT`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_GENERATION_BACKEND`
- `NEXT_PUBLIC_GENERATE_API_BASE_URL` when `NEXT_PUBLIC_GENERATION_BACKEND=fastapi`

Example OpenRouter local config:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-5.4
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=GitDiagram
```

## 5) Start local services

Simplest local mode:

```bash
pnpm dev
```

with:
- `NEXT_PUBLIC_GENERATION_BACKEND=next`

Production-parity mode:

```bash
pnpm dev
```

Start FastAPI backend (recommended for production parity):

```bash
docker-compose up --build -d
docker-compose logs -f api
```

or

```bash
pnpm dev:backend
```

If the FastAPI backend is running locally at `http://localhost:8000`, set:
- `NEXT_PUBLIC_GENERATION_BACKEND=fastapi`
- `NEXT_PUBLIC_GENERATE_API_BASE_URL=http://localhost:8000/generate`

If you want to use the Next.js Route Handlers instead, set:
- `NEXT_PUBLIC_GENERATION_BACKEND=next`

## 6) Verification commands

Run all baseline checks:

```bash
pnpm check
pnpm test
pnpm build
```

FastAPI backend checks:

```bash
cd backend
uv run pytest -q
uv run python -m compileall app
cd ..
```

If all pass, your local environment is ready.
