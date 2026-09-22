# Architecture

[← README](../README.md)

## Stack

- **Application:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, and Radix UI
- **Generation API:** same-origin Next.js Route Handlers running on Vercel's Bun runtime
- **Storage:** Cloudflare R2 or Google Cloud Storage for diagram artifacts
- **Coordination:** Upstash Redis or local/managed Redis for quota accounting, cancellation, locks, and short-lived failure state
- **AI:** OpenAI or OpenRouter through `AI_PROVIDER`
- **Analytics:** PostHog
- **Deployment:** Vercel is the only live runtime; an offline Railway/Docker recipe is retained for disaster recovery

There is no separate FastAPI implementation, Postgres database, or Neon runtime.

## Production architecture

Vercel serves both the UI and the generation endpoints:

- `/api/generate/cost` estimates a run after bounded GitHub ingestion, same-origin and rate limited.
- `/api/generate/stream` streams Server-Sent Events for explanation and graph progress.
- `/api/generate/cancel` records authenticated, same-origin cancellation signals.
- `/api/diagram-state` reads and writes the persisted result contract.
- `/api/healthz` provides a lightweight deployment health check.

Long-running generation uses a 300-second Vercel function budget with a shorter application deadline so quota reconciliation and persistence still have time to finish. Requests use explicit upstream deadlines, retries, structured logs, heartbeats, and distributed cancellation rather than process-local state.

The default managed OpenAI pipeline uses one GPT-6 Luna request at low reasoning to produce a source-grounded graph and short streamed overview. The model returns a compact graph without redundant descriptions or type captions. Graphs are validated and compiled deterministically; additional Luna calls are reserved for structural repairs at medium reasoning or one recovery after an 18-second slow request. The slow connection is cancelled before its replacement starts; its unavailable partial usage is included as an estimated cost. Managed GPT-6 Luna and GPT-5.6 requests explicitly use Fast mode (`service_tier: "priority"`); estimates include its premium, and final costs use the model and tier actually served. User-supplied keys retain standard service and their configured model. Explicit model overrides and OpenRouter retain the two-stage pipeline. Output token estimates reserve quota but do not cap provider output.

The same Next.js application can also build into a minimal, non-root standalone Docker image for Railway. No Railway service, source connection, or Railway domain is kept live. The checked-in `Dockerfile` and `railway.json` are a cold recovery recipe that can recreate the full application later without reviving a second backend implementation. See [deployment-failover.md](deployment-failover.md).

## How generation works

1. GitDiagram fetches the repository's default branch, recursive tree, and README through the GitHub API. Truncated trees and oversized inputs are rejected before model work begins.
2. GitDiagram fetches bounded, integrity-checked source excerpts. Selection favors substantive runtime modules, distributes excerpts across long files, and preserves import bindings for sampled calls.
3. One managed Luna request streams a short architecture overview followed by a strict graph: groups, nodes, edges, shapes, labels, and repository paths. Explicit model overrides and user-supplied keys retain the separate explanation/graph flow.
4. The server validates identifiers, graph connectivity, limits, and every linked path against the actual repository. Invalid output is retried with focused feedback.
5. A deterministic compiler converts the validated AST to Mermaid with total text escaping and GitHub-only links.
6. The browser sanitizes the source, renders Mermaid in strict security mode, sanitizes the resulting SVG, and enforces the link allowlist again.
7. Successful artifacts and terminal audit state are persisted so later visits can reopen the diagram without another model call.

The full Mermaid parser remains in the test suite as a compiler contract test. It is deliberately not loaded into the production generation function, keeping the server bundle small without weakening diagram validation or browser safety.

## State

- **Successful public and private generations:** object storage keyed by repository, with private artifacts namespaced by an HMAC of the caller token
- **Complimentary quota and active cancellation tokens:** Redis
- **Terminal failures without a saved artifact:** short-lived Redis state
- **Concurrent writes:** distributed lock plus newest-session-wins persistence
