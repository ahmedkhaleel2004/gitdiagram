# Railway Backend Deploy Guide

This guide deploys the production FastAPI backend from this monorepo.

## 1) Prerequisites

- Railway account + project access
- Railway CLI installed
- Logged in locally:

```bash
railway login
```

## 2) Create/link the Railway service

You can use dashboard or CLI. CLI flow:

```bash
cd /path/to/gitdiagram
railway init -n gitdiagram
railway add --service gitdiagram-api
railway link --service gitdiagram-api
```

## 3) Set backend environment variables

Required:
- `OPENAI_API_KEY`

Recommended:
- `OPENAI_MODEL=gpt-5-mini`
- `ENVIRONMENT=production`
- `WEB_CONCURRENCY=2`
- `CORS_ORIGINS=https://gitdiagram.com,https://www.gitdiagram.com,https://<your-vercel-domain>`

Optional:
- `GITHUB_PAT` (higher GitHub API rate limits for repository fetches)
- `GITHUB_CLIENT_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_INSTALLATION_ID`
- `API_ANALYTICS_KEY`

Set variables via CLI:

```bash
railway variables --service gitdiagram-api --set "OPENAI_API_KEY=..."
railway variables --service gitdiagram-api --set "OPENAI_MODEL=gpt-5-mini"
railway variables --service gitdiagram-api --set "ENVIRONMENT=production"
railway variables --service gitdiagram-api --set "WEB_CONCURRENCY=2"
railway variables --service gitdiagram-api --set "CORS_ORIGINS=https://gitdiagram.com,https://www.gitdiagram.com,https://<your-vercel-domain>"
```

Do not set `PORT` manually unless needed. Railway injects it automatically.

## 4) Deploy backend from `backend/`

```bash
cd /path/to/gitdiagram
railway up --service gitdiagram-api --path-as-root backend
```

## 5) Create a public Railway domain

```bash
railway domain --service gitdiagram-api
```

Copy the generated URL, for example:
`https://gitdiagram-api-production-xxxx.up.railway.app`

## 6) Point Vercel frontend to Railway backend

In your Vercel project environment variables, set:

- `NEXT_PUBLIC_USE_LEGACY_BACKEND=true`
- `NEXT_PUBLIC_API_DEV_URL=https://<your-railway-domain>`

Then redeploy Vercel.

Note: the variable name includes "LEGACY" for backward compatibility, but this is now the primary external backend path.

## 7) Verify

1. Health endpoint:
   - `GET https://<your-railway-domain>/healthz`
   - expected JSON: `{"ok": true, "status": "ok"}`
2. Open your frontend and generate a diagram.
3. Check Railway logs:

```bash
railway logs --service gitdiagram-api
```
