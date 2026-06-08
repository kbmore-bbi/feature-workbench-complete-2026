#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/infra/snowflake/env/client.env"
TOOLS_VENV="${ROOT_DIR}/.client-tools-venv"
PYTHON_BIN="${TOOLS_VENV}/bin/python"
SCRIPT_PATH="${ROOT_DIR}/scripts/bootstrap_dbt_repo_infra.py"

usage() {
  cat <<EOF
Usage: $0 [--env-file path]

Creates or refreshes the Snowflake Git repository objects used by AGT_DBT_CONVERSION.
Skips automatically when SNOWFLAKE_DBT_GIT_ORIGIN is not configured.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
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
  exit 1
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Client tools virtualenv is not bootstrapped yet. Running bootstrap script first."
  "${ROOT_DIR}/scripts/bootstrap_client_spcs_tools.sh"
fi

set -a
source "${ENV_FILE}"
set +a

if [[ -z "${SNOWFLAKE_DBT_GIT_ORIGIN:-}" ]]; then
  echo "Skipping DBT repo bootstrap because SNOWFLAKE_DBT_GIT_ORIGIN is not configured in ${ENV_FILE}"
  exit 0
fi

"${PYTHON_BIN}" - <<'PY' >/dev/null 2>&1 || "${TOOLS_VENV}/bin/pip" install --upgrade snowflake-connector-python
import snowflake.connector  # noqa: F401
PY

echo "Bootstrapping DBT repo infra into ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}"
"${PYTHON_BIN}" "${SCRIPT_PATH}" \
  --account "${SNOWFLAKE_ACCOUNT}" \
  --user "${SNOWFLAKE_USER}" \
  --password "${SNOWFLAKE_PASSWORD:-}" \
  --authenticator "${SNOWFLAKE_AUTHENTICATOR:-}" \
  --host "${SNOWFLAKE_HOST:-}" \
  --role "${SNOWFLAKE_ROLE:-}" \
  --warehouse "${SNOWFLAKE_WAREHOUSE:-}" \
  --database "${SNOWFLAKE_DATABASE}" \
  --schema "${SNOWFLAKE_SCHEMA}" \
  --api-integration "${SNOWFLAKE_DBT_GIT_API_INTEGRATION:-GIT_API_INTEGRATION_DBT}" \
  --allowed-prefix "${SNOWFLAKE_DBT_GIT_ALLOWED_PREFIX:-}" \
  --secret-name "${SNOWFLAKE_DBT_GIT_SECRET_NAME:-GIT_SECRET_DBT}" \
  --git-username "${SNOWFLAKE_DBT_GIT_USERNAME:-}" \
  --git-pat "${SNOWFLAKE_DBT_GIT_PAT:-}" \
  --repository-name "${SNOWFLAKE_DBT_GIT_REPOSITORY_NAME:-DBT_REPO}" \
  --repository-origin "${SNOWFLAKE_DBT_GIT_ORIGIN:-}" \
  --consumer-role "${SNOWFLAKE_DBT_GIT_CONSUMER_ROLE:-${SNOWFLAKE_ROLE:-}}"
