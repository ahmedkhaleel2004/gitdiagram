[![GitDiagram front page](./docs/readme_img.png)](https://gitdiagram.com/)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

# GitDiagram

Turn any public or private GitHub repository into an interactive architecture diagram in seconds.

You can also replace `hub` with `diagram` in a GitHub URL to open its diagram.

> **Sponsor slot:** Reach developers while they are actively exploring codebases. [Sponsor GitDiagram](https://gitdiagram.com/sponsor).

> 🎁 [Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gitdiagram) provides one API for hundreds of LLM, image, and video models. Its [coding plan](https://www.atlascloud.ai/console/coding-plan) offers a budget-oriented option for coding workloads.

## Features

- **Architecture-first diagrams:** converts a repository tree and README into a system-level graph instead of merely drawing folders.
- **Interactive source links:** click a component to open its real file or directory on GitHub.
- **Streaming generation:** see the explanation arrive while the graph is planned.
- **Private repositories:** provide a GitHub token locally in the browser; private artifacts use a separate protected storage namespace.
- **Export:** copy Mermaid source or download the rendered diagram as PNG.
- **Provider choice:** OpenAI by default, with OpenRouter and Atlas Cloud available for self-hosted deployments.

## Stack

- **Application:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, and Radix UI
- **Generation API:** same-origin Next.js Route Handlers running on Vercel's Node.js runtime
- **Storage:** Cloudflare R2 for diagram artifacts
- **Coordination:** Upstash Redis for quota accounting, cancellation, locks, and short-lived failure state
- **AI:** OpenAI, OpenRouter, or Atlas Cloud through `AI_PROVIDER`
- **Analytics:** PostHog
- **Deployment:** one Vercel project

There is no separate FastAPI, Railway, Postgres, or Neon runtime.

## Production architecture

Vercel serves both the UI and the generation endpoints:

- `/api/generate/cost` estimates a run after bounded GitHub ingestion.
- `/api/generate/stream` streams Server-Sent Events for explanation and graph progress.
- `/api/generate/cancel` records authenticated, same-origin cancellation signals.
- `/api/diagram-state` reads and writes the persisted result contract.
- `/api/healthz` provides a lightweight deployment health check.

Long-running generation uses a 300-second Vercel function budget with a shorter application deadline so quota reconciliation and persistence still have time to finish. Requests use explicit upstream deadlines, retries, structured logs, heartbeats, and distributed cancellation rather than process-local state.

## How generation works

1. GitDiagram fetches the repository's default branch, recursive tree, and README through the GitHub API. Truncated trees and oversized inputs are rejected before model work begins.
2. The first model stage streams a plain-English architecture explanation.
3. The second stage returns a strict, size-bounded graph AST: groups, nodes, edges, shapes, labels, descriptions, and repository paths.
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

For Atlas Cloud:

```dotenv
AI_PROVIDER=atlas
ATLAS_API_KEY=...
ATLAS_MODEL=deepseek-ai/DeepSeek-V3-0324
ATLAS_BASE_URL=https://api.atlascloud.ai/v1
```

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
