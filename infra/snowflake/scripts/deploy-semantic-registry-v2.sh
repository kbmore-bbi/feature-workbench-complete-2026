#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/../../.."
ENV_FILE="${ROOT_DIR}/services/sttm-builder/.env.local"
DDL_FILE="${SCRIPT_DIR}/../semantic_registry_v2/latest_views.sql"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${SNOWFLAKE_SEMANTIC_VIEWS_DATABASE:?SNOWFLAKE_SEMANTIC_VIEWS_DATABASE is required}"
: "${SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA:?SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA is required}"

REGISTRY_NAMESPACE="${SNOWFLAKE_SEMANTIC_VIEWS_DATABASE}.${SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA}"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/semantic_registry_v2.XXXXXXXX.sql")"
trap 'rm -f "${TMP_FILE}"' EXIT

sed "s|__SEMANTIC_REGISTRY_NAMESPACE__|${REGISTRY_NAMESPACE}|g" "${DDL_FILE}" > "${TMP_FILE}"
echo "Deploying semantic latest views to ${REGISTRY_NAMESPACE}"
"${ROOT_DIR}/venv/bin/python" "${ROOT_DIR}/scripts/run_snowflake_sql.py" --file "${TMP_FILE}"
