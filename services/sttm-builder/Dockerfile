ARG PYTHON_BASE_IMAGE=public.ecr.aws/docker/library/python:3.12-slim
ARG INSTALL_CORTEX_CLI=0
FROM ${PYTHON_BASE_IMAGE} AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_NO_CACHE=1 \
    PORT=8000 \
    APP_MODULE=app.main:app \
    UVICORN_LOOP=auto \
    PATH="/app/.venv/bin:/root/.local/bin:$PATH" \
    CORTEX_CODE_CLI_PATH="/root/.local/bin/cortex"

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && if [ "${INSTALL_CORTEX_CLI}" = "1" ]; then \
         curl -LsS https://ai.snowflake.com/static/cc-scripts/install.sh | sh \
         && test -x /root/.local/bin/cortex; \
       fi \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app
COPY knowledge ./knowledge

EXPOSE 8000

CMD ["sh", "-c", "uvicorn ${APP_MODULE} --host 0.0.0.0 --port ${PORT} --loop ${UVICORN_LOOP}"]
