# Local development setup

GitDiagram is one Next.js application. The UI and generation API run together; no second backend process is required.

## Prerequisites

- Node.js `20.9.0` or newer, as required by Next.js 16
- Bun `1.3.11` or a compatible `1.3.x`

```bash
node --version
bun --version
```

## Install

```bash
bun install
cp .env.example .env
```

Use `bun ci` when you want an exact frozen-lockfile install, such as in CI.

## Configure

Set these storage and coordination variables in `.env`:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BUCKET`
- `R2_PRIVATE_BUCKET`
- `CACHE_KEY_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Choose one AI provider:

- OpenAI: `AI_PROVIDER=openai` and `OPENAI_API_KEY`
- OpenRouter: `AI_PROVIDER=openrouter` and `OPENROUTER_API_KEY`
- Atlas Cloud: `AI_PROVIDER=atlas` and `ATLAS_API_KEY`

Optional generation controls include:

- `OPENAI_MODEL`
- `OPENAI_COMPLIMENTARY_GATE_ENABLED`
- `OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS`
- `OPENAI_COMPLIMENTARY_MODEL_FAMILY`
- `OPENROUTER_MODEL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `ATLAS_MODEL`
- `ATLAS_BASE_URL`

Optional GitHub authentication:

- `GITHUB_PAT` for one token
- `GITHUB_PATS` for a comma- or newline-separated token pool
- `GITHUB_APP_ID` or `GITHUB_CLIENT_ID`, plus `GITHUB_PRIVATE_KEY` and `GITHUB_INSTALLATION_ID`, for GitHub App authentication

Optional browser analytics:

- `NEXT_PUBLIC_POSTHOG_KEY`

The default OpenAI configuration is:

```dotenv
AI_PROVIDER=openai
OPENAI_MODEL=gpt-5.6-terra
```

An OpenRouter example:

```dotenv
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-5.6-terra
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=GitDiagram
```

## Run

```bash
bun run dev
```

The application is available at [http://localhost:3000](http://localhost:3000). Next.js Route Handlers under `/api/generate/*` run in the same process.

For a production-mode local check:

```bash
bun run build
bun run start
```

## Verify

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

The test suite includes real Mermaid parser contract tests for the deterministic graph compiler, API route tests, cancellation and quota tests, storage concurrency tests, and browser-rendering safety tests.

## Deploy

The primary deployment is Vercel with Bun as both the package manager and the server runtime for Route Handlers. The route-level `runtime = "nodejs"` declarations select Next.js's server runtime rather than Edge; the project-level `bunVersion` setting makes Vercel execute those Functions with Bun. Add the variables from `.env.example` to the Vercel project, then deploy:

```bash
vercel deploy
vercel deploy --prod
```

Local `.env` files and tooling artifacts are excluded by `.vercelignore`.

The same source can be redeployed to Railway later through `Dockerfile` and `railway.json`. Those files are an offline recovery recipe, not a live standby. The container uses Next.js standalone output, listens on Railway's injected `PORT`, runs as a non-root user, and checks `/api/healthz` before promotion. See [deployment-failover.md](deployment-failover.md) for the recovery procedure.
