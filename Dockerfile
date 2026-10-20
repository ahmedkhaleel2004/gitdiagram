# Debian (glibc), not Alpine (musl): MP4 and poster renders run Chromium,
# which needs glibc.
FROM oven/bun:1.3.14-slim AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile

# Turbopack's build cache from the last image build, when the deploy passes
# one in (--build-context next-cache=<dir>, scripts/cf-container-image.mjs);
# empty otherwise.
FROM scratch AS next-cache

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV RAILWAY_DOCKER_BUILD=1

# NEXT_PUBLIC_* values are compiled into the client at build time, and .env
# files never reach the image, so they come in as build arguments (Railway
# passes a service variable to every ARG of the same name). Without them the
# video controls build switched off and live presence unset.
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_PRESENCE_URL
ARG NEXT_PUBLIC_VIDEO_EXPLAINER
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_PRESENCE_URL=$NEXT_PUBLIC_PRESENCE_URL
ENV NEXT_PUBLIC_VIDEO_EXPLAINER=$NEXT_PUBLIC_VIDEO_EXPLAINER

# Match the standalone runtime. Bun's Linux ARM64 worker can crash while Next
# runs its TypeScript build; Bun still handles the frozen dependency install.
# Types are checked by the deploy's own build (scripts/cf-build.sh), not here.
# The dependencies are mounted for the build rather than copied in (a
# gigabyte, about 13 s); the standalone output traces what it needs from them.
RUN --mount=type=bind,from=dependencies,source=/app/node_modules,target=/app/node_modules,rw \
  --mount=type=bind,from=next-cache,target=/tmp/next-cache \
  mkdir -p .next/cache && cp -a /tmp/next-cache/. .next/cache/ \
  && node scripts/build-mcp-app.mjs \
  && NEXT_SKIP_TYPECHECK=1 node node_modules/next/dist/bin/next build

# The cache this build leaves, for the next one (--target next-cache-out).
FROM scratch AS next-cache-out
COPY --from=builder /app/.next/cache /

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Listen on every interface. Next then reports request URLs as 0.0.0.0, so
# renders call the server back on 127.0.0.1:$PORT instead (render-origin.ts;
# VIDEO_INTERNAL_ORIGIN overrides it).
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# On SIGTERM (a deploy, or the platform putting an idle instance to sleep)
# the server finishes renders and videos in flight before it exits, instead
# of Next's default of refusing new connections at once (src/server/drain.ts).
ENV NEXT_MANUAL_SIG_HANDLE=1

# Renders launch Debian's Chromium. A container has no user namespaces for
# Chrome's sandbox and a small /dev/shm, hence the two flags below. The films
# bring their own fonts; the system ones only cover
# what those lack, which otherwise renders as empty boxes: emoji, Chinese,
# Japanese and Korean text, and (fonts-noto-core) Arabic, Hebrew, Thai and
# the Indian scripts, all of which stored videos contain. tini is the init
# process (see ENTRYPOINT).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-noto-core \
    tini \
  && rm -rf /var/lib/apt/lists/*
ENV VIDEO_RENDER_CHROME_PATH=/usr/bin/chromium
ENV VIDEO_RENDER_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage"

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --create-home nextjs \
  && mkdir .next \
  && chown nextjs:nodejs .next

# --link makes each copy a layer of its own, so a cached build can push the
# app without first fetching the Chromium layer beneath it. Linked copies
# cannot look up names, hence the numeric nextjs:nodejs.
COPY --link --from=builder --chown=1001:1001 /app/public ./public
COPY --link --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --link --from=builder --chown=1001:1001 /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Every render leaves Chromium helper processes behind for process 1 to reap.
# Node does not, so they piled up as zombies until the container restarted;
# tini reaps them and passes signals on to the server.
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
