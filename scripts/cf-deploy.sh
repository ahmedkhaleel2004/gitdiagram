#!/usr/bin/env bash
# Builds and deploys the site to Cloudflare Workers (worker `gitdiagram`).
#
#   bun run cf:deploy            build, upload prerendered pages to R2, deploy
#   bun run cf:deploy --secrets  also (re)load every secret from CF_ENV_FILE
#   bun run cf:deploy --skip-build   deploy the .open-next/ already built
#
# Needs CLOUDFLARE_API_TOKEN (CI) or the token file / a wrangler login.
set -euo pipefail
cd "$(dirname "$0")/.."

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-8a4f309f2639721dc9f4f0d1790fd6d5}"
token_file="$HOME/.config/gitdiagram/cloudflare-api-token"
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -f "$token_file" ]]; then
  CLOUDFLARE_API_TOKEN="$(cat "$token_file")"
  export CLOUDFLARE_API_TOKEN
fi

if [[ " $* " != *" --skip-build "* ]]; then
  bash scripts/cf-build.sh
fi

commit="$(git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"
bunx opennextjs-cloudflare deploy -- --var "GIT_COMMIT_SHA:$commit"

if [[ " $* " == *" --secrets "* ]]; then
  node scripts/cf-secrets.mjs | bunx wrangler secret bulk
fi
