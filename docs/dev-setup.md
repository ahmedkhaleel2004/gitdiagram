# Local Development Setup

This project now runs generation through Next.js Route Handlers on Vercel.

Legacy FastAPI backend remains in `backend/` for reference/self-hosting.

## 1) Install tool versions

Recommended versions:
- Node.js: `22.x` (see `.nvmrc`)
- pnpm: `9.13.0`
- Python: `3.12.x` (only needed if you run legacy backend)
- uv: `0.5.24+` (only needed if you run legacy backend)
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
- Python starts with `3.12` (legacy backend only)

## 2) Install frontend dependencies

```bash
pnpm install
```

## 3) (Optional) Sync legacy backend dependencies with uv

```bash
cd backend
uv sync --no-install-project
cd ..
```

This creates `backend/.venv` and installs pinned Python dependencies from `backend/uv.lock`.
Skip this section if you are only running the Next.js backend.

## 4) Configure environment variables

```bash
cp .env.example .env
```

Then set at least:
- `POSTGRES_URL`
- `OPENAI_API_KEY`

Optional:
- `OPENAI_MODEL` (single model used for all generation stages)
- `GITHUB_PAT`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_USE_LEGACY_BACKEND=true` and `NEXT_PUBLIC_API_DEV_URL` (only if you want to call legacy backend instead of `/api/generate/*`)

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

Start frontend (includes Next.js API backend):

```bash
pnpm dev
```

Optional: run legacy backend for comparison/testing:

```bash
docker-compose up --build -d
docker-compose logs -f api
```

or

```bash
pnpm dev:backend
```

## 6) Verification commands

Run all baseline checks:

```bash
pnpm check
pnpm test
pnpm build
```

Legacy backend checks (optional):

```bash
cd backend
uv run pytest -q
uv run python -m compileall app
cd ..
```

If all pass, your local environment is ready.
