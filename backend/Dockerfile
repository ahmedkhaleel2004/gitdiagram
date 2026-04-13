FROM oven/bun:1.3.11 AS bun-runtime
FROM python:3.14-slim

WORKDIR /app
ENV ENVIRONMENT=production
ENV PORT=8000

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

# Install pinned uv from PyPI to avoid depending on GHCR availability during deploys.
RUN pip install --no-cache-dir uv==0.11.2

# Copy dependency manifests first for better layer caching
COPY pyproject.toml uv.lock ./
COPY package.json ./
COPY bun.lock ./

# Install pinned runtime dependencies from uv lockfile
RUN uv sync --frozen --no-dev --no-install-project
RUN bun install --production --frozen-lockfile

# Copy application code
COPY . .
RUN chmod +x /app/entrypoint.sh && \
    sed -i 's/\r$//' /app/entrypoint.sh && \
    ls -la /app/entrypoint.sh

EXPOSE 8000

CMD ["/bin/bash", "/app/entrypoint.sh"]
