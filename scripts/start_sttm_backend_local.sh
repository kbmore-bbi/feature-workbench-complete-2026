#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/services/sttm-builder"
VENV_DIR="${SERVICE_DIR}/.venv"
ENV_FILE="${SERVICE_DIR}/.env.local"
ENV_EXAMPLE="${SERVICE_DIR}/.env.example"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
RELOAD="${RELOAD:-true}"

log() {
  printf '[sttm-backend] %s\n' "$*"
}

die() {
  printf '[sttm-backend] ERROR: %s\n' "$*" >&2
  exit 1
}

find_python() {
  if [[ -x "${VENV_DIR}/bin/python" ]]; then
    printf '%s\n' "${VENV_DIR}/bin/python"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return 0
  fi

  return 1
}

ensure_env_file() {
  if [[ -f "${ENV_FILE}" ]]; then
    sync_env_file
    return 0
  fi

  if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    die "Could not find ${ENV_EXAMPLE}"
  fi

  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  log "Created ${ENV_FILE} from .env.example"
  log "Update the Snowflake values in ${ENV_FILE} before using authenticated endpoints."
}

sync_env_file() {
  [[ -f "${ENV_EXAMPLE}" ]] || die "Could not find ${ENV_EXAMPLE}"
  [[ -f "${ENV_FILE}" ]] || return 0

  local additions=()
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ "${line}" =~ ^[A-Z0-9_]+= ]] || continue
    local key="${line%%=*}"
    if ! grep -Eq "^${key}=" "${ENV_FILE}"; then
      additions+=("${line}")
    fi
  done < "${ENV_EXAMPLE}"

  if (( ${#additions[@]} == 0 )); then
    return 0
  fi

  {
    printf '\n# Added from .env.example by start_sttm_backend_local.sh\n'
    printf '%s\n' "${additions[@]}"
  } >> "${ENV_FILE}"

  log "Updated ${ENV_FILE} with missing keys from .env.example"
}

ensure_venv() {
  local bootstrap_python
  bootstrap_python="$(find_python)" || die "Python 3 is required but was not found."

  if [[ -x "${VENV_DIR}/bin/python" ]]; then
    return 0
  fi

  log "Creating virtual environment at ${VENV_DIR}"
  "${bootstrap_python}" -m venv "${VENV_DIR}"
}

deps_installed() {
  "${VENV_DIR}/bin/python" - <<'PY' >/dev/null 2>&1
import fastapi  # noqa: F401
import uvicorn  # noqa: F401
import httpx  # noqa: F401
import pydantic  # noqa: F401
import pydantic_settings  # noqa: F401
import swagger_ui_bundle  # noqa: F401
import snowflake.connector  # noqa: F401
import snowflake.snowpark  # noqa: F401
PY
}

install_deps() {
  if deps_installed; then
    log "Backend dependencies already available in ${VENV_DIR}"
    return 0
  fi

  log "Installing backend dependencies"
  "${VENV_DIR}/bin/python" -m pip install --upgrade pip
  "${VENV_DIR}/bin/python" -m pip install -e "${SERVICE_DIR}"
}

start_backend() {
  local reload_args=()
  if [[ "${RELOAD}" == "true" ]]; then
    reload_args+=(--reload)
  fi

  log "Starting STTM backend on http://127.0.0.1:${PORT}"
  log "Health check: http://127.0.0.1:${PORT}/health"
  log "Docs: http://127.0.0.1:${PORT}/docs"
  log "Local note: Snowflake ingress auth headers are not present on localhost."
  log "Default mode still expects deployed SPCS ingress and caller context."
  log "For local frontend/API testing, set LOCAL_DEV_AUTH_ENABLED=true in ${ENV_FILE}"
  log "and provide SNOWFLAKE_USER / SNOWFLAKE_PASSWORD so the backend can connect"
  log "directly as that developer's Snowflake identity."

  cd "${SERVICE_DIR}"
  APP_ENV="${APP_ENV:-local}" \
  APP_NAME="${APP_NAME:-BBI AI Migration Workbench API}" \
  APP_VERSION="${APP_VERSION:-local}" \
  PORT="${PORT}" \
  "${VENV_DIR}/bin/python" -m uvicorn app.main:app --host "${HOST}" --port "${PORT}" "${reload_args[@]}"
}

main() {
  ensure_env_file
  ensure_venv
  install_deps
  start_backend
}

main "$@"
