FROM python:3.12-slim

WORKDIR /app
ENV ENVIRONMENT=production
ENV PORT=8000

# Install uv inside the image
COPY --from=ghcr.io/astral-sh/uv:0.5.24 /uv /uvx /bin/

# Copy dependency manifests first for better layer caching
COPY pyproject.toml uv.lock ./

# Install pinned runtime dependencies from uv lockfile
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY . .
RUN chmod +x /app/entrypoint.sh && \
    sed -i 's/\r$//' /app/entrypoint.sh && \
    ls -la /app/entrypoint.sh

EXPOSE 8000

CMD ["/bin/bash", "/app/entrypoint.sh"]
