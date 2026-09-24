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
2. **Source context and explanation** (`repository-context.ts`, `source-context.ts`, `source-excerpt.ts`) — select at most 12 source blobs from the verified tree, fetch with a 12-second enrichment deadline, and bound excerpts to 48k characters. The server-funded OpenAI Luna configuration uses Terra for analysis when there are more than eight eligible implementation files; small repos, BYOK and custom model/provider configurations keep their configured model. Streams an evidence-grounded architecture explanation.
3. **Graph stage** (`graph-planner.ts`, `openai.ts`) — model returns a strict, size-bounded graph AST (groups/nodes/edges/labels/paths), validated by `graph.ts` (identifiers, edge endpoints, limits, every linked path checked against the real repo tree). Structural failures are retried with focused feedback up to `MAX_GRAPH_ATTEMPTS`; a graph whose *only* fault is unresolvable node paths is repaired in place instead (`stripUnknownNodePaths`), since a path only drives a node's GitHub link.
4. **Compilation** (`compileDiagramGraph` in `graph.ts`) — deterministic AST→Mermaid compiler with total text escaping and GitHub-only links. `mermaid.ts` is only a re-export of the JSDOM-backed parser in `mermaid-validator.ts`; that parser is intentionally **test-only** (`mermaid.test.ts` contract tests) to keep the server bundle small — do not import it into production code.
5. **Client rendering** (`src/components/mermaid-diagram.tsx`, `src/features/diagram/mermaid-security.ts`) — sanitize source, render Mermaid with `securityLevel: "antiscript"` and `htmlLabels: false`, sanitize the resulting SVG with DOMPurify, then re-enforce the GitHub-only link allowlist. (`strict` is not usable here: it disables the `click` directives the diagram depends on, so the allowlist enforcement is what carries that weight.)

Other routes: `/api/generate/cost` (pre-run estimate), `/api/generate/cancel` (distributed cancellation via Redis), `/api/diagram-state` (persisted result contract), `/api/healthz`.

`generation-policy.ts` centralizes model/token/effort constants; `model-config.ts` selects the provider (`AI_PROVIDER` = openai | openrouter — both via the OpenAI SDK); `pricing.ts` + `complimentary-gate.ts` handle cost accounting and the free-tier daily token gate.

### Explainer videos (feature-flagged)

`VIDEO_EXPLAINER_ENABLED=1` + `NEXT_PUBLIC_VIDEO_EXPLAINER=1` add a **Video** toggle to the repo toolbar; the diagram stays the default view. `/api/video/generate` (`src/server/video/generate.ts`) reads the repo with the diagram pipeline's own GitHub/source-selection modules, then Claude works in two roles that share one cached prompt prefix (`director.ts`, `shot-prompt.ts`): a **director** writes a 14–16 beat script that goes top-down (what the project is and does → how the main parts fit → a few decisions under the hood), with a visual brief per beat, and one **designer per scene** runs in parallel to turn briefs into a free-form JSON shot language (elements on a 16×9 canvas, cue-word timing, actions, camera). Both are non-strict tool calls — the schemas are too large for strict structured output. `shots.ts` validates shots against the real tree (paths, verbatim code, cue words, canvas bounds). ElevenLabs narrates each scene as one take while designers work (`narration.ts`), and plan + clips are stored (`store.ts`: `.video-cache/` locally, R2 `video/v1/` in production). Nothing renders server-side: `explainer-player.tsx` runs the shot engine (`public/video-engine/shots.js`; `engine.js` is the v1 template engine) in a same-origin iframe with its own strict CSP, mixes the narration and soft untuned foley (no music) with Web Audio, and seeks the scene timeline to the audio clock every frame. Bump `ENGINE_VERSION` in `explainer-player.tsx` (and the `?v=` in `stage.html`) with any change under `public/video-engine`. `video-lab/` holds the offline MP4 pipeline for the v1 engine.

### Layering

- `src/server/` — server-only code (imports `server-only`): generation pipeline, GitHub auth (`github-auth.ts` supports single PAT, PAT pool, or GitHub App), storage, HTTP guards, OG image generation.
- `src/server/http/` — `same-origin.ts` / `same-origin-json.ts` / `request-credentials.ts`: mutating API routes require same-origin requests; user GitHub tokens travel per-request and are never persisted server-side. `client-ip.ts` resolves the caller for abuse control only — it trusts forwarding headers and is never an authentication signal.
- **Abuse control** — generations billed to the server's own key pass through a per-IP fixed-window limiter (`generate/rate-limit.ts`, `GENERATION_RATE_LIMIT_MAX` / `GENERATION_RATE_LIMIT_WINDOW_SECONDS`) before the daily complimentary quota. It fails open on Redis errors because the daily quota still bounds total spend. Callers supplying their own API key are not throttled.
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
