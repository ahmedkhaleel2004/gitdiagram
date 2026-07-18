# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GitDiagram turns a GitHub repository into an interactive Mermaid architecture diagram. It is **one Next.js 16 App Router application** (React 19, TypeScript, Tailwind 4, Bun runtime). There is no separate backend — the generation API lives in Next.js Route Handlers under `src/app/api/`. Vercel is the only live deployment; the `Dockerfile` and `railway.json` are a dormant Railway disaster-recovery recipe, not a live standby.

## Commands

Bun is the package manager and runtime (`bun install`; `bun ci` for frozen lockfile).

```bash
bun run dev            # dev server (Turbopack) at localhost:3000
bun run test           # all tests (vitest run)
bun run test src/server/generate/graph.test.ts   # single test file
bun run test:watch     # vitest watch mode
bun run lint           # eslint
bun run typecheck      # tsc --noEmit
bun run check          # lint + typecheck
bun run build          # production build
```

Full pre-PR gate: `bun run lint && bun run typecheck && bun run test && bun run build`.

Vitest runs two projects (see `vitest.config.ts`): **server** (`node` env: `src/server/**`, `src/app/api/**`) and **client** (`jsdom` env with testing-library: everything else). Tests are colocated `*.test.ts(x)` files. Path alias `~` → `src/`.

## Architecture

### Generation pipeline (the core of the app)

`/api/generate/stream` (`src/app/api/generate/stream/route.ts`, `runtime = "nodejs"`, `maxDuration = 300`) streams SSE through this pipeline, mostly in `src/server/generate/`:

1. **Ingestion** (`github.ts`) — fetch default branch, recursive tree, README via GitHub API; reject truncated/oversized input before any model call.
2. **Explanation stage** — streams a plain-English architecture explanation.
3. **Graph stage** (`graph-planner.ts`, `openai.ts`) — model returns a strict, size-bounded graph AST (groups/nodes/edges/labels/paths), validated by `graph.ts` (identifiers, connectivity, limits, every linked path checked against the real repo tree). Invalid output is retried with focused feedback up to `MAX_GRAPH_ATTEMPTS`.
4. **Compilation** (`mermaid.ts`) — deterministic AST→Mermaid compiler with total text escaping and GitHub-only links. The full Mermaid parser is intentionally **test-only** (`mermaid.test.ts` contract tests) to keep the server bundle small — do not import it into production code.
5. **Client rendering** (`src/components/mermaid-diagram.tsx`, `src/features/diagram/mermaid-security.ts`) — sanitize source, render Mermaid in strict security mode, sanitize resulting SVG, re-enforce the link allowlist.

Other routes: `/api/generate/cost` (pre-run estimate), `/api/generate/cancel` (distributed cancellation via Redis), `/api/diagram-state` (persisted result contract), `/api/healthz`.

`generation-policy.ts` centralizes model/token/effort constants; `model-config.ts` selects the provider (`AI_PROVIDER` = openai | openrouter | atlas — all via the OpenAI SDK); `pricing.ts` + `complimentary-gate.ts` handle cost accounting and the free-tier daily token gate.

### Layering

- `src/server/` — server-only code (imports `server-only`): generation pipeline, GitHub auth (`github-auth.ts` supports single PAT, PAT pool, or GitHub App), storage, HTTP guards, OG image generation.
- `src/server/http/` — `same-origin.ts` / `same-origin-json.ts` / `request-credentials.ts`: mutating API routes require same-origin requests; user GitHub tokens travel per-request and are never persisted server-side.
- `src/server/storage/` — R2 (`r2.ts`, `artifact-store.ts`) for diagram artifacts, with a **separate private namespace derived from `CACHE_KEY_SECRET`** for private repos (`cache-key.ts`); Upstash Redis (`upstash.ts`) for quota (`quota-store.ts`), cancellation, short-lived failure state (`status-store.ts`), and `distributed-lock.ts` (newest-session-wins persistence in `generation-persistence.ts`).
- `src/features/` — client/shared domain logic per feature (diagram SSE parsing, export, github-url parsing, credentials, browse catalog). The graph AST schema/types in `src/features/diagram/graph.ts` are shared between server validation and client.
- `src/hooks/useDiagram.ts` + `src/hooks/diagram/` — orchestrate the client generation lifecycle (cost check → stream → render → persist).
- `src/app/[username]/[repo]/` — the diagram page; also `/browse`, `/recent`, `/preview`, `/sponsor`.

### Environment

Copy `.env.example` → `.env`. Minimum to run generation locally: R2 vars, `CACHE_KEY_SECRET`, Upstash vars, and one AI provider key. See `docs/dev-setup.md` for the full list.

## Conventions

- Prettier with `prettier-plugin-tailwindcss` (`bun run format:write`); ESLint 9 flat config (`eslint.config.mjs`).
- Server code must not leak into client bundles — keep it under `src/server/` behind `server-only`.
- Diagram output safety is defense-in-depth (server validation → deterministic compiler → client sanitization); changes to any layer should keep the others intact and are covered by `mermaid-security.test.ts` and the compiler contract tests.
