# Debian (glibc), not Alpine (musl): MP4 and poster renders run Chromium,
# which needs glibc.
FROM oven/bun:1.3.14-slim AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
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
RUN node node_modules/next/dist/bin/next build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Listen on every interface. Next then reports request URLs as 0.0.0.0, so
# renders call the server back on 127.0.0.1:$PORT instead (render-origin.ts;
# VIDEO_INTERNAL_ORIGIN overrides it).
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# @sparticuz/chromium only runs on Vercel and AWS Lambda, so off Vercel the
# renders launch Debian's Chromium. A container has no user namespaces for
# Chrome's sandbox and a small /dev/shm, as on Vercel, where the same two
# flags are set.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
ENV VIDEO_RENDER_CHROME_PATH=/usr/bin/chromium
ENV VIDEO_RENDER_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage"

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --create-home nextjs \
  && mkdir .next \
  && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
