[![Image](./docs/readme_img.png "GitDiagram Front Page")](https://gitdiagram.com/)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Kofi](https://img.shields.io/badge/Kofi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

# GitDiagram

Turn any GitHub repository into an interactive diagram for visualization in seconds.

You can also replace `hub` with `diagram` in any Github URL to access its diagram.

> **Sponsor slot:** Your devtool here. Reach developers who are actively exploring codebases with GitDiagram. [Sponsor GitDiagram](https://gitdiagram.com/sponsor).

> 🎁 **[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gitdiagram)** is a full-modal AI inference platform that gives developers a single AI API to access video generation, image generation, and LLM APIs. Instead of managing multiple vendor integrations, you connect once and get unified access to 300+ curated models across all modalities.
>
> Check out Atlas Cloud's new coding plan promotion for more budget-friendly API access: [https://www.atlascloud.ai/console/coding-plan](https://www.atlascloud.ai/console/coding-plan)

## 🚀 Features

- 👀 **Instant Visualization**: Convert any GitHub repository structure into a system design / architecture diagram
- 🎨 **Interactivity**: Click on components to navigate directly to source files and relevant directories
- ⚡ **Fast Generation**: Powered by GPT-5-family models, with OpenAI for user-supplied browser keys and optional self-hosted providers such as OpenRouter or [Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gitdiagram)
- 🖼️ **Export Options**: Copy Mermaid code or download the generated diagram as PNG

## ⚙️ Tech Stack

- **Frontend**: Next.js, TypeScript, Tailwind CSS, ShadCN
- **Backend**: FastAPI (Railway) or Next.js Route Handlers, selected explicitly via environment
- **Storage**: Cloudflare R2 (diagram artifacts) + Upstash Redis (quota and failure summaries)
- **AI**: OpenAI, OpenRouter, or [Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gitdiagram) (via `AI_PROVIDER`)
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

Given any public (or private!) GitHub repository it generates diagrams in Mermaid.js with GPT-5-family models. The default setup uses GPT-5.4 mini through OpenAI, while self-hosted operators can optionally point the backend at OpenRouter or [Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gitdiagram) via environment configuration.

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

For Atlas Cloud, set:

- `AI_PROVIDER=atlas`
- `ATLAS_API_KEY=...`
- `ATLAS_MODEL=deepseek-ai/DeepSeek-V3-0324`
- `ATLAS_BASE_URL=https://api.atlascloud.ai/v1`

Validated Atlas LLM pool for `ATLAS_MODEL`:

- `deepseek-ai/DeepSeek-V3-0324`, `deepseek-ai/deepseek-r1-0528`, `moonshotai/Kimi-K2-Instruct`, `Qwen/Qwen3-Coder`, `Qwen/Qwen3-235B-A22B-Instruct-2507`
- `deepseek-ai/DeepSeek-V3.1`, `moonshotai/Kimi-K2-Instruct-0905`, `Qwen/Qwen3-Next-80B-A3B-Instruct`, `Qwen/Qwen3-Next-80B-A3B-Thinking`, `Qwen/Qwen3-30B-A3B-Instruct-2507`
- `deepseek-ai/DeepSeek-V3.1-Terminus`, `deepseek-ai/DeepSeek-V3.2-Exp`, `zai-org/GLM-4.6`, `MiniMaxAI/MiniMax-M2`, `Qwen/Qwen3-VL-235B-A22B-Instruct`
- `moonshotai/Kimi-K2-Thinking`, `google/gemini-2.5-flash`, `google/gemini-2.5-flash-lite`, `openai/gpt-5.1`, `openai/gpt-5.1-chat`
- `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `openai/gpt-4.1-nano`
- `openai/o1`, `openai/o3`, `openai/o3-mini`, `openai/o4-mini`, `anthropic/claude-sonnet-4.5-20250929`
- `deepseek-ai/deepseek-v3.2`, `openai/gpt-5`, `openai/gpt-5-chat`, `openai/gpt-5-mini`, `openai/gpt-5-nano`
- `openai/gpt-5.2`, `openai/gpt-5.2-chat`, `google/gemini-2.5-pro`, `anthropic/claude-opus-4.5-20251101`, `google/gemini-3-flash-preview`
- `zai-org/glm-4.7`, `minimaxai/minimax-m2.1`, `google/gemini-2.0-flash`, `qwen/qwen3-8b`, `qwen/qwen3-235b-a22b-thinking-2507`
- `qwen/qwen3-vl-235b-a22b-thinking`, `qwen/qwen3-30b-a3b`, `qwen/qwen3-30b-a3b-thinking-2507`, `deepseek-ai/deepseek-ocr`, `xai/grok-4-0709`

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
