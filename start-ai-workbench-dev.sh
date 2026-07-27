#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
COCO_PORT="${COCO_PORT:-8001}"
BACKEND_DEV_ORIGIN="${BACKEND_DEV_ORIGIN:-http://127.0.0.1:${BACKEND_PORT}}"
# Set COCO_ENABLED=true to start the CoCo deep-agent service
COCO_ENABLED="${COCO_ENABLED:-false}"

free_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti tcp:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  fi

  if [[ -z "${pids}" ]]; then
    return 0
  fi

  echo "Stopping existing process(es) on port ${port}: ${pids}"
  kill ${pids} 2>/dev/null || true
  sleep 1

  local remaining=""
  if command -v lsof >/dev/null 2>&1; then
    remaining="$(lsof -ti tcp:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  fi

  if [[ -n "${remaining}" ]]; then
    echo "Force stopping remaining process(es) on port ${port}: ${remaining}"
    kill -9 ${remaining} 2>/dev/null || true
    sleep 1
  fi
}

cleanup_stale_next_lock() {
  local lock_file="${ROOT_DIR}/frontend/.next/dev/lock"
  local lock_pid=""

  if [[ ! -f "${lock_file}" ]]; then
    return 0
  fi

  lock_pid="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "${lock_file}" | head -1)"
  if [[ -n "${lock_pid}" ]] && kill -0 "${lock_pid}" 2>/dev/null; then
    echo "Next.js dev lock is owned by active PID ${lock_pid}; leaving it in place."
    return 0
  fi

  echo "Removing stale Next.js dev lock${lock_pid:+ for PID ${lock_pid}}."
  rm -f "${lock_file}"
}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${COCO_PID:-}" ]] && kill -0 "${COCO_PID}" 2>/dev/null; then
    kill "${COCO_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

free_port "${BACKEND_PORT}"
free_port "${FRONTEND_PORT}"
cleanup_stale_next_lock
if [[ "${COCO_ENABLED}" == "true" ]]; then
  free_port "${COCO_PORT}"
fi

if [[ ! -d "${ROOT_DIR}/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (cd "${ROOT_DIR}/frontend" && npm install)
fi

# Start CoCo deep-agent service if enabled
COCO_PID=""
if [[ "${COCO_ENABLED}" == "true" ]]; then
  echo "Starting CoCo deep-agent service on http://127.0.0.1:${COCO_PORT}"
  (
    cd "${ROOT_DIR}/services/sttm-builder"
    # Source the .env.local for CoCo settings
    if [[ -f .env.local ]]; then
      set -a
      source .env.local
      set +a
    fi
    # Create knowledge directory if it doesn't exist
    mkdir -p "${ROOT_DIR}/services/sttm-builder/knowledge"
    # Use the venv Python to ensure cortex-code-agent-sdk is available
    VENV_PYTHON="${ROOT_DIR}/services/sttm-builder/.venv/bin/python"
    if [[ ! -x "${VENV_PYTHON}" ]]; then
      echo "Warning: CoCo venv not found at ${VENV_PYTHON}, falling back to system python"
      VENV_PYTHON="python"
    fi
    COCO_KNOWLEDGE_DIR="${ROOT_DIR}/services/sttm-builder/knowledge" \
    "${VENV_PYTHON}" -m uvicorn app.coco.main:app --host 0.0.0.0 --port "${COCO_PORT}" --reload
  ) &
  COCO_PID=$!
  echo "CoCo service started with PID ${COCO_PID}"
else
  echo "CoCo deep-agent service disabled. Set COCO_ENABLED=true to enable."
fi

echo "Starting backend on http://127.0.0.1:${BACKEND_PORT}"
(
  cd "${ROOT_DIR}"
  APP_ENV=local \
  APP_NAME="BBI AI Migration Workbench API" \
  APP_VERSION="0.1.0" \
  PORT="${BACKEND_PORT}" \
  COCO_ENABLED="${COCO_ENABLED}" \
  COCO_SERVICE_URL="ws://127.0.0.1:${COCO_PORT}/api/v1/coco/ws" \
  CORS_ALLOWED_ORIGINS="http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT},http://127.0.0.1:8080,http://localhost:8080" \
  ./scripts/start_sttm_backend_local.sh
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

EXIT_STATUS=0

while true; do
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    if wait "${BACKEND_PID}"; then
      EXIT_STATUS=0
    else
      EXIT_STATUS=$?
    fi
    break
  fi

  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    if wait "${FRONTEND_PID}"; then
      EXIT_STATUS=0
    else
      EXIT_STATUS=$?
    fi
    break
  fi

  if [[ -n "${COCO_PID}" ]] && ! kill -0 "${COCO_PID}" 2>/dev/null; then
    echo "CoCo service stopped unexpectedly"
    # Don't exit - CoCo is optional, let backend/frontend continue
    COCO_PID=""
  fi

  sleep 1
done

cleanup

wait "${BACKEND_PID}" 2>/dev/null || true
wait "${FRONTEND_PID}" 2>/dev/null || true
if [[ -n "${COCO_PID}" ]]; then
  wait "${COCO_PID}" 2>/dev/null || true
fi

exit "${EXIT_STATUS}"
