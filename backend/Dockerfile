# Use Python 3.12 slim image for smaller size
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV POETRY_CACHE_DIR=/app/.cache

RUN pip install --upgrade pip \
    && pip install poetry

# Set working directory
WORKDIR /app

# Copy pyproject.toml and poetry.lock first to leverage Docker cache
COPY pyproject.toml poetry.lock* /app/

# Install dependencies
RUN poetry install --no-interaction --no-ansi --no-root

# Copy application code
COPY . .

# Create and set permissions for entrypoint script
COPY entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh && \
    # Ensure the script uses Unix line endings
    sed -i 's/\r$//' /app/entrypoint.sh && \
    # Double check permissions
    ls -la /app/entrypoint.sh

# Expose port
EXPOSE 8000

# Use entrypoint script
CMD ["/bin/bash", "/app/entrypoint.sh"]
