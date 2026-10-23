# Architecture

[← README](../README.md)

## Stack

- **Application:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, and Radix UI
- **Generation API:** same-origin Next.js Route Handlers
- **Storage:** Cloudflare R2 for diagram artifacts
- **Coordination:** Upstash Redis for quota accounting, cancellation, locks, and short-lived failure state
- **AI:** OpenAI or OpenRouter through `AI_PROVIDER`
- **Analytics:** PostHog
- **Deployment:** Cloudflare Workers through OpenNext (four Workers from one build), with Cloudflare Containers for MP4 renders; an offline Railway/Docker recipe is retained for disaster recovery

There is no separate FastAPI implementation, Postgres database, or Neon runtime.

The same application also serves feature-flagged explainer videos (`/api/video/*`, the `/[username]/[repo]/video` watch page and the `/videos` gallery; Claude/GPT scripts and scenes, OpenRouter narration, MP4s rendered with headless Chromium and ffmpeg) and the operator dashboard at `/admin`, fed by a separate Cloudflare Worker for live presence (`workers/presence`). See the "Explainer videos" and "Operator dashboard" sections of [CLAUDE.md](../CLAUDE.md) for how they work.

## Production architecture

The Workers serve both the UI and the generation endpoints:

- `/api/generate/cost` estimates a run after bounded GitHub ingestion, same-origin and rate limited.
- `/api/generate/stream` streams Server-Sent Events for explanation and graph progress.
- `/api/generate/cancel` records authenticated, same-origin cancellation signals.
- `/api/diagram-state` reads and writes the persisted result contract.

`/api/generate/cost`, `/api/generate/stream` and `/api/diagram-state` take an optional `commit` (a full or short SHA) to work on one commit instead of the default branch; see [Diagrams of a specific commit](#diagrams-of-a-specific-commit).

- `/api/healthz` provides a lightweight deployment health check.

Long-running generation uses a 300-second route budget with a shorter application deadline so quota reconciliation and persistence still have time to finish. Requests use explicit upstream deadlines, retries, structured logs, heartbeats, and distributed cancellation rather than process-local state.

The default managed OpenAI pipeline uses one GPT-6 Luna request at low reasoning to produce a source-grounded graph and short streamed overview. The model returns a compact graph without redundant descriptions or type captions. Graphs are validated and compiled deterministically; additional Luna calls are reserved for structural repairs at medium reasoning or one recovery after an 18-second slow request. The slow connection is cancelled before its replacement starts; its unavailable partial usage is included as an estimated cost. Managed GPT-6 Luna and GPT-5.6 requests explicitly use Fast mode (`service_tier: "priority"`); estimates include its premium, and final costs use the model and tier actually served. User-supplied keys retain standard service and their configured model. Explicit model overrides and OpenRouter retain the two-stage pipeline. Output token estimates reserve quota but do not cap provider output.

The same Next.js application also builds into a minimal, non-root standalone Docker image: the render containers run it, and it could run on Railway. No Railway service, source connection, or Railway domain is kept live. The checked-in `Dockerfile` and `railway.json` are a cold recovery recipe that can recreate the full application later without reviving a second backend implementation. See [deployment-failover.md](deployment-failover.md).

## How generation works

1. GitDiagram fetches the repository's default branch, recursive tree, and README through the GitHub API. For a commit diagram it first resolves the commit (see [Diagrams of a specific commit](#diagrams-of-a-specific-commit)) and reads the tree and README at that commit instead. When GitHub returns a partial (truncated) tree for a very large repository, the listing is kept and top-level folders it left out are read one level deep, so big repositories still get a diagram; the model only sees a bounded excerpt of the tree either way. An oversized README is rejected before model work begins.
2. GitDiagram fetches bounded, integrity-checked source excerpts (at the commit, for a commit diagram). Selection favors substantive runtime modules, distributes excerpts across long files, and preserves import bindings for sampled calls.
3. One managed Luna request streams a short architecture overview followed by a strict graph: groups, nodes, edges, shapes, labels, and repository paths. Explicit model overrides and user-supplied keys retain the separate explanation/graph flow.
4. The server validates identifiers, graph connectivity, limits, and every linked path against the actual repository. Invalid output is retried with focused feedback.
5. A deterministic compiler converts the validated AST to Mermaid with total text escaping and GitHub-only links. Links point at the default branch (`/blob/<branch>/…`, `/tree/<branch>/…`), or at the full SHA for a commit diagram (`/blob/<sha>/…`, `/tree/<sha>/…`).
6. The browser sanitizes the source, renders Mermaid with `securityLevel: "antiscript"` and `htmlLabels: false`, sanitizes the resulting SVG with DOMPurify, and enforces the GitHub-only link allowlist again. Mermaid's `strict` mode is not usable because it disables the `click` directives that make nodes link to GitHub, so the allowlist enforcement carries that weight.
7. Successful artifacts and terminal audit state are persisted so later visits can reopen the diagram without another model call.

The full Mermaid parser remains in the test suite as a compiler contract test. It is deliberately not loaded into the production generation function, keeping the server bundle small without weakening diagram validation or browser safety.

## State

- **Successful public generations:** R2 object keyed by repository (`public/v1/<owner>/<repo>.json`)
- **Successful private generations:** separate R2 namespace derived with a server-side secret
- **Successful commit generations:** one R2 object per full SHA, in the same namespace as the repository's other diagrams: `public/v1/<owner>/<repo>/commit/<sha>.json`, or `private/v1/<namespace>/<owner>/<repo>/commit/<sha>.json`. Default-branch keys are unchanged, and a commit key has four path segments after `v1` where a default-branch key has two, so the two can never collide.
- **Complimentary quota and active cancellation tokens:** Upstash Redis
- **Terminal failures without a saved artifact:** short-lived Upstash state, kept per repository and, for a commit, per full SHA (`status:v1:<visibility>:…:commit:<sha>`)
- **Concurrent writes:** distributed lock plus newest-session-wins persistence

## Diagrams of a specific commit

`/[username]/[repo]/commit/[sha]` mirrors GitHub's `github.com/<owner>/<repo>/commit/<sha>`: replacing `hub` with `diagram` in a commit URL opens it. It renders the same page as `/[username]/[repo]` (the existing `/[username]/[repo]/video` route is unaffected). The home page also takes an optional **Commit** field and navigates to the commit route when a commit URL is pasted. A commit page shows the short SHA (7 characters) as a link to the commit on GitHub; a default-branch diagram shows nothing extra.

- **Resolution.** The SHA is checked against `^[0-9a-f]{7,40}$` (case and surrounding whitespace are normalized) before GitHub is called; a branch name, tag or revision expression is never accepted. It is then resolved to the full SHA with `GET /repos/{owner}/{repo}/commits/{ref}`, and the answer must be the commit that SHA names. Everything after that (ingestion, locks, storage) uses only the full SHA. Failures have their own error codes: `COMMIT_SHA_INVALID` (400), `COMMIT_NOT_FOUND` (404), `COMMIT_AMBIGUOUS` (422), and the existing `GITHUB_AUTH_REQUIRED` (403) for a private repository without a token.
- **Ingestion.** The recursive tree is read from `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`, the README from `/readme?ref={sha}`, and source excerpts at the same SHA. Truncated trees and oversized READMEs are handled as for the default branch, and path validation runs against that commit's tree.
- **Storage and caching.** A full SHA names one tree forever, so a commit's diagram is immutable: it is written once (an existing diagram is never replaced), always reopened from storage without a model call, and never touches the default-branch artifact, preview, browse index or IndexNow pings. Different commits of one repository have different artifact keys, status keys and artifact locks. A full SHA is a storage key as it stands; a short SHA is resolved through GitHub first by `/api/diagram-state`, which applies the generation infrastructure rate limit to that lookup.
- **Cancellation and quota.** Cancellation is keyed by the generation session, and quota and rate limits are per caller, so generating two commits of the same repository, or a commit and the default branch, never interfere.
- **Rendering.** The commit page is server-rendered from storage only for a full SHA and never calls GitHub while rendering; a short SHA is resolved by the browser. Commit pages are `noindex`, canonicalize to their own lowercase URL and reuse the repository's link-preview picture.
- **Out of scope.** Explainer videos, the MCP server and the `.md` endpoint stay default-branch only. Regeneration is not offered for a commit.
