# Railway Backend Deploy Guide

This guide deploys only the FastAPI backend from this monorepo.

## 1) Create the Railway service

1. In Railway, create a new project from this GitHub repo.
2. In the service settings, set **Root Directory** to `backend`.
3. Keep Docker build enabled (it will use `backend/Dockerfile`).

## 2) Configure environment variables

Required:
- `OPENAI_API_KEY`

Optional:
- `API_ANALYTICS_KEY`
- `CORS_ORIGINS` (comma-separated list, example: `https://gitdiagram.com,https://your-frontend.vercel.app`)
- `ENVIRONMENT=production` (defaults to production if unset)
- `WEB_CONCURRENCY=2` (adjust based on plan/resources)

Do not set `PORT` manually unless needed. Railway injects it automatically.

## 3) Deploy and verify

1. Trigger a deploy.
2. Open logs and verify startup line includes `Binding to 0.0.0.0:<port>`.
3. Check health endpoint:
   - `GET /healthz`
   - expected JSON: `{"ok": true, "status": "ok"}`
