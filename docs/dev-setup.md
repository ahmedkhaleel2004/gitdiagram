# Local development setup

GitDiagram is one Next.js application. The UI and generation API run together; no second backend process is required.

## Prerequisites

- Node.js 22: `22.12` or newer for Next.js and the tooling, and `22.22.2` or newer to run the tests (jsdom 30). CI and Vercel use Node 22 (`engines.node`); Node `24.15` or newer also works locally.
- Bun `1.3.14`, the version pinned in `packageManager`, CI and the `Dockerfile`. Do not move to Bun 1.4 yet: it rewrites `bun.lock`.

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

`bun install` also turns on the versioned git hooks in `.githooks/` (the `prepare` script sets `core.hooksPath`). The pre-push hook runs the fast CI checks (formatting, lint, typecheck and knip) in a few seconds, because Vercel deploys every push to `main` even when CI fails. Skip it once with `git push --no-verify`.

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

Optional generation controls include:

- `OPENAI_MODEL`
- `OPENAI_COMPLIMENTARY_GATE_ENABLED`
- `OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS`
- `OPENAI_COMPLIMENTARY_MODEL_FAMILY`
- `OPENROUTER_MODEL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

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
bun run lint           # fails on any warning
bun run typecheck      # TypeScript 7; `next build` also checks with TypeScript 6
bun run format:check   # TS/JS/MDX, CSS, JSON and YAML
bun run knip           # unused files, exports and dependencies
bun audit
bun run test
bun run build
bun run check:video-tracing   # after build: MP4 render routes ship ffmpeg and Chromium
bun run perf:budget           # after build: route, chunk and video engine size budgets
```

This is the same sequence CI runs. `workers/presence` has its own lockfile and CI job; check it from that folder with `bun ci && bun run typecheck && bun audit`.

The test suite includes real Mermaid parser contract tests for the deterministic graph compiler, API route tests, cancellation and quota tests, storage concurrency tests, and browser-rendering safety tests.

## Troubleshooting

- **Typecheck or build fails on files under `.next/dev/types`.** `tsconfig.json` includes the route type validators that `next dev` generates there, and a stale copy from an older checkout can break `bun run typecheck` and `bun run build`. Delete it with `rm -rf .next/dev`; the next `bun run dev` regenerates it.
- **MP4 renders.** `puppeteer-core` is pinned to the release built for the Chromium major that `@sparticuz/chromium` ships (see `lib/puppeteer/revisions.js` in puppeteer-core). Bump the two together, only when a new `@sparticuz/chromium` major is out; until then, skip Dependabot's puppeteer-core bumps.

## Deploy

The primary deployment is Vercel with Bun as both the package manager and the server runtime for Route Handlers. The route-level `runtime = "nodejs"` declarations select Next.js's server runtime rather than Edge; the project-level `bunVersion` setting makes Vercel execute those Functions with Bun. Add the variables from `.env.example` to the Vercel project, then deploy:

```bash
vercel deploy
vercel deploy --prod
```

Local `.env` files and tooling artifacts are excluded by `.vercelignore`.

The same source can be redeployed to Railway later through `Dockerfile` and `railway.json`. Those files are an offline recovery recipe, not a live standby. The container uses Next.js standalone output, listens on Railway's injected `PORT`, runs as a non-root user, and checks `/api/healthz` before promotion. See [deployment-failover.md](deployment-failover.md) for the recovery procedure, including why the video gate and per-network limits must not be trusted outside Vercel.
