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
  if venv_python_path >/dev/null 2>&1; then
    venv_python_path
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

venv_python_path() {
  if [[ -x "${VENV_DIR}/bin/python" ]]; then
    printf '%s\n' "${VENV_DIR}/bin/python"
    return 0
  fi

  if [[ -x "${VENV_DIR}/Scripts/python.exe" ]]; then
    printf '%s\n' "${VENV_DIR}/Scripts/python.exe"
    return 0
  fi

  if [[ -x "${VENV_DIR}/Scripts/python" ]]; then
    printf '%s\n' "${VENV_DIR}/Scripts/python"
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

env_value() {
  local key="$1"
  [[ -f "${ENV_FILE}" ]] || return 0

  local line
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  printf '%s\n' "${line}"
}

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

validate_local_auth_config() {
  local local_dev_auth_enabled
  local snowflake_authenticator
  local snowflake_account
  local snowflake_user
  local snowflake_password
  local snowflake_warehouse

  local_dev_auth_enabled="$(env_value LOCAL_DEV_AUTH_ENABLED)"
  snowflake_authenticator="$(env_value SNOWFLAKE_AUTHENTICATOR)"
  snowflake_account="$(env_value SNOWFLAKE_ACCOUNT)"
  snowflake_user="$(env_value SNOWFLAKE_USER)"
  snowflake_password="$(env_value SNOWFLAKE_PASSWORD)"
  snowflake_warehouse="$(env_value SNOWFLAKE_WAREHOUSE)"

  if [[ "$(to_lower "${local_dev_auth_enabled}")" != "true" ]]; then
    die "LOCAL_DEV_AUTH_ENABLED is not set to true in ${ENV_FILE}. Local STTM auth will fail without Snowflake ingress headers."
  fi

  local missing=()
  [[ -n "${snowflake_account}" ]] || missing+=("SNOWFLAKE_ACCOUNT")
  [[ -n "${snowflake_user}" ]] || missing+=("SNOWFLAKE_USER")
  [[ -n "${snowflake_warehouse}" ]] || missing+=("SNOWFLAKE_WAREHOUSE")

  if [[ "$(to_lower "${snowflake_authenticator}")" != "externalbrowser" ]]; then
    [[ -n "${snowflake_password}" ]] || missing+=("SNOWFLAKE_PASSWORD")
  fi

  if (( ${#missing[@]} > 0 )); then
    die "Missing required local Snowflake settings in ${ENV_FILE}: ${missing[*]}"
  fi
}

ensure_venv() {
  local bootstrap_python
  bootstrap_python="$(find_python)" || die "Python 3 is required but was not found."

  if venv_python_path >/dev/null 2>&1; then
    return 0
  fi

  log "Creating virtual environment at ${VENV_DIR}"
  "${bootstrap_python}" -m venv "${VENV_DIR}"
}

deps_installed() {
  local venv_python
  venv_python="$(venv_python_path)" || return 1

  "${venv_python}" - <<'PY' >/dev/null 2>&1
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
  local venv_python
  venv_python="$(venv_python_path)" || die "Virtual environment Python was not found."

  if deps_installed; then
    log "Backend dependencies already available in ${VENV_DIR}"
    return 0
  fi

  log "Installing backend dependencies"
  "${venv_python}" -m pip install --upgrade pip
  "${venv_python}" -m pip install -e "${SERVICE_DIR}"
}

start_backend() {
  local venv_python
  venv_python="$(venv_python_path)" || die "Virtual environment Python was not found."

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
  log "and provide either SNOWFLAKE_USER / SNOWFLAKE_PASSWORD"
  log "or SNOWFLAKE_USER with SNOWFLAKE_AUTHENTICATOR=externalbrowser"
  log "so the backend can connect as that developer's Snowflake identity."

  cd "${SERVICE_DIR}"
  if (( ${#reload_args[@]} > 0 )); then
    APP_ENV="${APP_ENV:-local}" \
    APP_NAME="${APP_NAME:-BBI AI Migration Workbench API}" \
    APP_VERSION="${APP_VERSION:-local}" \
    PORT="${PORT}" \
    "${venv_python}" -m uvicorn app.main:app --host "${HOST}" --port "${PORT}" "${reload_args[@]}"
  else
    APP_ENV="${APP_ENV:-local}" \
    APP_NAME="${APP_NAME:-BBI AI Migration Workbench API}" \
    APP_VERSION="${APP_VERSION:-local}" \
    PORT="${PORT}" \
    "${venv_python}" -m uvicorn app.main:app --host "${HOST}" --port "${PORT}"
  fi
}

main() {
  ensure_env_file
  validate_local_auth_config
  ensure_venv
  install_deps
  start_backend
}

main "$@"
