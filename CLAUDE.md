# gitdiagram

gitdiagram.com turns a github repo into an interactive mermaid architecture diagram, plus narrated explainer videos, a public mcp server and sponsor ad slots. one next.js 16 app router app (react 19, typescript, tailwind 4, bun). the api is route handlers under `src/app/api/`. public repo `ahmedkhaleel2004/gitdiagram`, branch `main`. it is live with paying sponsors.

production is cloudflare workers (opennext). vercel no longer builds or serves it. how the code works: `docs/architecture.md`. background and dates: `docs/HISTORY.md`.

## hard rules
- **a push to `main` is a production deploy**, even when ci fails. run the gate first. pushes that touch only root `*.md`, `docs/**` or `experiments/**` don't deploy.
- commit to `main`, no branches or PRs unless i ask. `git pull --rebase` first: the sponsor readme workflow commits to `main` by itself.
- secrets never go in the repo, ci, logs or chat. they live in the workers and in `~/.config/gitdiagram/` on `ahmed-vps`.
- no real stripe charges while testing (staging has a test key). keep paid model, voice and video calls small. cloudflare has no hard spending cap, and i want no spend alerts on it.
- never delete production R2 objects, redis keys or workers without my say-so. `bun run diagram:delete owner/repo` is for an owner's request only (dry run without `--apply`).
- **sponsor campaigns** (`src/lib/sponsor-campaign.ts`, `sponsor-creative.ts`) are paid bookings with fixed dates. change them only when i say. `docs/operations/sponsor-clicks.md` records each booking.
- **the live switches in `/admin`** change what visitors get. flip them only when asked, and read them live (`HGETALL admin:v1:controls`), never from a note.
- private repos: public reads use only the public R2 namespace. a visitor's github token travels per request and is never stored. private diagrams from a sign-in are stored under a key made with `CACHE_KEY_SECRET` (`githubConnectionStorageKey`), never a readable `github-user:<id>`.
- what a video cost never reaches the browser (`publicVideoArtifact` strips it).
- diagram safety is three layers (server validation, the deterministic compiler, client sanitizing). a change to one leaves the others intact.
- server code stays under `src/server/` behind `server-only`.
- no stand-in data and no silent fallbacks. when something fails, show a plain error and log the reason.
- the vercel project and the old preview projects stay where they are. don't delete them without my say-so.

## commands
```bash
bun run dev            # localhost:3000
bun run test           # vitest (server project: node, client project: jsdom)
bun run check          # lint + typecheck
bun run build
```
the gate ci runs: `bun run lint && bun run typecheck && bun run format:check && bun run knip && bun audit && bun run test && bun run build && bun run check:video-tracing && bun run perf:budget`.

environment: copy `.env.example` to `.env` (`docs/dev-setup.md`). path alias `~` is `src/`. `experiments/` is left out of typecheck and lint.

## hosting on cloudflare
account `8a4f309f2639721dc9f4f0d1790fd6d5`. four workers from one build:
- `gitdiagram-edge` (`wrangler.edge.jsonc`): the routes and static files. answers cached pages at each location.
- `gitdiagram` (`wrangler.jsonc`): the site's worker: firewall, routing, page cache, render containers, crons.
- `gitdiagram-server` (`wrangler.server.jsonc`): the next.js server, placed near redis and R2.
- `gitdiagram-server-local` (`wrangler.server-local.jsonc`): the same server where the visitor is, for long or memory-heavy work.

**an isolate over 128 MB is killed with everything it is running.** a new route that loads the whole browse index, runs long or holds tens of MB goes in `runsWhereTheVisitorIs` (`src/lib/cloudflare-edge.ts`).

### check the live state
```bash
curl -sI https://gitdiagram.com | grep -iE 'server|server-timing|x-opennext'
for c in wrangler.edge.jsonc wrangler.jsonc wrangler.server.jsonc wrangler.server-local.jsonc; do bunx wrangler deployments list -c $c | tail -8; done
gh run list -L 10
bun run cf:usage --site                       # spend so far and a projected month
bunx wrangler tail gitdiagram                 # live logs (gitdiagram-errors: one line per failed invocation)
node scripts/video-pipeline-test.mjs health   # video runs made, failed, lost
curl -s https://gitdiagram.com/api/healthz    # redis false = every free generation fails
```
on this server wrangler needs `CLOUDFLARE_API_TOKEN=$(cat ~/.config/gitdiagram/cloudflare-api-token)` and `CLOUDFLARE_ACCOUNT_ID`.

### deploy and roll back
- deploy: push to `main`. by hand: `bun run cf:deploy` (`--skip-build`, `--secrets`).
- a new durable object class the server binds must ship in `gitdiagram` one deploy earlier.
- every deploy empties the page cache and cuts open streams. many deploys in a day cost R2 writes and slow first views.
- `workers/presence` and `workers/errors` deploy by hand (`bunx wrangler deploy` in the folder), before a site deploy that needs them. bump `PRESENCE_PROTOCOL` with any protocol change, worker first.
- roll back all four, servers first: `bunx wrangler rollback -c wrangler.server.jsonc`, `-c wrangler.server-local.jsonc`, plain, then `-c wrangler.edge.jsonc`.
- vercel is not a rollback any more.

### secrets
the full set is `~/.config/gitdiagram/cloudflare/production.env.json` on `ahmed-vps`. to add one: `bunx wrangler secret put NAME` on the site's worker and both servers, or add it to the json and run `bun run cf:deploy --secrets`. a secret put on a server worker isn't served until a full deploy.

### workers are not node (each of these cost real visitors something)
- no filesystem, no child processes. `after()` work has about 30 s.
- a request must not await a promise another request started: module-level promises go through `sharedRead` / `outliveRequest` (`src/server/shared-read.ts`).
- `fetch(..., { redirect: "error" })` throws. use `"manual"` and treat a 3xx as a failure.
- node-only http clients can hang: stripe and R2 use fetch clients.
- model apis see the visitor's country from a worker and openai refuses some. model clients take `...modelFetchOption()` (`src/server/model-fetch.ts`), which resends through the `US_RELAY` durable object.
- an uncached `fetch` while a page renders for the cache fails the page with a 500. keep such calls out of anything a layout or cached page reads.
- the next.js proxy is not in the cloudflare build. change the rules in `src/lib/proxy-rules.ts`, not `proxy.ts`.
- keep workers-only behaviour behind `cloudflareContext()`: the same code runs in the render containers and locally.
- give a new public `GET` route a shared cache lifetime only if its answer is the same for everyone.

### credits
$10,000 of cloudflare startup credits, to 2027-10-07 (balance: `GET /accounts/<id>/billing/credits`). switched on because of them: every request logged, and the enterprise zone plan at $0. turn those back before the credits end. `RENDER_KEEP_AWAKE` is built and off: about $230 a month of credits, my call.

### staging
`node scripts/cf-staging.mjs deploy` puts the whole site on `gitdiagram-staging` with its own bucket, redis and a test stripe key. `destroy` removes it. `scripts/video-model-replay.mjs` replays a recorded generation, so load tests cost nothing.

## diagram pipeline (`src/server/generate/`, details in `docs/architecture.md`)
- the model returns a strict graph, `graph.ts` validates every path against the real tree, and `compileDiagramGraph` turns it into mermaid.
- `mermaid-validator.ts` and `mermaid.ts` are test-only: never import them into production code.
- the client renders with `securityLevel: "antiscript"`. `strict` breaks the click links the diagram needs.
- the abuse limiters fail open on redis errors because the daily quota still bounds spend. mutating routes require same-origin requests.
- `AI_PROVIDER` picks openai, openrouter or meta. meta is built and off: flipping it spends my card, so only on my word.

## explainer videos (`src/{server,features,components}/explainer/`)
- which model does which role: `planner.ts` and the `VIDEO_*` settings in `.env.example`.
- one narrator through openrouter, one take, no fallback voice and no delivery tags. whisper gives the word timings and is never prompted with the script (it hallucinated).
- who may start one is set live in `/admin`. the limits are per person (a browser cookie), never per IP as the main limit, and a limit message never says "network". only the operator may regenerate a video.
- paid videos: every failure refunds. don't change refund or claim logic without tests.
- **with any change under `public/video-engine`, bump `ENGINE_VERSION` and every `?v=` in `stage.html` and `engine.css` together** (a test enforces it).
- in the live frame keep `gsap.config({ force3D: false })`, and no `will-change`, 3d transforms or live svg filters on full-frame elements: webkit gives every such layer a full-size buffer and iphone safari crashes.
- `/api/video/render` and `/api/video/generate` must not trace the chromium launcher (`check:video-tracing`). keep `segmentSignature` in step with `sign` in `segments.ts`.
- the bun dev server can't load the render externals: run `next dev` under node to test renders.

## ai visibility, admin, mcp
- never reword or drop the 12 `AI_VISIBILITY_PROMPTS`: their history is the trend. the weekly panel is capped by `AI_PANEL_MAX_USD`.
- `/admin`: sign in with `VIDEO_ADMIN_TOKEN` (`~/.config/gitdiagram/video-admin-token`).
- `/mcp` is public, read-only and never starts a generation. **the tool descriptions are what make agents pick gitdiagram: edit them with care.** keep `server.json`'s version equal to `MCP_SERVER_VERSION`.
- the markdown twin is chosen by `.md` or `Accept: text/markdown`, never by user agent.
- a repo page whose read succeeded with no diagram is `noindex`. a failed read never is.

## known weak spot
the audience and country rules trust headers the worker writes. on any host that doesn't rewrite them a caller can forge them: pause videos from `/admin` before sending real traffic to such a host.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
