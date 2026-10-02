#!/usr/bin/env bash
# Builds and deploys the site to Cloudflare Workers (worker `gitdiagram`).
#
#   bun run cf:deploy            build, upload prerendered pages to R2, deploy
#   bun run cf:deploy --secrets  also (re)load every secret from CF_ENV_FILE
#   bun run cf:deploy --skip-build   deploy the .open-next/ already built
#   CF_SKIP_CACHE_POPULATE=1         deploy without uploading prerendered pages
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
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -z "${CI:-}" ]]; then
  # wrangler 4.146 checks a stored `wrangler login`'s scopes even when a
  # token is set, and then refuses to deploy containers. Give it an empty
  # config home so only the token counts.
  XDG_CONFIG_HOME="$(mktemp -d)"
  export XDG_CONFIG_HOME
fi

# The deploy builds the render containers' image (the repo's Dockerfile).
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not reachable (start it, or run: sg docker -c 'bun run cf:deploy')." >&2
  exit 1
fi

if [[ " $* " != *" --skip-build "* ]]; then
  bash scripts/cf-build.sh
fi

# Tabs opened before this deploy still ask for the last builds' script and
# style files (Workers Assets only serves what this deploy uploads; Vercel's
# Skew Protection kept old deployments reachable). Keep each build's hashed
# files for a week and upload them alongside the new ones. Names are content
# hashes, so builds never collide.
history="${CF_STATIC_HISTORY:-.open-next-history}"
build_id="$(cat .open-next/assets/BUILD_ID)"
mkdir -p "$history/$build_id"
cp -R .open-next/assets/_next/static/. "$history/$build_id/"
touch "$history/$build_id"
find "$history" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +
# Newest first, at most ten builds.
ls -1t "$history" | tail -n +11 | while IFS= read -r old; do
  rm -rf "${history:?}/$old"
done
for build in "$history"/*/; do
  cp -Rn "$build." .open-next/assets/_next/static/
done

commit="$(git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"
if [[ -n "${CF_SKIP_CACHE_POPULATE:-}" ]]; then
  # A build without the production secrets (CI) prerendered its pages with no
  # data behind them. Leave them out of the cache: the Worker renders each
  # page with real data on its first request instead.
  OPEN_NEXT_DEPLOY=true bunx wrangler deploy --var "GIT_COMMIT_SHA:$commit"
else
  bunx opennextjs-cloudflare deploy -- --var "GIT_COMMIT_SHA:$commit"
fi

if [[ " $* " == *" --secrets "* ]]; then
  node scripts/cf-secrets.mjs | bunx wrangler secret bulk
fi
