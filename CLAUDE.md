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
bun run lint           # eslint (fails on any warning)
bun run typecheck      # TypeScript 7 tsc --noEmit
bun run check          # lint + typecheck
bun run format:check   # prettier (ts/js/mdx/css/json/yaml)
bun run knip           # unused files/exports/dependencies
bun run build          # production build
bun run check:video-tracing   # after build: render routes ship ffmpeg/Chromium
bun run perf:budget    # after build: bundle budgets
```

Full gate (what CI runs): `bun run lint && bun run typecheck && bun run format:check && bun run knip && bun audit && bun run test && bun run build && bun run check:video-tracing && bun run perf:budget`. `bun install` turns on `.githooks/pre-push` (format, lint, typecheck, knip). `workers/presence` has its own CI job (typecheck, tests, audit).

Vitest runs two projects (see `vitest.config.ts`): **server** (`node` env: `src/server/**`, `src/app/api/**`) and **client** (`jsdom` env with testing-library: everything else). Tests are colocated `*.test.ts(x)` files. Path alias `~` → `src/`.

## Architecture

### Generation pipeline (the core of the app)

`/api/generate/stream` (`src/app/api/generate/stream/route.ts`, `runtime = "nodejs"`, `maxDuration = 300`) streams SSE through this pipeline, mostly in `src/server/generate/`:

1. **Ingestion** (`github.ts`) — fetch default branch, recursive tree, README via GitHub API; reject truncated/oversized input before any model call.
2. **Source context and explanation** (`repository-context.ts`, `source-context.ts`, `source-excerpt.ts`) — select at most 12 source blobs from the verified tree, fetch with a 12-second enrichment deadline, and bound excerpts to 48k characters. The server-funded OpenAI Luna configuration uses Terra for analysis when there are more than eight eligible implementation files; small repos, BYOK and custom model/provider configurations keep their configured model. Streams an evidence-grounded architecture explanation.
3. **Graph stage** (`graph-planner.ts`, `openai.ts`) — model returns a strict, size-bounded graph AST (groups/nodes/edges/labels/paths), validated by `graph.ts` (identifiers, edge endpoints, limits, every linked path checked against the real repo tree). Structural failures are retried with focused feedback up to `MAX_GRAPH_ATTEMPTS`; a graph whose _only_ fault is unresolvable node paths is repaired in place instead (`stripUnknownNodePaths`), since a path only drives a node's GitHub link.
4. **Compilation** (`compileDiagramGraph` in `graph.ts`) — deterministic AST→Mermaid compiler with total text escaping and GitHub-only links. `mermaid.ts` is only a re-export of the JSDOM-backed parser in `mermaid-validator.ts`; that parser is intentionally **test-only** (`mermaid.test.ts` contract tests) to keep the server bundle small — do not import it into production code.
5. **Client rendering** (`src/components/mermaid-diagram.tsx`, `src/features/diagram/mermaid-security.ts`) — sanitize source, render Mermaid with `securityLevel: "antiscript"` and `htmlLabels: false`, sanitize the resulting SVG with DOMPurify, then re-enforce the GitHub-only link allowlist. (`strict` is not usable here: it disables the `click` directives the diagram depends on, so the allowlist enforcement is what carries that weight.)

Other routes: `/api/generate/cost` (pre-run estimate), `/api/generate/cancel` (distributed cancellation via Redis), `/api/diagram-state` (persisted result contract), `/api/healthz`.

`generation-policy.ts` centralizes model/token/effort constants; `model-config.ts` selects the provider (`AI_PROVIDER` = openai | openrouter — both via the OpenAI SDK); `pricing.ts` + `complimentary-gate.ts` handle cost accounting and the free-tier daily token gate.

### Explainer videos (feature-flagged)

`VIDEO_EXPLAINER_ENABLED=1` + `NEXT_PUBLIC_VIDEO_EXPLAINER=1` turn on a **Video** toggle in the repo toolbar (the diagram stays the default view) and the shareable watch page `/[username]/[repo]/video` (poster as its link preview; never starts a diagram run). Code lives in `src/{server,features,components}/explainer/`.

- **Generation** (`/api/video/generate`, `generate.ts`): reads the repo with the diagram pipeline's own GitHub/source-selection modules, then one model works in two roles sharing one cached prompt prefix (`director.ts`, `shot-prompt.ts`). `planner.ts` picks the model once the star count is known: Claude Opus 5.5 (the better storyteller, see `experiments/video-models/`) for the operator, repos with 10k+ stars (`VIDEO_PREMIUM_MIN_STARS`) and a priority visitor's first video of the day; GPT-6 Sol at medium effort (OpenAI Responses API, same tools and prompt) for every other video. The model's name shows while the video is made, under the player and in the repo toolbar's **Info** panel (`video-info.tsx`). The **director** writes the narration first as one continuous story (a single thread followed from a hook to a closing line), then cuts it into a 12–16 beat script that goes top-down (what the project is and does → how the main parts fit → a few decisions under the hood); one **designer per scene** runs in parallel and turns briefs into a free-form JSON shot language. Both are non-strict tool calls (the schemas are too large for strict structured output). `shots.ts` validates shots against the real tree; `SHOT_KINDS`/`SHOT_ACTIONS` in `src/features/explainer/types.ts` are the one source for the shot format (types, tool schema, normalizer, and a test that the engine and prompt cover each). Repository text reaches the prompt fenced as untrusted `<repository_material>`, and `normalizeScript` cuts sentences naming web addresses the repo never mentions. ElevenLabs `eleven_v3` narrates the whole script as one continuous take while designers work, and character timestamps split it back into beats (`narration.ts`); per-scene takes sounded stitched together. The director writes for the ear (pacing punctuation plus a few whitelisted delivery tags such as `[curious]`); `text.ts` keeps the tags in the spoken line and strips them from captions, cues and word timing. After the video is stored, a poster still is rendered (`posters.ts`). A run has a 240 s deadline threaded through every model and voice call; when one parallel part fails, the others are aborted and settled before the lock is released.
- **Priority places and audience** (`audience.ts`, `features/admin/priority-places.ts`): two definitions of the priority places, picked live in `/admin`: "cities" (California, Washington, New York, Ontario, British Columbia, or within 60 km of London or Paris; Paris also matches all of Île-de-France) or "countries" (all of the US, Canada and the UK, plus the Paris area), from Vercel IP geolocation headers. People there get more videos a day and their first is made with Opus. The audience switch decides who may start videos at all: the priority places (any device), those plus any desktop, or everyone; everyone can watch. It is an access rule, not a security boundary (VPNs pass). `VIDEO_PREVIEW_PAUSED=audience|device|limit` previews the paused UI in development. The operator can also pause new videos and override the daily limits live from `/admin` (see below).
- **Budget** (`limits.ts`): public generations are capped per UTC day overall, per person (one browser, a random-id cookie from `visitor.ts`, set by `GET /api/video` and required on POST; default 1, or `VIDEO_PRIORITY_PERSON_DAILY_LIMIT`, default 3, in a priority place, of which `VIDEO_PREMIUM_PERSON_DAILY_LIMIT`, default 1, use Opus) and per connection as a looser backstop (default 10, so a shared office still works) in Redis (fails closed), at most 3 paid runs at once, stop when ElevenLabs credits run low or cannot be read, and are locked per repo across instances (existence is re-checked under the lock). A failed run is refunded only if it failed before the first model call. Admin resets bump a counter epoch instead of deleting keys. Only the operator (`VIDEO_ADMIN_TOKEN` as Bearer, or a signed-in `/admin` browser) may regenerate an existing video; locally every caller is trusted.
- **Storage** (`store.ts`): `.video-cache/` locally, R2 `video/v1/<owner>/<repo>/` in production. The artifact points at a version folder (its `createdAt`) holding narration clips, MP4s (named with the engine version), `poster.jpg` (the title card) and `still.jpg` (a scene frame for the `/videos` gallery, `catalog.ts`), so every file URL is immutable (poster/still URLs also carry a `p` stamp, so a remade poster gets a fresh URL). A regeneration keeps the version it replaced (open tabs keep playing) and deletes older ones. The gallery and sitemap read a Redis index (`video:v1:index`, `video-index.ts`) that is backfilled from R2 on first read and falls back to listing R2 if Redis is down. A video run outlives its panel (`src/features/explainer/runs.ts`); while `GET /api/video` reports `generating`, the panel polls.
- **Playback**: `explainer-player.tsx` runs the shot engine (`public/video-engine/shots.js`, with `stage.js` for captions, the vertical layout and posters) in a same-origin iframe with its own strict CSP, mixes narration and soft untuned foley (no music) with Web Audio, and seeks the scene timeline to the audio clock (minus output latency) every frame. Speed changes are time-stretched in a Web Worker (`time-stretch.worker.ts`). Bump `ENGINE_VERSION` in `src/features/explainer/engine.ts` and the `?v=` in `stage.html` together with any change under `public/video-engine` (a test enforces they match); `stage-engine.test.ts` runs the real engine in JSDOM on a production plan.
- **MP4s** (`/api/video/render`, `render.ts`, `segments.ts`): headless Chromium (`@sparticuz/chromium` on Vercel, `VIDEO_RENDER_CHROME_PATH` locally) seeks the same stage frame by frame into ffmpeg (`ffmpeg-static`, a trusted dependency). Films render as ~5 s segments through the HMAC-signed `/api/video/render/segment` in parallel (at most `VIDEO_SEGMENT_CONCURRENCY`, default 2, Chromiums per instance; busy instances answer 503 and the orchestrator retries), under one 700 s deadline with 240 s per attempt; the first final failure aborts the rest. Segments then join with the loudness-normalized soundtrack; captions are burned in. Poster remakes also run through the segment route, so `/api/video/render` ships only ffmpeg. The client sends the `v` (createdAt) it is showing and gets a 409 `stale` if the video changed. `/api/video/file` serves posters and redirects MP4 downloads to signed R2 URLs. The Bun dev server cannot load these externals; run `next dev` under Node to test renders locally.

### Operator dashboard (`/admin`)

Only the owner gets in: sign in with `VIDEO_ADMIN_TOKEN` (failed sign-ins are rate-limited per network); the browser keeps a signed, HttpOnly session cookie (`src/server/admin/operator.ts`), which also makes that browser a video admin (no limits). Cookies are signed over a session generation in Redis (`admin:v1:session-generation`); "Sign out everywhere" bumps it, and every admin check verifies against it (while Redis is unreadable a correctly signed, unexpired cookie still works; rotating the token is the hard stop). Parts:

- **Live presence** (`workers/presence`, a Cloudflare Worker + one Durable Object, deployed separately with `bunx wrangler deploy` from that folder): every tab holds one WebSocket (`src/components/live-presence.tsx`, only when `NEXT_PUBLIC_PRESENCE_URL` is set), so "on the site now" is exact and changes the instant a tab opens or closes. Hibernating sockets and runtime-answered pings keep idle connections free. The dashboard's own socket (a ≤15-minute HMAC token from `PRESENCE_SECRET`, sent as the WebSocket subprotocol and renewed over the socket) gets join/leave/page changes batched every 250 ms. Counts and peaks use only sockets whose pings are still answered. The worker rate-limits connects per network (IPv6 per /64, a `ratelimits` binding) and closes tabs sending more than 30 messages a minute. The "clock/IP mismatch" flag is a hint, not VPN detection. Deploy the worker before the site when the protocol changes.
- **Live feed and running jobs**: routes call `emitLiveEvent` (`src/server/admin/live-events.ts`, best effort, never blocks) for diagram/video/MP4 start and finish, visitors held back by the video gate, sign-ins and switch changes. Repository names are only sent once ingestion confirms the repo is public; held-back notices are sent once per connection and repo every 10 minutes. (The Pages panel can still show a private repo's path from presence.)
- **Live switches** (`src/server/admin/controls.ts`): Redis hash `admin:v1:controls`, read with a 1 s per-instance cache, so a flip reaches every instance within a second. Starting a video fails closed when the controls cannot be read; display paths show the last controls read.
- **Counters** (`/api/admin/state`, polled every 5 s and re-read on each relevant event): video/MP4 budgets, ElevenLabs credits, complimentary diagram tokens.

### Layering

- `src/server/` — server-only code (imports `server-only`): generation pipeline, GitHub auth (`github-auth.ts` supports single PAT, PAT pool, or GitHub App), storage, HTTP guards, OG image generation.
- `src/server/http/` — `same-origin.ts` / `same-origin-json.ts` / `request-credentials.ts`: mutating API routes require same-origin requests; user GitHub tokens travel per-request and are never persisted server-side. `client-ip.ts` resolves the caller for abuse control only — it trusts forwarding headers and is never an authentication signal.
- **Abuse control** — generations billed to the server's own key pass through a per-IP fixed-window limiter (`generate/rate-limit.ts`, `GENERATION_RATE_LIMIT_MAX` / `GENERATION_RATE_LIMIT_WINDOW_SECONDS`) before the daily complimentary quota. It fails open on Redis errors because the daily quota still bounds total spend. Callers supplying their own API key are not throttled.
- `src/server/storage/` — R2 (`r2.ts`, `artifact-store.ts`) for diagram artifacts, with a **separate private namespace derived from `CACHE_KEY_SECRET`** for private repos (`cache-key.ts`); Upstash Redis (`upstash.ts`) for quota (`quota-store.ts`), cancellation, short-lived failure state (`status-store.ts`), and `distributed-lock.ts` (newest-session-wins persistence in `generation-persistence.ts`).
- `src/features/` — client/shared domain logic per feature (diagram SSE parsing, export, github-url parsing, credentials, browse catalog). The graph AST schema/types in `src/features/diagram/graph.ts` are shared between server validation and client.
- `src/hooks/useDiagram.ts` + `src/hooks/diagram/` — orchestrate the client generation lifecycle (cost check → stream → render → persist).
- `src/app/[username]/[repo]/` — the diagram page (and `video/`, the watch page); also `/browse`, `/videos`, `/advertise` (`/sponsor` redirects there), `/admin`, and `/out/[campaign]` (sponsor click-through).

### Environment

Copy `.env.example` → `.env`. Minimum to run generation locally: R2 vars, `CACHE_KEY_SECRET`, Upstash vars, and one AI provider key. See `docs/dev-setup.md` for the full list.

## Conventions

- Prettier with `prettier-plugin-tailwindcss` (`bun run format:write`); ESLint 10 flat config (`eslint.config.mjs`).
- Server code must not leak into client bundles — keep it under `src/server/` behind `server-only`.
- Diagram output safety is defense-in-depth (server validation → deterministic compiler → client sanitization); changes to any layer should keep the others intact and are covered by `mermaid-security.test.ts` and the compiler contract tests.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
