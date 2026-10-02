#!/usr/bin/env bash
# Builds the site for Cloudflare Workers (OpenNext) into .open-next/.
#
# NEXT_PUBLIC_* values, INDEXNOW_KEY and NEXT_PUBLIC_PRESENCE_URL are compiled
# in at build time, so the production environment must be present: in CI it
# comes from the job's env, locally from CF_ENV_FILE (see
# scripts/cf-secrets.mjs).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${CI:-}" || -n "${CF_ENV_FILE:-}" ]]; then
  eval "$(node scripts/cf-secrets.mjs --shell)"
fi

# Nothing Vercel injects may leak into a Cloudflare build: the app would
# believe it runs on Vercel.
while IFS= read -r name; do
  unset "$name"
done < <(env | grep -oE '^(VERCEL[A-Z0-9_]*|TURBO_[A-Z0-9_]*|NX_DAEMON)' || true)

bunx opennextjs-cloudflare build "$@"

# OpenNext copies the working tree's .env files into the bundle as fallback
# values. Runtime configuration comes only from the Worker's own secrets and
# vars, so a developer's local .env must never ship.
printf 'export const production = {};\nexport const development = {};\nexport const test = {};\n' \
  > .open-next/cloudflare/next-env.mjs
find .open-next -name '.env*' -type f -delete

# Pictures (next/og) read their fonts from the filesystem on Node; a Worker
# has none, so they ship as static assets (src/server/og/cards.tsx).
mkdir -p .open-next/assets/og-fonts
cp node_modules/geist/dist/fonts/geist-sans/Geist-{Regular,Medium,Bold}.ttf \
  .open-next/assets/og-fonts/
