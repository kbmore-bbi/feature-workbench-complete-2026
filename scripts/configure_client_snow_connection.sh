#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/infra/snowflake/env/client.env}"
TOOLS_VENV="${ROOT_DIR}/.client-tools-venv"
SNOW_BIN="${TOOLS_VENV}/bin/snow"
FORCE_RECREATE="false"

usage() {
  cat <<EOF
Usage: $0 [--env-file path] [--force-recreate]

Creates or reuses a Snowflake CLI connection for client-side SPCS deployment
using either username/password or browser/externalbrowser authentication.

Examples:
  $0
  $0 --env-file infra/snowflake/env/client.env
  $0 --force-recreate
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --force-recreate)
      FORCE_RECREATE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE}" >&2
  echo "Copy infra/snowflake/env/client.env.example to client.env and fill it first." >&2
  exit 1
fi

if [[ ! -x "${SNOW_BIN}" ]]; then
  echo "Snow CLI tools are not bootstrapped yet. Running bootstrap script first."
  "${ROOT_DIR}/scripts/bootstrap_client_spcs_tools.sh"
fi

set -a
source "${ENV_FILE}"
set +a

required_vars=(
  SNOWFLAKE_CONNECTION
  SNOWFLAKE_ACCOUNT
  SNOWFLAKE_USER
  SNOWFLAKE_ROLE
  SNOWFLAKE_WAREHOUSE
  SNOWFLAKE_DATABASE
  SNOWFLAKE_SCHEMA
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "ERROR: ${var_name} must be set in ${ENV_FILE}" >&2
    exit 1
  fi
done

SNOWFLAKE_AUTHENTICATOR="${SNOWFLAKE_AUTHENTICATOR:-}"
SNOWFLAKE_PASSWORD="${SNOWFLAKE_PASSWORD:-}"
USE_PASSWORD_AUTH="false"

if [[ -n "${SNOWFLAKE_PASSWORD}" ]]; then
  USE_PASSWORD_AUTH="true"
fi

if [[ "${USE_PASSWORD_AUTH}" != "true" && -z "${SNOWFLAKE_AUTHENTICATOR}" ]]; then
  SNOWFLAKE_AUTHENTICATOR="externalbrowser"
fi

if "${SNOW_BIN}" connection test -c "${SNOWFLAKE_CONNECTION}" >/dev/null 2>&1; then
  if [[ "${FORCE_RECREATE}" != "true" ]]; then
    echo "Snow connection '${SNOWFLAKE_CONNECTION}' already works. Reusing it."
    exit 0
  fi
fi

if "${SNOW_BIN}" connection list --format JSON 2>/dev/null | grep -q "\"${SNOWFLAKE_CONNECTION}\""; then
  if [[ "${FORCE_RECREATE}" == "true" ]]; then
    echo "Removing existing connection '${SNOWFLAKE_CONNECTION}' before recreating it."
    "${SNOW_BIN}" connection remove "${SNOWFLAKE_CONNECTION}"
  else
    echo "Connection '${SNOWFLAKE_CONNECTION}' already exists."
    echo "Testing it now. If browser auth opens, complete sign-in there."
    "${SNOW_BIN}" connection test -c "${SNOWFLAKE_CONNECTION}"
    exit 0
  fi
fi

echo "Creating Snow CLI connection '${SNOWFLAKE_CONNECTION}'"
connection_add_args=(
  connection add
  --connection-name "${SNOWFLAKE_CONNECTION}"
  --account "${SNOWFLAKE_ACCOUNT}"
  --user "${SNOWFLAKE_USER}"
  --role "${SNOWFLAKE_ROLE}"
  --warehouse "${SNOWFLAKE_WAREHOUSE}"
  --database "${SNOWFLAKE_DATABASE}"
  --schema "${SNOWFLAKE_SCHEMA}"
  --default
  --no-interactive
  --format TABLE
)

if [[ "${USE_PASSWORD_AUTH}" == "true" ]]; then
  connection_add_args+=(--password "${SNOWFLAKE_PASSWORD}")
  if [[ -n "${SNOWFLAKE_AUTHENTICATOR}" && "${SNOWFLAKE_AUTHENTICATOR}" != "snowflake" ]]; then
    connection_add_args+=(--authenticator "${SNOWFLAKE_AUTHENTICATOR}")
  fi
else
  connection_add_args+=(--authenticator "${SNOWFLAKE_AUTHENTICATOR}")
fi

"${SNOW_BIN}" "${connection_add_args[@]}"

echo
echo "Testing connection '${SNOWFLAKE_CONNECTION}'"
"${SNOW_BIN}" connection test -c "${SNOWFLAKE_CONNECTION}"
echo
echo "Connection configured successfully."
