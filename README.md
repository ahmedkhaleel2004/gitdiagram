[![Image](./docs/readme_img.png "GitDiagram Front Page")](https://gitdiagram.com/)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Kofi](https://img.shields.io/badge/Kofi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

# GitDiagram

Turn any GitHub repository into an interactive diagram for visualization in seconds.

You can also replace `hub` with `diagram` in any Github URL to access its diagram.

## 🚀 Features

- 👀 **Instant Visualization**: Convert any GitHub repository structure into a system design / architecture diagram
- 🎨 **Interactivity**: Click on components to navigate directly to source files and relevant directories
- ⚡ **Fast Generation**: Powered by OpenAI o4-mini for quick and accurate diagrams
- 🖼️ **Export Options**: Copy Mermaid code or download the generated diagram as PNG
- 🌐 **API Access**: Public API available for integration (WIP)

## ⚙️ Tech Stack

- **Frontend**: Next.js, TypeScript, Tailwind CSS, ShadCN
- **Backend**: FastAPI, Python, Server Actions
- **Database**: PostgreSQL (with Drizzle ORM)
- **AI**: OpenAI o4-mini
- **Deployment**: Vercel (Frontend), Railway/EC2 (Backend)
- **CI/CD**: GitHub Actions
- **Analytics**: PostHog, Api-Analytics

## 🤔 About

I created this because I wanted to contribute to open-source projects but quickly realized their codebases are too massive for me to dig through manually, so this helps me get started - but it's definitely got many more use cases!

Given any public (or private!) GitHub repository it generates diagrams in Mermaid.js with OpenAI's o4-mini! (Previously Claude 3.5 Sonnet)

I extract information from the file tree and README for details and interactivity (you can click components to be taken to relevant files and directories)

Most of what you might call the "processing" of this app is done with prompt engineering - see `/backend/app/prompts.py`. This basically extracts and pipelines data and analysis for a larger action workflow, ending in the diagram code.

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
cd backend && uv sync --no-install-project && cd ..
```

3. Set up environment variables (create .env)

```bash
cp .env.example .env
```

Then edit the `.env` file with your OpenAI API key and optional GitHub personal access token.

4. Run backend

```bash
docker-compose up --build -d
```

Logs available at `docker-compose logs -f`
The FastAPI server will be available at `localhost:8000`

Or run backend directly from repo root:

```bash
pnpm dev:backend
```

5. Start local database

```bash
chmod +x start-database.sh
./start-database.sh
```

When prompted to generate a random password, input yes.
The Postgres database will start in a container at `localhost:5432`

6. Initialize the database schema

```bash
pnpm db:push
```

You can view and interact with the database using `pnpm db:studio`

7. Run Frontend

```bash
pnpm dev
```

You can now access the website at `localhost:3000`.

For a full machine setup guide (Node/Python/uv versions + verification), see `docs/dev-setup.md`.

Quick validation:

```bash
pnpm check
pnpm test
cd backend && uv run pytest -q
```

## 🚂 Deploy Backend on Railway

1. Create a new Railway service from this repo and set **Root Directory** to `backend`.
2. Use the existing `backend/Dockerfile` (no extra build config needed).
3. Add env vars in Railway:
- `OPENAI_API_KEY` (required)
- `API_ANALYTICS_KEY` (optional)
- `CORS_ORIGINS` (optional comma-separated list, example: `https://gitdiagram.com,https://your-frontend.vercel.app`)
- `ENVIRONMENT=production` (optional, defaults to production)
4. Deploy. Railway will inject `PORT`; backend now auto-binds to `0.0.0.0:$PORT`.
5. Verify health check: `GET /healthz`.
6. Full guide: `docs/railway-backend.md`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgements

Shoutout to [Romain Courtois](https://github.com/cyclotruc)'s [Gitingest](https://gitingest.com/) for inspiration and styling

## 🤔 Future Steps

- Implement font-awesome icons in diagram
- Implement an embedded feature like star-history.com but for diagrams. The diagram could also be updated progressively as commits are made.
