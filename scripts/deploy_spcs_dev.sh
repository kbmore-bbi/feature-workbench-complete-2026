#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${ROOT_DIR}/scripts/common.sh"

load_snowflake_secret

IMAGE_TAG="${IMAGE_TAG:-$(short_sha)}"
SERVICE_NAME="${SERVICE_NAME:-AI_WORKBENCH_DEV_WEBAPP}"
SNOWFLAKE_COMPUTE_POOL="${SNOWFLAKE_COMPUTE_POOL:-AI_WORKBENCH_DEV_POOL}"
SNOWFLAKE_DATABASE="${SNOWFLAKE_DATABASE:-AI_WORKBENCH_DEV}"
SNOWFLAKE_SCHEMA="${SNOWFLAKE_SCHEMA:-APP_RUNTIME}"
SNOWFLAKE_IMAGE_REPOSITORY="${SNOWFLAKE_IMAGE_REPOSITORY:-AI_WORKBENCH_DEV_IMAGES}"

export IMAGE_TAG
export SERVICE_NAME
export SNOWFLAKE_DATABASE
export SNOWFLAKE_SCHEMA
export SNOWFLAKE_IMAGE_REPOSITORY

SNOWFLAKE_DATABASE_LOWER="$(printf "%s" "${SNOWFLAKE_DATABASE}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_SCHEMA_LOWER="$(printf "%s" "${SNOWFLAKE_SCHEMA}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_IMAGE_REPOSITORY_LOWER="$(printf "%s" "${SNOWFLAKE_IMAGE_REPOSITORY}" | tr '[:upper:]' '[:lower:]')"
export SNOWFLAKE_DATABASE_LOWER
export SNOWFLAKE_SCHEMA_LOWER
export SNOWFLAKE_IMAGE_REPOSITORY_LOWER

mkdir -p "${ROOT_DIR}/artifacts"

python3 "${ROOT_DIR}/scripts/render_spcs_spec.py" \
  --template "${ROOT_DIR}/infra/snowflake/dev/service-specs/webapp.yaml.tmpl" \
  --output "${ROOT_DIR}/artifacts/webapp.dev.yaml"

run_sql_tsv() {
  local sql="$1"
  python3 "${ROOT_DIR}/scripts/run_snowflake_sql.py" --query "${sql}" --format tsv
}

run_sql_plain() {
  local sql="$1"
  python3 "${ROOT_DIR}/scripts/run_snowflake_sql.py" --query "${sql}" --format plain
}

service_exists="$(run_sql_tsv "SHOW SERVICES LIKE '${SERVICE_NAME}';" | awk -v svc="${SERVICE_NAME}" '$1 == svc {print $1; exit}')"

spec_contents="$(cat "${ROOT_DIR}/artifacts/webapp.dev.yaml")"

if [[ -n "${service_exists}" ]]; then
  run_sql_plain "ALTER SERVICE ${SERVICE_NAME}
  FROM SPECIFICATION $$
${spec_contents}
$$;
"
else
  run_sql_plain "CREATE SERVICE ${SERVICE_NAME}
  IN COMPUTE POOL ${SNOWFLAKE_COMPUTE_POOL}
  FROM SPECIFICATION $$
${spec_contents}
$$
  MIN_INSTANCES=1
  MAX_INSTANCES=1;
"
fi

run_sql_plain "SHOW ENDPOINTS IN SERVICE ${SERVICE_NAME};" | tee "${ROOT_DIR}/artifacts/endpoints.txt"
