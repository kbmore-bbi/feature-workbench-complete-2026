#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_DEV_ORIGIN="${BACKEND_DEV_ORIGIN:-http://127.0.0.1:${BACKEND_PORT}}"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if [[ -d "${ROOT_DIR}/.venv" ]]; then
  PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
elif [[ -n "${VIRTUAL_ENV:-}" ]]; then
  PYTHON_BIN="${VIRTUAL_ENV}/bin/python"
else
  PYTHON_BIN="$(command -v python3)"
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Python interpreter not found."
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (cd "${ROOT_DIR}/frontend" && npm install)
fi

echo "Starting backend on http://127.0.0.1:${BACKEND_PORT}"
(
  cd "${ROOT_DIR}/backend"
  APP_ENV=local \
  APP_NAME="BBI AI Migration Workbench API" \
  APP_VERSION="0.1.0" \
  PORT="${BACKEND_PORT}" \
  CORS_ALLOWED_ORIGINS="http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT},http://127.0.0.1:8080,http://localhost:8080" \
  "${PYTHON_BIN}" -m uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" --reload
) &
BACKEND_PID=$!

echo "Starting frontend on http://127.0.0.1:${FRONTEND_PORT}"
(
  cd "${ROOT_DIR}/frontend"
  PORT="${FRONTEND_PORT}" \
  BACKEND_DEV_ORIGIN="${BACKEND_DEV_ORIGIN}" \
  NEXT_PUBLIC_APP_ENV=local \
  npm run dev
) &
FRONTEND_PID=$!

wait

