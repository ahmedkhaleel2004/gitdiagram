# GitDiagram

Turn any public or private GitHub repository into an interactive architecture diagram.

**[Try GitDiagram →](https://gitdiagram.com/)** · Or replace `hub` with `diagram` in any GitHub repository URL.

[![GitDiagram front page](./docs/readme_img.png)](https://gitdiagram.com/)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

> <a href="https://gitdiagram.com/out/sent-2026-09?placement=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="./public/sponsors/sent-logo-dark.svg" /><img src="./public/sponsors/sent-logo.png" alt="Sent" width="104" align="middle" /></picture></a>&nbsp;&nbsp; <sub>Sponsored</sub>
>
> SMS, WhatsApp, and RCS through one API. [Try Sent →](https://gitdiagram.com/out/sent-2026-09?placement=readme)

## Features

- **Explore the architecture** with an AI-generated diagram and streamed explanation.
- **Jump to the code** by clicking any component's linked file or directory.
- **Use private repositories** with a GitHub token via **Private Repos** in the header.
- **Export diagrams** as PNG or copy the Mermaid source.

## Run locally

Requires [Bun](https://bun.sh/), Cloudflare R2, Upstash Redis, and an OpenAI or OpenRouter API key. See the [setup guide](docs/dev-setup.md) for prerequisites and configuration.

```bash
git clone https://github.com/ahmedkhaleel2004/gitdiagram.git
cd gitdiagram
bun install
cp .env.example .env
```

Fill in `.env` using the [configuration guide](docs/dev-setup.md#configure), then start the app:

```bash
bun run dev
```

Open [localhost:3000](http://localhost:3000).

## Development

Built with Next.js, React, TypeScript, Tailwind CSS, and Mermaid. Deployed on Vercel.

- [Architecture](docs/architecture.md) — generation pipeline, storage, and API
- [Development guide](docs/dev-setup.md) — setup, checks, and deployment
- [Deployment recovery](docs/deployment-failover.md) — Railway/Docker fallback

Contributions are welcome. Open an issue or pull request with a focused description and [verification notes](docs/dev-setup.md#verify).

Inspired by [Romain Courtois](https://github.com/cyclotruc)'s [Gitingest](https://gitingest.com/).
