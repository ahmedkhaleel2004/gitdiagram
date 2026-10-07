# CLAUDE.md

Guidance for Claude Code in this repository. It says what is true now and what the rules are. Where a live fact matters, a command to check it is given: run the command instead of trusting a date. Background and dates are in `docs/HISTORY.md`.

## What this is

GitDiagram (gitdiagram.com) turns a GitHub repository into an interactive Mermaid architecture diagram, plus narrated explainer videos, a public MCP server and sponsor ad slots. It is **one Next.js 16 App Router application** (React 19, TypeScript, Tailwind 4, Bun). There is no separate backend: the API is Next.js Route Handlers under `src/app/api/`. Public repo `ahmedkhaleel2004/gitdiagram`, branch `main`.

**Production is Cloudflare Workers** (OpenNext). Vercel no longer builds or serves the site (see Hard rules). The site is live with paying sponsors.

## Hard rules

- **A push to `main` is a production deploy.** `.github/workflows/cloudflare.yml` deploys it to Cloudflare, even when CI fails. Run the gate (below) first. Pushes that touch only root `*.md`, `docs/**`, `experiments/**` and a few test tools do not deploy to Cloudflare (`paths-ignore` in that workflow).
- **Commit to `main`; no feature branches or PRs** unless Ahmed asks. `git pull --rebase` before pushing: the `Sponsor README schedule` workflow commits to `main` by itself when a campaign boundary passes.
- **Vercel is wound down (2026-10-07, Ahmed's call).** The `gitdiagram` Vercel project is paused and disconnected from GitHub, and the team is on the free Hobby plan, which cannot run this site (crons more often than daily, a 4 GB function, commercial use). It is no longer a rollback: roll back on Cloudflare (below). The project, its environment variables and the old preview projects were left in place; do not delete them without Ahmed's say-so. The code still runs on Vercel and locally (`process.env.VERCEL`, `vercel.json`, `src/proxy.ts`): keep platform-only behaviour behind runtime detection, `cloudflareContext()` (`src/server/cloudflare-context.ts`) being defined only on Workers.
- **Secrets** never go in the repo, CI, logs or chat. They live in the Workers (`wrangler secret list`) and in `~/.config/gitdiagram/` on `ahmed-vps`. A new environment variable goes on the Workers (see Secrets).
- **Money.** No real Stripe charges while testing (staging has a test-mode key). Keep paid model, voice and video calls small. Cloudflare has no hard spending cap.
- **Deleting.** `bun run diagram:delete owner/repo` removes a stored public diagram and is for an owner's request only; it is a dry run without `--apply`. `node scripts/cf-staging.mjs destroy` removes staging. Never delete production R2 objects, Redis keys or Workers without Ahmed's say-so.
- **Private repositories.** Public reads (pages, Markdown twin, MCP, browse) use only the public R2 namespace. A visitor's GitHub token travels per request and is never stored on the server. `client-ip.ts` is for abuse control only, never authentication.
- **What a video cost never reaches the browser** (`publicVideoArtifact` in `src/server/explainer/store.ts` strips it; videos are sold).
- **Diagram safety is three layers** (server validation, deterministic compiler, client sanitizing). A change to one must leave the others intact (`mermaid-security.test.ts`, the compiler contract tests).
- **Server code stays out of client bundles:** keep it under `src/server/` behind `server-only`.
- **Sponsor campaigns** (`src/lib/sponsor-campaign.ts`, `sponsor-creative.ts`) are paid bookings with fixed dates. Change them only on Ahmed's instruction; `docs/operations/sponsor-clicks.md` records each booking.

## Commands

Bun is the package manager and runtime (`bun install`; `bun ci` for a frozen lockfile).

```bash
bun run dev            # dev server (Turbopack) at localhost:3000
bun run test           # all tests (vitest run)
bun run test src/server/generate/graph.test.ts   # one file
bun run lint           # eslint, fails on any warning
bun run typecheck      # TypeScript 7, tsc --noEmit
bun run check          # lint + typecheck
bun run format:check   # prettier (format:write to fix)
bun run knip           # unused files, exports, dependencies
bun run build          # production build
bun run check:video-tracing   # after build: video routes trace ffmpeg/Chromium only where needed
bun run perf:budget    # after build: bundle budgets
```

The gate CI runs: `bun run lint && bun run typecheck && bun run format:check && bun run knip && bun audit && bun run test && bun run build && bun run check:video-tracing && bun run perf:budget`. `bun install` turns on `.githooks/pre-push` (format, lint, typecheck, knip). `workers/presence` has its own CI job. `experiments/` (old scripts and evals) is left out of typecheck and lint.

Vitest has two projects (`vitest.config.ts`): **server** (`node`: `src/server/**`, `src/app/api/**`) and **client** (`jsdom`: the rest). Tests sit beside the code as `*.test.ts(x)`. Path alias `~` is `src/`.

Environment: copy `.env.example` to `.env`. The least that runs generation locally: the R2 variables, `CACHE_KEY_SECRET`, the Upstash variables and one AI provider key. `.env.example` lists every setting with its default; `docs/dev-setup.md` groups them.

## Layout

- `src/app/`: Routes. `[username]/[repo]/` is the diagram page (`video/` the watch page); also `/browse`, `/videos`, `/reels`, `/advertise`, `/admin`, `/mcp`, `/out/[campaign]` (sponsor click-through), `/visualize-codebase`.
- `src/server/`: Server-only code: `generate/` (diagram pipeline), `explainer/` (videos), `storage/` (R2, Upstash), `http/` (same-origin guards, credentials), `admin/`, `mcp/`, `github-connect/`, `og/`.
- `src/features/`: Client and shared logic per feature. `diagram/graph.ts` holds the graph schema both sides use.
- `src/hooks/useDiagram.ts`, `src/hooks/diagram/`: The client generation lifecycle (cost check, stream, render, persist).
- `src/lib/`: Pure logic shared with the Workers: `cloudflare-edge.ts`, `proxy-rules.ts`, `colo-cache.ts`, sponsor campaigns.
- `cloudflare/`: Worker entry files (`edge.ts`, `worker.ts`, `server.ts`, `us-relay.ts`, `staging.ts`), outside the root tsconfig.
- `workers/`: `render/` (video containers), `presence/` (live visitor count), `errors/` (Tail Worker).
- `public/video-engine/`: The shot engine that plays and renders videos.
- `scripts/`: Deploy (`cf-*.sh`, `cf-*.mjs`), checks, benchmarks, operator tools.
- `plugins/gitdiagram/`, `server.json`: The OpenAI plugin package and the MCP Registry entry.
- `docs/`: `dev-setup.md`, `operations/` (PostHog, sponsor bookings, traffic protection), `HISTORY.md`. `architecture.md`, `deployment-failover.md` and the hosting parts of `dev-setup.md` and `README.md` still describe Vercel as production: out of date.

## Hosting on Cloudflare

Account `8a4f309f2639721dc9f4f0d1790fd6d5`. The OpenNext adapter (`@opennextjs/cloudflare`, `open-next.config.ts`) builds **four Workers from one build**:

- `gitdiagram-edge` (`wrangler.edge.jsonc`, `cloudflare/edge.ts`): Holds the site's routes and static files. Answers a cached page this location holds, plus `/api/sponsor` and `/api/analytics-context`. Sends a page it lacks straight to the placed server and passes everything else on.
- `gitdiagram` (`wrangler.jsonc`, `cloudflare/worker.ts`): The site's Worker: firewall, OpenNext's routing layer, the page cache, the render containers, the crons. Complete without the edge Worker (staging runs that way).
- `gitdiagram-server` (`wrangler.server.jsonc`, `cloudflare/server.ts`): The Next.js server, on a service binding, with `placement` so it runs in one place near Redis and R2 and stays warm.
- `gitdiagram-server-local` (`wrangler.server-local.jsonc`): The same server without `placement`. It runs where the visitor is and takes what is long or memory-heavy.

A test keeps the two server configs identical apart from name and placement. The layers exist for start-up time: a new edge isolate answers in tens of milliseconds, a new server isolate takes over a second.

**A Worker isolate over 128 MB is killed with everything it is running.** A new route that loads the whole browse index (about 170,000 entries, kept in module memory by `browse-index-cache.ts`), runs for long, or holds tens of MB must be added to `runsWhereTheVisitorIs` in `src/lib/cloudflare-edge.ts` (today: diagram runs, the crons, the MCP endpoint, the sitemaps, whole-index browse queries).

### Check the live state

```bash
curl -sI https://gitdiagram.com | grep -iE 'server|server-timing|x-opennext'   # server: cloudflare
for c in wrangler.edge.jsonc wrangler.jsonc wrangler.server.jsonc wrangler.server-local.jsonc; do bunx wrangler deployments list -c $c | tail -8; done   # the servers' message is the commit
gh run list -L 10                      # CI, Cloudflare deploy, Cost watch
bun run cf:usage --site                # spend so far and a projected month
bunx wrangler tail gitdiagram          # live logs (every request is also stored while the credits last)
bunx wrangler tail gitdiagram-errors   # one site.failure line per failed invocation
node scripts/video-pipeline-test.mjs health   # video runs made, failed, lost, with reasons
node scripts/compare-hosts.mjs         # same ~70 requests to two hosts, compared (--a, --b, --only, --json, --verbose)
node scripts/bench.mjs local|global|vitals|cache   # latency and cache hit ratio
```

On this server, wrangler needs `CLOUDFLARE_API_TOKEN=$(cat ~/.config/gitdiagram/cloudflare-api-token)` and `CLOUDFLARE_ACCOUNT_ID` set. The site's Worker also answers at `https://gitdiagram.gitdiagram-presence.workers.dev` (every answer off gitdiagram.com is marked `noindex`).

### Deploy and roll back

- **Deploy:** push to `main`. CI runs `bun run cf:deploy` with `CF_SKIP_CACHE_POPULATE=1` (it has no production secrets, so prerendered pages are rendered on first request). By hand, from a machine with the env file and the API token: `bun run cf:deploy`, `bun run cf:deploy --skip-build`, `bun run cf:build` alone.
- **Order inside `scripts/cf-deploy.sh`:** upload the new server versions without traffic, deploy the edge Worker and point the routes at it (`scripts/cf-routes.mjs`; the routes are in no wrangler config and a test keeps it so), deploy the site's Worker pinned to the new servers, then give the new servers all traffic. A page is never routed by one build and rendered by another.
- **A new Durable Object class the server binds must ship in `gitdiagram` one deploy earlier** (the servers upload first).
- **Every deploy empties the page cache** (cache keys carry the build id) and cuts open response streams. The script re-uploads the last week's hashed build files so open tabs keep loading; `chunk-reload.ts` covers the rest. There is no Skew Protection on Cloudflare.
- **Deployed by hand, not by CI:** `workers/presence` (`bunx wrangler deploy` in that folder) and `workers/errors` (`bunx wrangler deploy -c workers/errors/wrangler.jsonc`). Deploy either one before a site deploy that needs the newer version.
- **Roll back** all four, servers first: `bunx wrangler rollback -c wrangler.server.jsonc`, `bunx wrangler rollback -c wrangler.server-local.jsonc`, `bunx wrangler rollback`, `bunx wrangler rollback -c wrangler.edge.jsonc`. Or pick a version: `bunx wrangler versions list`, then `bunx wrangler versions deploy <version-id>@100%`. Secrets and bindings travel with the version. To take the edge Worker out of the path: `node scripts/cf-routes.mjs gitdiagram`.
- **Back to Vercel is no longer a switch:** it would need the Pro plan again, the project unpaused and reconnected, and its environment brought up to date (its `RESEND_*` values are the old account's). The DNS steps are in `~/repos/general/gitdiagram-cloudflare/STATUS.md` under "Cutover".

### Secrets

They live in the site's Worker and both servers (`wrangler secret list`, also with `-c wrangler.server.jsonc` and `-c wrangler.server-local.jsonc`); the edge Worker has three (`CRON_SECRET` and the two Upstash ones). The full set is in `~/.config/gitdiagram/cloudflare/production.env.json` on `ahmed-vps` (`vercel env pull` returns `[SENSITIVE]` for Sensitive values, so Vercel is not a source). `scripts/cf-secrets.mjs` reads the file (`--names`, or pipe to `wrangler secret bulk`). To add one: `bunx wrangler secret put NAME` for each Worker, or add it to the JSON file and run `bun run cf:deploy --secrets`; then add it to Vercel too. Render containers get every string var and secret of the site's Worker as their environment.

### What the site's Worker does that Vercel's platform did

`cloudflare/worker.ts` (pure logic and tests in `src/lib/cloudflare-edge.ts`):

- Writes Vercel-style request headers from Cloudflare's data (`x-vercel-ip-*`, `x-forwarded-for`, `x-real-ip`, `x-forwarded-host/proto`) and drops a caller's own copies. The audience and limit rules read these.
- Firewall: per-address rate limits (`ratelimits` bindings) on the generation routes and repository pages; ClaudeBot, Amazonbot and Brightbot blocked on repository pages; scanner paths answered 404; `www` redirected to the apex.
- Hands `/api/video/generate`, `/api/video/render` and `/api/video/render/segment` to the render containers, after answering wrong-method and cross-origin calls itself so a stray request never wakes one.
- Runs the three crons (`triggers.crons` in `wrangler.jsonc`, to the same internal routes with `CRON_SECRET`). A test keeps `vercel.json`, `wrangler.jsonc` and the map in step.
- Adds `next.config.js` site-wide headers where OpenNext leaves them off, strips `s-maxage` and `Vercel-*` response headers, gives outgoing `fetch` a User-Agent (GitHub refuses requests without one), and adds `Server-Timing: edge;dur=...;desc="warm"|"new isolate"`.

**The Next.js proxy is not in the Cloudflare build** (`scripts/cf-drop-proxy.mjs` removes it). `src/proxy.ts` (Vercel, local) and the Worker entry both apply the rules in `src/lib/proxy-rules.ts` (forged Server Actions, lowercase repository URLs, the Markdown twin, counting crawler fetches). Change the rules there, not in `proxy.ts`.

**Static files** are answered by Workers Assets without running a Worker. `scripts/cf-asset-headers.mjs` turns `next.config.js` `headers()` into a `_headers` file at build time; conditional rules (`has`/`missing`) are not supported there.

### Page cache

Pages and data-cache entries live in R2 bucket `gitdiagram-next-cache` (7-day lifecycle). `src/lib/colo-cache.ts` (wired in `open-next.config.ts`) puts copies in front: each Cloudflare location keeps a page in the Cache API (trusted for 30 s, `RECHECK_MS`; an older copy is still answered at once and checked after the response); a location without one asks the placed server, which hands over its cache entry or renders; the server only hands out entries the tag cache (Durable Objects) calls current. `revalidatePath` reaches other locations within about 40 s plus one request. Entries over about 1.5 MB (the sitemaps) get no copies. A request with `x-gitdiagram-full-path` skips the edge copy.

A `GET` under `/api/` (not `/api/internal` or `/api/admin`, no `Authorization` or `Range`) that answers 200 with `s-maxage` or `CDN-Cache-Control` and no cookie is also kept per location (`cloudflare/edge-answers.ts`; header `x-edge-cache: HIT|STALE|MISS`). Give a new public `GET` route a shared lifetime only if its answer is the same for everyone.

### Workers are not Node (each of these cost real visitors something)

- No filesystem (next/og fonts come from assets, `src/server/og/cards.tsx`) and no child processes. `after()` work has about 30 s after the response.
- A request must not await a promise another request started. A promise kept at module level must go through `sharedRead` / `outliveRequest` (`src/server/shared-read.ts`), or a cancelled first caller hangs every later request on that isolate.
- `fetch(..., { redirect: "error" })` throws a TypeError. Use `"manual"` and treat a 3xx as a failure.
- Node-only HTTP clients can hang: Stripe uses its fetch client on Workers, and `r2.ts` uses the AWS SDK's fetch handler (where `fetch` has already un-gzipped objects stored with `Content-Encoding: gzip`).
- Model APIs see the **visitor's** country on calls from a Worker, and OpenAI refuses some countries with a 403. Model SDK clients on the Worker take `...modelFetchOption()` (`src/server/model-fetch.ts`), which resends a refused call through the `US_RELAY` Durable Object. `GET /api/internal/model-relay` with `CRON_SECRET` checks it.
- An uncached `fetch` (a token mint, `cache: "no-store"`) while a page renders for the cache fails the page with a 500. Keep such calls out of anything a layout or cached page reads.
- api.indexnow.org and bing.com answer 429 to Workers' shared addresses; `indexnow.ts` falls back to Yandex and Seznam.

### Cost guards

Billed: Worker requests and CPU, Durable Object requests, R2 writes (two per newly rendered repository page) and reads, and the render containers' memory while awake. Guards: `limits.cpu_ms`, the `LIMIT_*` rate limits in `wrangler.jsonc` (verified search crawlers exempt on repository pages), a zone rate-limiting rule, budget alert emails (a day behind), and the hourly `Cost watch` workflow, which fails (so GitHub emails Ahmed) when the last six hours project past its ceiling for the whole account. Staging load tests count toward it.

**Startup credits** ($10,000 from Cloudflare for Startups, to 2027-10-07; balance: `GET /accounts/<id>/billing/credits`, or Billing > Credits). **Not yet proven to pay for anything:** the first invoice since they arrived is due about 2026-10-28, and Cloudflare's list of covered products names Workers, Durable Objects and R2 but not Containers or Workers Logs. Until an invoice shows them applied, spend as if the card pays. Switched on because of them: every request is logged (`head_sampling_rate` 1 in the four configs; inside the included 20M events at today's traffic), and gitdiagram.com and auctionlens.ca are on the Enterprise zone plan at $0 (they revert to Free when the program ends). Built but off: `RENDER_KEEP_AWAKE` (`wrangler.jsonc`), which keeps the render containers awake for about $230 a month.

### Staging

`node scripts/cf-staging.mjs deploy` puts the whole site on Worker `gitdiagram-staging` with its own bucket, Redis and a test-mode Stripe key (settings in `~/.config/gitdiagram/staging/env.json`), plus operator-only hooks to stop and kill containers. `destroy` removes it. `scripts/video-pipeline-test.mjs` drives it; `scripts/video-model-replay.mjs` replays one recorded generation's model calls, so generation load tests cost nothing.

## Diagram pipeline

`/api/generate/stream` (`runtime = "nodejs"`, `maxDuration = 300`) streams SSE through `src/server/generate/`:

1. **Ingestion** (`github.ts`): default branch, recursive tree, README. A truncated tree is kept; only an oversized README is rejected.
2. **Source context and explanation** (`repository-context.ts`, `source-context.ts`, `source-excerpt.ts`, `source-references.ts`): ranks source files, reads the top ones within a deadline, resolves what each imports, and opens the prompt's source text with a SOURCE INDEX. Streams an evidence-grounded explanation.
3. **Graph** (`graph-planner.ts`, `openai.ts`): the model returns a strict, size-bounded graph AST, validated by `graph.ts` (every linked path is checked against the real tree). Each edge has a nullable `evidencePath`. Structural failures are retried with feedback up to `MAX_GRAPH_ATTEMPTS`; a graph whose only faults are unknown paths is repaired in place (`stripUnknownGraphPaths`). `edge-evidence.ts` drops citations of files the model was not shown and fills uncited edges from the reference lists.
4. **Compilation** (`compileDiagramGraph` in `graph.ts`): deterministic AST to Mermaid, with total text escaping and GitHub-only links. The JSDOM parser in `mermaid-validator.ts` is **test-only**: never import it (or `mermaid.ts`) into production code.
5. **Client rendering** (`src/components/mermaid-diagram.tsx`, `src/features/diagram/mermaid-security.ts`): Mermaid with `securityLevel: "antiscript"` and `htmlLabels: false`, DOMPurify on the SVG, then the GitHub-only link allowlist again. `strict` is not usable: it disables the `click` directives the diagram depends on.

Also: `/api/generate/cost`, `/api/generate/cancel` (Redis), `/api/diagram-state`, `/api/healthz`. `generation-policy.ts` holds model, token and effort constants; `model-config.ts` picks the provider (`AI_PROVIDER` = openai | openrouter, both through the OpenAI SDK); `pricing.ts` and `complimentary-gate.ts` handle cost and the free daily token gate. `experiments/diagram-evidence/` holds the eval.

**Abuse control:** generations on the server's own key pass a per-IP limiter (`generate/rate-limit.ts`) before the daily complimentary quota; callers with their own key skip it. Every caller of `/cost` and `/stream` also passes a looser infrastructure limiter. Both fail open on Redis errors because the daily quota still bounds spend. Mutating API routes require same-origin requests (`src/server/http/`).

**Storage:** R2 for artifacts (`r2.ts`, `artifact-store.ts`), with a separate private namespace derived from `CACHE_KEY_SECRET` for private repos (`cache-key.ts`). Upstash Redis for quota, cancellation, short-lived failure state and locks (newest session wins, `generation-persistence.ts`).

**Continue with GitHub** (`src/server/github-connect/`, `NEXT_PUBLIC_GITHUB_CONNECT=1`): a separate public GitHub App used only with its client id and secret, never a private key, so the server reads a private repo only with the visitor's own token. Sign-in and flow state are sealed, HttpOnly cookies (AES-GCM, key from `CACHE_KEY_SECRET`). Refresh tokens are single use. Private diagrams from a sign-in are stored under `github-user:<id>`.

## Explainer videos

On in production (`VIDEO_EXPLAINER_ENABLED=1`, `NEXT_PUBLIC_VIDEO_EXPLAINER=1`). Code in `src/{server,features,components}/explainer/`. Routes `/api/video/*`; pages `/[username]/[repo]/video`, `/videos`, `/reels`.

- **Generation** (`generate.ts`, `director.ts`, `planner.ts`, `shot-prompt.ts`, `shot-tools.ts`): a director model writes the narration and cuts it into beats; one designer per scene turns briefs into a JSON shot language in parallel. Which models do which role, and the fallbacks, are in `planner.ts` and the `VIDEO_*` settings in `.env.example`; the evals behind the choice are in `experiments/video-*`. `script.ts` and `shots.ts` validate against the real tree. `SHOT_KINDS`, `SHOT_ACTIONS` and the sibling lists in `src/features/explainer/types.ts` are the one source for the shot format. Repository text reaches the prompt fenced as untrusted `<repository_material>`; README pictures are fetched only over https through a DNS lookup that refuses non-public addresses (`readme-images.ts`). A run has a 240 s deadline.
- **Voice** (`voice.ts`, `voice-alignment.ts`, `narration.ts`): OpenRouter text-to-speech narrates the whole script as one take; whisper word timestamps (never prompted: with the script as a prompt it hallucinated) split it into beats. There is no fallback voice: when the OpenRouter balance runs out, new videos pause for ten minutes. `/admin` shows the balance.
- **Who may start one** (`audience.ts`, `limits.ts`, `features/admin/priority-places.ts`, `limited-countries.ts`): priority places, an audience switch and limited countries, all set live in `/admin`; daily caps overall, per person (a browser cookie) and per connection, in Redis, failing closed. These are access rules, not a security boundary (a VPN passes). Only the operator may regenerate an existing video.
- **Paid videos** (`payments.ts`, `/api/video/checkout`): anyone the free rules hold back is offered a paid video through Stripe Checkout (`VIDEO_PRICE_CENTS`, and the live **Sell videos** switch). The generate route claims the session in Redis (`video:v1:paid:<id>`). Every failure refunds, and a 15-minute cron refunds payments never claimed and runs that died. Do not change refund or claim logic without tests.
- **Storage** (`store.ts`): R2 `video/v1/<owner>/<repo>/`, `.video-cache/` locally. Files live in a version folder, so every file URL is immutable. The gallery and sitemap read a Redis index (`video-index.ts`) backfilled from R2.
- **Playback** (`explainer-player.tsx`, `public/video-engine/`): the shot engine runs in a same-origin iframe with its own strict CSP and follows the audio clock. **With any change under `public/video-engine`, bump `ENGINE_VERSION` in `src/features/explainer/engine.ts` and every `?v=` in `stage.html` and `engine.css` together** (a test enforces it).
- **MP4s** (`/api/video/render`, `segments.ts`, `render.ts`, `ffmpeg.ts`, `feed-edit.ts`): headless Chromium seeks the stage frame by frame into ffmpeg, as HMAC-signed segment jobs (key derived from `CACHE_KEY_SECRET`), then joins them with the soundtrack. `/api/video/render` and `/api/video/generate` must trace no Chromium (`check:video-tracing`). The Bun dev server cannot load these externals: run `next dev` under Node to test renders locally.
- **Render containers** (`workers/render/`, bound in `wrangler.jsonc`): Cloudflare Containers run this same app as a Node server (the repo's `Dockerfile`). A render runs on the pool instance its film hashes to (`renderInstance`); video generation runs on a small `GENERATE` instance. Segments post back through the Worker, where `router.ts` checks each job's signature before waking anything: keep `segmentSignature` in step with `sign` in `segments.ts`. Pool sizes are in `wrangler.jsonc`.
- **Container image** (`scripts/cf-container-image.mjs`): tagged with a hash of what the containers run and built only when the registry lacks that tag, so most pushes start no rollout.
- **Runs that die** (`run-journal.ts`, `src/server/drain.ts`): an instance told to stop finishes its work first. A killed one runs no cleanup, so every run keeps a journal entry and holds its lock as a short lease; `reapOrphanedRuns` gives back the budget places of a silent run, and a payer's retry takes the payment over (`claimVideoPayment`).
- **Feedback** (`/api/video/feedback`): emails `VIDEO_FEEDBACK_TO` through Resend from `feedback@mail.gitdiagram.com` (a standalone Resend account since 2026-10-07, Google sign-in as ahmed@gitdiagram.com; the comment in `feedback.ts` still names the Vercel Marketplace one, whose key and DNS records are unused but still there).
- **Analytics**: `video_started`, `video_progress`, `video_shared` (`watch-analytics.ts`), `video_paywall_viewed` and `video_checkout_clicked`, in PostHog (`docs/operations/posthog.md`).

## Operator dashboard (`/admin`)

Sign in with `VIDEO_ADMIN_TOKEN` (`~/.config/gitdiagram/video-admin-token`). The browser keeps a signed, HttpOnly cookie that also makes it a video admin. "Sign out everywhere" bumps a session generation in Redis; rotating the token is the hard stop.

- **Live switches** (`src/server/admin/controls.ts`): Redis hash `admin:v1:controls`, read with a 1 s cache. Starting a video fails closed when the controls cannot be read. These switches change what visitors get: flip them only when asked.
- **Live presence** (`workers/presence`): a Worker and one Durable Object on the account's Workers Paid plan (it was built for the free plan's 100k requests a day; that limit is gone). A tab connects after two seconds in view and reports going out of view after five; the per-network and per-socket limits that remain are against abuse, not cost (`workers/presence/README.md`). **Bump `PRESENCE_PROTOCOL` (`presence-protocol.ts`) with any protocol change and deploy the worker before the site.**
- **Live feed** (`emitLiveEvent`, `src/server/admin/live-events.ts`): best effort, never blocks. Repository names are sent only once ingestion confirms the repo is public.
- **View as a visitor from another country** (`view-as.ts`): a signed cookie; `isVideoAdmin` is false meanwhile.

## MCP server, search engines and agents

- **`https://gitdiagram.com/mcp`** (`src/app/mcp/route.ts`, `src/server/mcp/`): public, read-only, stateless streamable HTTP, CORS `*`, no cookies. Tools: `get_repository_diagram`, `find_repository_diagrams`, `get_explainer_video`. They read only the public R2 namespace and never start a generation. **The tool descriptions are what make agents pick GitDiagram: edit them with care.** `usage.ts` rate-limits per network (fails open) and counts calls for `/admin`.
- **`server.json`** is the MCP Registry entry: keep its `version` equal to `MCP_SERVER_VERSION` (a test enforces it).
- **MCP App** (`src/server/mcp/app.ts`, `src/mcp-app/`): the interactive diagram view hosts such as ChatGPT show. Bump the `ui://gitdiagram/diagram-view-v1.html` version for changes old cached shells cannot load. `scripts/build-mcp-app.mjs` bundles it into the gitignored `public/mcp-app/` (run by `build` and `dev`). `plugins/gitdiagram/` is the package submitted to OpenAI's plugin directory.
- **Repository pages** share one cached read of the public artifact (`readPublicDiagramState`). `RepositoryReadout` renders the explanation, components and connections as server HTML. A page whose read succeeded with no diagram is `noindex`; a failed read never is.
- **Markdown twin:** `/{owner}/{repo}.md`, or the page URL with `Accept: text/markdown` (never by user agent), is rewritten to `src/app/[username]/[repo]/llms.txt/route.ts`.
- **Guide:** `/visualize-codebase` text lives in `src/features/guide/content.ts` and also renders `/llms-full.txt` and the FAQ JSON-LD, so they cannot drift. `/llms.txt` comes from `src/features/guide/llms.ts`; `robots.ts` names the AI crawlers.

## Known weak spots

- Several docs still say Vercel is production (see Layout). This file and the commands above are the reference.
- Every deploy starts the page cache cold, so many deploys in a day cost R2 writes and slow first views.
- The audience and country rules trust headers the Worker writes. On any host that does not rewrite them (see `docs/deployment-failover.md`), a caller can forge them; pause videos or open the gate from `/admin` before sending real traffic to such a host.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
