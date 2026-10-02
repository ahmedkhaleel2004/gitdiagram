#!/usr/bin/env bash
# Builds and deploys the site to Cloudflare Workers: the Worker every request
# reaches (`gitdiagram`, wrangler.jsonc: routing, page cache, static files)
# and the Next.js server behind it, twice: `gitdiagram-server`
# (wrangler.server.jsonc, in one place next to the data) and
# `gitdiagram-server-local` (wrangler.server-local.jsonc, where the visitor
# is, for diagram streams). They always ship together, from one build.
#
#   bun run cf:deploy            build, upload prerendered pages to R2, deploy
#   bun run cf:deploy --secrets  also (re)load every secret from CF_ENV_FILE
#   bun run cf:deploy --skip-build   deploy the .open-next/ already built
#   CF_SKIP_CACHE_POPULATE=1         deploy without uploading prerendered pages
#   CF_FRONT_CONFIG, CF_SERVER_CONFIGS  other wrangler configs (a test set)
#   CF_NO_CONTAINERS=1               the front config has no containers
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

front_config="${CF_FRONT_CONFIG:-wrangler.jsonc}"
# Space-separated when given.
read -r -a server_configs <<<"${CF_SERVER_CONFIGS:-wrangler.server.jsonc wrangler.server-local.jsonc}"

# The deploy builds the render containers' image (the repo's Dockerfile).
if [[ -z "${CF_NO_CONTAINERS:-}" ]] && ! docker info >/dev/null 2>&1; then
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
# wrangler would otherwise hand a Next.js project to OpenNext's own deploy.
export OPEN_NEXT_DEPLOY=true
worker_name() { sed -nE 's/^ *"name": *"([^"]+)".*/\1/p' "$1" | head -1; }

# 1. The servers (the Next.js server, and its copy that runs diagram streams
#    where the visitor is). A new version of each is uploaded without
#    traffic, next to the one serving; the new front pins its requests to
#    them (the Cloudflare-Workers-Version-Overrides header,
#    cloudflare/worker.ts), so during the rollout a page is always routed and
#    rendered by one build.
overrides=""
staged=()
for server_config in "${server_configs[@]}"; do
  if current="$(bunx wrangler deployments status -c "$server_config" --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).versions.sort((a,b)=>b.percentage-a.percentage)[0];process.stdout.write(v.version_id)})')" &&
    [[ -n "$current" ]]; then
    upload="$(bunx wrangler versions upload -c "$server_config" \
      --var "GIT_COMMIT_SHA:$commit" --message "$commit" 2>&1 | tee /dev/stderr)"
    server_version="$(grep -oE 'Worker Version ID: [0-9a-f-]+' <<<"$upload" | awk '{print $4}')"
    [[ -n "$server_version" ]] || { echo "No server version id in wrangler's output." >&2; exit 1; }
    bunx wrangler versions deploy "$current@100%" "$server_version@0%" -y \
      -c "$server_config" --message "staged $commit"
    staged+=("$server_config=$server_version")
  else
    # The first deploy: nothing is serving yet.
    first="$(bunx wrangler deploy -c "$server_config" \
      --var "GIT_COMMIT_SHA:$commit" 2>&1 | tee /dev/stderr)"
    server_version="$(grep -oE 'Current Version ID: [0-9a-f-]+' <<<"$first" | awk '{print $4}')"
  fi
  overrides+="${overrides:+, }$(worker_name "$server_config")=\"$server_version\""
done

# 2. The front: prerendered pages into R2 (unless the build had no data
#    behind them), then the Worker itself, which goes live at once.
if [[ -z "${CF_SKIP_CACHE_POPULATE:-}" ]]; then
  bunx opennextjs-cloudflare populateCache remote -c "$front_config"
fi
bunx wrangler deploy -c "$front_config" \
  --var "GIT_COMMIT_SHA:$commit" \
  --var "SERVER_VERSION_OVERRIDE:$overrides"

# 3. The new servers take all traffic (the old front's last requests too).
for entry in "${staged[@]}"; do
  bunx wrangler versions deploy "${entry#*=}@100%" -y \
    -c "${entry%%=*}" --message "$commit"
done

if [[ " $* " == *" --secrets "* ]]; then
  for config in "${server_configs[@]}" "$front_config"; do
    node scripts/cf-secrets.mjs | bunx wrangler secret bulk -c "$config"
  done
fi
