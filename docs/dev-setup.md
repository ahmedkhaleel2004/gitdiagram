# Local Development Setup

This project has two runtimes:
- Frontend: Next.js + TypeScript
- Backend: FastAPI (Python)

## 1) Install tool versions

Recommended versions:
- Node.js: `22.x` (see `.nvmrc`)
- pnpm: `9.13.0`
- Python: `3.12.x` (see `backend/.python-version`)
- uv: `0.5.24+`
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
- `GITHUB_PAT`
- `NEXT_PUBLIC_POSTHOG_KEY`

## 5) Start local services

Start backend API (Docker):

```bash
docker-compose up --build -d
docker-compose logs -f
```

Or run backend directly (no Docker):

```bash
pnpm dev:backend
```

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

## 6) Verification commands

Run all baseline checks:

```bash
pnpm check
pnpm test
pnpm build
cd backend
uv run pytest -q
uv run python -m compileall app
cd ..
```

If all pass, your local environment is ready.
