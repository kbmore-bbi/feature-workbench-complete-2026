#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/infra/snowflake/env/client.env"
TOOLS_VENV="${ROOT_DIR}/.client-tools-venv"
PYTHON_BIN="${TOOLS_VENV}/bin/python"
SCRIPT_PATH="${ROOT_DIR}/scripts/bootstrap_sttm_metadata_infra.py"

usage() {
  cat <<EOF
Usage: $0 [--env-file path]

Creates the STTM metadata schema objects in the configured Snowflake database/schema:
- tables
- derived source table
- relationship/sample/profile procedures
- semantic bundle/cache procedures
- dbt tool procedures
- sub-agent procedures
- Cortex agents
- FIR tables, streams, procedures, unified Cortex Search, task graph, and grants

Examples:
  $0
  $0 --env-file infra/snowflake/env/client.env
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

"${PYTHON_BIN}" - <<'PY' >/dev/null 2>&1 || "${TOOLS_VENV}/bin/pip" install --upgrade snowflake-connector-python
import snowflake.connector  # noqa: F401
PY

echo "Bootstrapping STTM metadata infra into ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}"
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
  --semantic-database "${SNOWFLAKE_SEMANTIC_VIEWS_DATABASE:-${SNOWFLAKE_DATABASE}}" \
  --semantic-schema "${SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA:-${SNOWFLAKE_SCHEMA}}" \
  --semantic-table-object "${SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE:-LATEST_TABLE_VIEWS}" \
  --semantic-column-object "${SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE:-LATEST_COLUMN_VIEWS}" \
  --semantic-native-object "${SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE:-LATEST_NATIVE_VIEWS}"
