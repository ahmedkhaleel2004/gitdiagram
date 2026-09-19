[![GitDiagram front page](./docs/readme_img.png)](https://gitdiagram.com/)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

# GitDiagram

Turn any public or private GitHub repository into an interactive architecture diagram in seconds.

You can also replace `hub` with `diagram` in a GitHub URL to open its diagram.

> <a href="https://www.sent.dm/en?utm_source=gitdiagram&amp;utm_medium=sponsorship&amp;utm_campaign=sent_30_days&amp;utm_content=readme"><img src="./public/sponsors/sent-logo.png" alt="Sent" width="104" /></a>
>
> **Sponsored by Sent.** SMS, WhatsApp, and RCS through one API. [Try Sent →](https://www.sent.dm/en?utm_source=gitdiagram&utm_medium=sponsorship&utm_campaign=sent_30_days&utm_content=readme)

## Features

- **Architecture-first diagrams:** converts a repository tree, README, and bounded source excerpts into a system-level graph instead of merely drawing folders.
- **Interactive source links:** click a component to open its real file or directory on GitHub.
- **Streaming generation:** see the explanation arrive while the graph is planned.
- **Private repositories:** provide a GitHub token locally in the browser; private artifacts use a separate protected storage namespace.
- **Export:** copy Mermaid source or download the rendered diagram as PNG.
- **Provider choice:** OpenAI by default, with OpenRouter available for self-hosted deployments.

## Stack

- **Application:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, and Radix UI
- **Generation API:** same-origin Next.js Route Handlers running on Vercel's Bun runtime
- **Storage:** Cloudflare R2 for diagram artifacts
- **Coordination:** Upstash Redis for quota accounting, cancellation, locks, and short-lived failure state
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

The default managed OpenAI pipeline uses one GPT-5.6 Luna request at medium reasoning to produce a source-grounded graph and short streamed overview. The model returns a compact graph without redundant descriptions or type captions. Graphs are validated and compiled deterministically; additional Luna calls are reserved for structural repairs or one recovery after an 18-second slow request. The slow connection is cancelled before its replacement starts; its unavailable partial usage is included as an estimated cost. Managed GPT-5.6 requests explicitly use Fast mode (`service_tier: "priority"`); estimates include its premium, and final costs use the model and tier actually served. User-supplied keys retain standard service and their configured model. Explicit model overrides and OpenRouter retain the two-stage pipeline. Output token estimates reserve quota but do not cap provider output.

The same Next.js application can also build into a minimal, non-root standalone Docker image for Railway. No Railway service, source connection, or Railway domain is kept live. The checked-in `Dockerfile` and `railway.json` are a cold recovery recipe that can recreate the full application later without reviving a second backend implementation. See [docs/deployment-failover.md](docs/deployment-failover.md).

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

- **Successful public generations:** R2 object keyed by repository
- **Successful private generations:** separate R2 namespace derived with a server-side secret
- **Complimentary quota and active cancellation tokens:** Upstash Redis
- **Terminal failures without a saved artifact:** short-lived Upstash state
- **Concurrent writes:** distributed lock plus newest-session-wins persistence

## Private repositories

Select **Private Repos** in the header and provide a fine-grained GitHub personal access token that can read the target repository. The token is sent only with the relevant same-origin request and is never embedded in public diagram links.

## Local development

For exact prerequisites and environment details, see [docs/dev-setup.md](docs/dev-setup.md).

```bash
git clone https://github.com/ahmedkhaleel2004/gitdiagram.git
cd gitdiagram
bun install
cp .env.example .env
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

At minimum, configure R2, Upstash, and one AI provider in `.env`. A GitHub PAT or GitHub App is optional but strongly recommended for higher GitHub API limits.

Run the complete local gate before opening a pull request:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## Contributing

Contributions are welcome. Please open an issue or pull request with a focused description and verification notes.

## Acknowledgements

Inspired by [Romain Courtois](https://github.com/cyclotruc)'s [Gitingest](https://gitingest.com/).
