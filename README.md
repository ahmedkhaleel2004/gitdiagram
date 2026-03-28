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
- 🌐 **API Access**: Public API available for integration (WIP)

## ⚙️ Tech Stack

- **Frontend**: Next.js, TypeScript, Tailwind CSS, ShadCN
- **Backend**: FastAPI (Railway) or Next.js Route Handlers, selected explicitly via environment
- **Database**: PostgreSQL (with Drizzle ORM)
- **AI**: OpenAI or OpenRouter (via `AI_PROVIDER`)
- **Deployment**: Vercel (frontend) + Railway (backend)
- **CI/CD**: GitHub Actions
- **Analytics**: PostHog, Api-Analytics

## 🔄 Backend Architecture

GitDiagram supports two generation backends:
- `fastapi`: external FastAPI service (recommended for production and parity with Railway)
- `next`: Next.js Route Handlers inside this repo

Frontend routing is explicit:
- `NEXT_PUBLIC_GENERATION_BACKEND=fastapi` with `NEXT_PUBLIC_GENERATE_API_BASE_URL=https://<your-backend>/generate`
- or `NEXT_PUBLIC_GENERATION_BACKEND=next`

## 🤔 About

I created this because I wanted to contribute to open-source projects but quickly realized their codebases are too massive for me to dig through manually, so this helps me get started - but it's definitely got many more use cases!

Given any public (or private!) GitHub repository it generates diagrams in Mermaid.js with GPT-5-family models. The default setup uses GPT-5.4 mini through OpenAI, while self-hosted operators can optionally point the backend at OpenRouter via environment configuration.

I extract information from the file tree and README for details and interactivity (you can click components to be taken to relevant files and directories).

Most of what you might call the "processing" of this app is done with prompt engineering and a 3-step streaming pipeline in the FastAPI backend under `/backend`.

## 🔒 How to diagram private repositories

You can simply click on "Private Repos" in the header and follow the instructions by providing a GitHub personal access token with the `repo` scope.

You can also self-host this app locally (backend separated as well!) with the steps below.

## 🛠️ Self-hosting / Local Development

1. Clone the repository

```bash
git clone https://github.com/ahmedkhaleel2004/gitdiagram.git
cd gitdiagram
```

2. Install dependencies

```bash
pnpm i
```

3. Set up environment variables (create .env)

```bash
cp .env.example .env
```

Then edit the `.env` file with your backend AI credentials and optional GitHub personal access token.

Example local OpenRouter setup:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-5.4
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=GitDiagram
```

Example OpenAI setup:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

4. Start local database

```bash
chmod +x start-database.sh
./start-database.sh
```

When prompted to generate a random password, input yes.
The Postgres database will start in a container at `localhost:5432`

5. Initialize the database schema

```bash
pnpm db:push
```

You can view and interact with the database using `pnpm db:studio`

6. Run frontend

```bash
pnpm dev
```

You can now access the website at `localhost:3000`.

Run FastAPI backend (recommended if you want parity with production):

```bash
docker-compose up --build -d
docker-compose logs -f api
```

To use the FastAPI backend from the frontend, set:
- `NEXT_PUBLIC_GENERATION_BACKEND=fastapi`
- `NEXT_PUBLIC_GENERATE_API_BASE_URL=http://localhost:8000/generate`

To use the built-in Next.js Route Handlers instead, set:
- `NEXT_PUBLIC_GENERATION_BACKEND=next`

For a full machine setup guide (Node/Python/uv versions + verification), see `docs/dev-setup.md`.

Quick validation:

```bash
pnpm check
pnpm test
pnpm build
```

Railway backend docs: `docs/railway-backend.md`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgements

Shoutout to [Romain Courtois](https://github.com/cyclotruc)'s [Gitingest](https://gitingest.com/) for inspiration and styling

## 🤔 Future Steps

- Implement font-awesome icons in diagram
- Implement an embedded feature like star-history.com but for diagrams. The diagram could also be updated progressively as commits are made.
