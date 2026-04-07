[![Image](./docs/readme_img.png "GitDiagram Front Page")](https://gitdiagram.com/)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Kofi](https://img.shields.io/badge/Kofi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

# GitDiagram

Turn any GitHub repository into an interactive diagram for visualization in seconds.

You can also replace `hub` with `diagram` in any Github URL to access its diagram.

## 🚀 Features

- 👀 **Instant Visualization**: Convert any GitHub repository structure into a system design / architecture diagram
- 🎨 **Interactivity**: Click on components to navigate directly to source files and relevant directories
- ⚡ **Fast Generation**: Powered by GPT-5-family models, with OpenAI for user-supplied browser keys and optional OpenRouter for self-hosted deployments
- 🖼️ **Export Options**: Copy Mermaid code or download the generated diagram as PNG

## ⚙️ Tech Stack

- **Frontend**: Next.js, TypeScript, Tailwind CSS, ShadCN
- **Backend**: FastAPI (Railway) or Next.js Route Handlers, selected explicitly via environment
- **Storage**: Cloudflare R2 (diagram artifacts) + Upstash Redis (quota and failure summaries)
- **AI**: OpenAI or OpenRouter (via `AI_PROVIDER`)
- **Deployment**: Vercel (frontend) + Railway (backend)
- **CI/CD**: GitHub Actions
- **Analytics**: PostHog, Api-Analytics

## 🧭 Production Architecture

- **Vercel** serves the Next.js frontend
- **Railway** runs the long-lived FastAPI generation backend in production
- **Cloudflare R2** stores successful diagram artifacts
- **Upstash Redis** stores complimentary quota state and short-lived terminal failure summaries
- **OpenAI `gpt-5.4-mini`** is the default server-side generation model

There is no Postgres or Neon runtime path anymore.

## 🔄 Generation Backends

GitDiagram supports two generation backends:
- `fastapi`: external FastAPI service
- `next`: in-repo Next.js Route Handlers that validate Mermaid in-process and can be deployed on Vercel with the checked-in Bun runtime config

Frontend routing is explicit:
- `NEXT_PUBLIC_GENERATION_BACKEND=fastapi` with `NEXT_PUBLIC_GENERATE_API_BASE_URL=https://<your-backend>/generate` for the production-style path
- or `NEXT_PUBLIC_GENERATION_BACKEND=next`

## 🗂️ Where State Lives

- **Successful generations**: R2 object per repo artifact
- **Terminal failures with no saved artifact**: Upstash Redis TTL summary
- **Complimentary daily quota**: Upstash Redis hash
- **Private repo persistence**: separate R2 namespace derived from the provided GitHub token

## 🤔 About

I created this because I wanted to contribute to open-source projects but quickly realized their codebases are too massive for me to dig through manually, so this helps me get started - but it's definitely got many more use cases!

Given any public (or private!) GitHub repository it generates diagrams in Mermaid.js with GPT-5-family models. The default setup uses GPT-5.4 mini through OpenAI, while self-hosted operators can optionally point the backend at OpenRouter via environment configuration.

## ⚙️ How GitDiagram Works

When you submit a GitHub repo URL, GitDiagram asks the GitHub API for the repo's default branch, a recursive file tree, and the README, while filtering out noisy assets and dependency folders. It feeds that repo snapshot into a streamed generation pipeline where one model pass writes a plain-English architecture explanation and a second pass turns that explanation plus the file tree into a structured graph of systems, nodes, edges, and real repo paths.

That graph is validated against the actual file tree, retried with feedback if it contains bad paths or invalid connections, then compiled into Mermaid and validated again before it is shown. Any node tied to a real path becomes clickable back to GitHub, and the final explanation, graph, diagram, and terminal generation state are stored in Cloudflare R2 and Upstash Redis so the app can reopen an existing result or show where a run failed.

One implementation detail worth knowing: the Next backend validates Mermaid in-process in [`src/server/generate/mermaid-validator.ts`](/Users/ahmedkhaleel/repos/gitdiagram/src/server/generate/mermaid-validator.ts), while the FastAPI backend invokes the thin Bun wrapper in [`backend/scripts/validate_mermaid.mjs`](/Users/ahmedkhaleel/repos/gitdiagram/backend/scripts/validate_mermaid.mjs) backed by [`backend/lib/mermaid-validator.ts`](/Users/ahmedkhaleel/repos/gitdiagram/backend/lib/mermaid-validator.ts). Both use the same Mermaid + DOMPurify bootstrap approach, so the Railway backend runtime remains intentionally mixed Python + Bun.

## 🔒 How to diagram private repositories

You can simply click on "Private Repos" in the header and follow the instructions by providing a GitHub personal access token with the `repo` scope.

You can also self-host this app locally (backend separated as well!) with the steps below.

## 🛠️ Self-hosting / Local Development

For exact tool versions, machine setup, and verification, see `docs/dev-setup.md`.

1. Clone the repository

```bash
git clone https://github.com/ahmedkhaleel2004/gitdiagram.git
cd gitdiagram
```

2. Install root dependencies

```bash
bun install
```

3. Install backend FastAPI-side dependencies

```bash
bun run install:backend
```

This keeps the backend's Python environment managed by `uv` and installs the backend Mermaid validator's Bun dependencies from `backend/bun.lock`.

4. Set up environment variables (create .env)

```bash
cp .env.example .env
```

Then edit the `.env` file with your backend AI credentials and optional GitHub personal access token.

Use `.env.example` as the canonical list of required and optional variables.

5. Run the frontend

```bash
bun run dev
```

You can now access the website at `localhost:3000`.

This is the simplest local mode and works with:
- `NEXT_PUBLIC_GENERATION_BACKEND=next`

Run FastAPI backend only if you want production parity:

```bash
docker-compose up --build -d
docker-compose logs -f api
```

To use the FastAPI backend from the frontend, set:
- `NEXT_PUBLIC_GENERATION_BACKEND=fastapi`
- `NEXT_PUBLIC_GENERATE_API_BASE_URL=http://localhost:8000/generate`

To use the built-in Next.js Route Handlers instead, set:
- `NEXT_PUBLIC_GENERATION_BACKEND=next`

Quick validation:

```bash
bun run check
bun run test
bun run build
```

Railway backend docs: `docs/railway-backend.md`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgements

Shoutout to [Romain Courtois](https://github.com/cyclotruc)'s [Gitingest](https://gitingest.com/) for inspiration and styling
