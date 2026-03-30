# Railway Backend Deploy Guide

This guide deploys the production FastAPI backend from this monorepo.

The backend is intentionally mixed-runtime: FastAPI handles generation, and Mermaid syntax validation shells out to `backend/scripts/validate_mermaid.mjs`, so the deploy environment must support both Python and Bun.

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
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BUCKET`
- `R2_PRIVATE_BUCKET`
- `CACHE_KEY_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `AI_PROVIDER`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`

Recommended:
- `OPENAI_MODEL=gpt-5.4-mini` when `AI_PROVIDER=openai`
- `OPENAI_COMPLIMENTARY_GATE_ENABLED=true` if you want Railway to stop default-key requests at the daily complimentary mini-token limit
- `OPENAI_COMPLIMENTARY_DAILY_LIMIT_TOKENS=10000000` when the complimentary gate is enabled
- `OPENAI_COMPLIMENTARY_MODEL_FAMILY=gpt-5.4-mini` when the complimentary gate is enabled
- `OPENROUTER_MODEL=openai/gpt-5.4` when `AI_PROVIDER=openrouter`
- `ENVIRONMENT=production`
- `WEB_CONCURRENCY=2`
- `CORS_ORIGINS=https://gitdiagram.com,https://www.gitdiagram.com,https://<your-vercel-domain>`

Optional:
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `GITHUB_PAT` (higher GitHub API rate limits for repository fetches)
- `GITHUB_CLIENT_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_INSTALLATION_ID`
- `API_ANALYTICS_KEY`

Set variables via CLI:

```bash
railway variables --service gitdiagram-api --set "R2_ACCOUNT_ID=..."
railway variables --service gitdiagram-api --set "R2_ACCESS_KEY_ID=..."
railway variables --service gitdiagram-api --set "R2_SECRET_ACCESS_KEY=..."
railway variables --service gitdiagram-api --set "R2_PUBLIC_BUCKET=..."
railway variables --service gitdiagram-api --set "R2_PRIVATE_BUCKET=..."
railway variables --service gitdiagram-api --set "CACHE_KEY_SECRET=..."
railway variables --service gitdiagram-api --set "UPSTASH_REDIS_REST_URL=..."
railway variables --service gitdiagram-api --set "UPSTASH_REDIS_REST_TOKEN=..."
railway variables --service gitdiagram-api --set "AI_PROVIDER=openai"
railway variables --service gitdiagram-api --set "OPENAI_API_KEY=..."
railway variables --service gitdiagram-api --set "OPENAI_MODEL=gpt-5.4-mini"
railway variables --service gitdiagram-api --set "ENVIRONMENT=production"
railway variables --service gitdiagram-api --set "WEB_CONCURRENCY=2"
railway variables --service gitdiagram-api --set "CORS_ORIGINS=https://gitdiagram.com,https://www.gitdiagram.com,https://<your-vercel-domain>"
```

Important:
- Set the R2 and Upstash credentials on the Railway backend service itself. Vercel environment variables are not shared with Railway.
- If `OPENAI_COMPLIMENTARY_GATE_ENABLED=true`, the backend must have the Upstash Redis REST credentials because complimentary quota reservations are stored there.

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

- `NEXT_PUBLIC_GENERATION_BACKEND=fastapi`
- `NEXT_PUBLIC_GENERATE_API_BASE_URL=https://<your-railway-domain>/generate`

Then redeploy Vercel.

## 7) Verify

1. Health endpoint:
   - `GET https://<your-railway-domain>/healthz`
   - expected JSON: `{"ok": true, "status": "ok"}`
2. Open your frontend and generate a diagram.
3. Check Railway logs:

```bash
railway logs --service gitdiagram-api
```
