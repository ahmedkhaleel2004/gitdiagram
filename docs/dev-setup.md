# Local Development Setup

This project runs generation primarily through the FastAPI backend in `backend/` (Railway in production).

Next.js Route Handlers under `/api/generate/*` remain available as an optional fallback path.

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

## 4) Configure environment variables

```bash
cp .env.example .env
```

Then set at least:
- `POSTGRES_URL`
- `OPENAI_API_KEY`

Optional:
- `OPENAI_MODEL` (single model used for all generation stages, defaults to `gpt-5.4-mini`)
- `GITHUB_PAT`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_USE_LEGACY_BACKEND=true` and `NEXT_PUBLIC_API_DEV_URL` (to route frontend calls to an external backend such as Railway/local FastAPI)

## 5) Start local services

Start local Postgres (if using local DB URL):

```bash
chmod +x start-database.sh
./start-database.sh
```

Push schema:

```bash
pnpm db:push
```

Start frontend:

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
- `NEXT_PUBLIC_USE_LEGACY_BACKEND=true`
- `NEXT_PUBLIC_API_DEV_URL=http://localhost:8000`

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
