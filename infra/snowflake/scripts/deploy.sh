#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECS_DIR="${SCRIPT_DIR}/../service-specs"

# Load env
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../env/dev.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE}" >&2
  echo "       Copy env/dev.env.example → env/dev.env and fill in values." >&2
  exit 1
fi
set -a; source "${ENV_FILE}"; set +a

IMAGE_TAG="${IMAGE_TAG:-latest}"

export SNOWFLAKE_DATABASE_LOWER="$(printf "%s" "${SNOWFLAKE_DATABASE}" | tr '[:upper:]' '[:lower:]')"
export SNOWFLAKE_SCHEMA_LOWER="$(printf "%s" "${SNOWFLAKE_SCHEMA}" | tr '[:upper:]' '[:lower:]')"
export SNOWFLAKE_IMAGE_REPOSITORY_LOWER="$(printf "%s" "${SNOWFLAKE_IMAGE_REPOSITORY}" | tr '[:upper:]' '[:lower:]')"
export IMAGE_TAG

if ! command -v snowsql &>/dev/null; then
  echo "ERROR: SnowSQL ('snowsql') not found." >&2
  echo "       Install SnowSQL and ensure it is available on PATH." >&2
  exit 1
fi

: "${SNOWFLAKE_PASSWORD:?SNOWFLAKE_PASSWORD is required}"

run_sql() {
  SNOWSQL_PWD="${SNOWFLAKE_PASSWORD}" snowsql \
    -a "${SNOWFLAKE_ACCOUNT}" \
    -u "${SNOWFLAKE_USER:-$(whoami)}" \
    -r "${SNOWFLAKE_ROLE:?SNOWFLAKE_ROLE is required}" \
    -w "${SNOWFLAKE_WAREHOUSE:?SNOWFLAKE_WAREHOUSE is required}" \
    -d "${SNOWFLAKE_DATABASE:?SNOWFLAKE_DATABASE is required}" \
    -s "${SNOWFLAKE_SCHEMA:?SNOWFLAKE_SCHEMA is required}" \
    -o friendly=false \
    -o header=false \
    -o output_format=plain \
    -q "$1"
}

render_spec() {
  local tmpl="$1"
  envsubst < "${tmpl}"
}

deploy_service() {
  local service_name="$1"
  local spec_file="$2"
  local eai="${3:-}"   # optional External Access Integration name

  local spec
  spec="$(render_spec "${spec_file}")"

  local eai_clause=""
  if [[ -n "${eai}" ]]; then
    eai_clause="EXTERNAL_ACCESS_INTEGRATIONS = (${eai})"
  fi

  echo "→ Deploying ${service_name}${eai:+ (egress: ${eai})}"
  run_sql "
    CREATE SERVICE IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${service_name}
      IN COMPUTE POOL ${SNOWFLAKE_COMPUTE_POOL}
      ${eai_clause}
      FROM SPECIFICATION \$\$
${spec}
      \$\$;

    ALTER SERVICE IF EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${service_name}
      FROM SPECIFICATION \$\$
${spec}
      \$\$;
  "
}

: "${SNOWFLAKE_EGRESS_INTEGRATION:?SNOWFLAKE_EGRESS_INTEGRATION is required — run setup-egress.sql first}"

AVAILABLE="sttm-builder|webapp"

usage() {
  echo "Usage: $0 <service>" >&2
  echo "       service: ${AVAILABLE}" >&2
  exit 1
}

[[ $# -lt 1 ]] && usage

TARGET="$1"
case "${TARGET}" in
  sttm-builder)
    SPEC_FILE="${SPECS_DIR}/sttm-builder.yaml.tmpl"
    SERVICE_NAME="${STTM_BUILDER_SERVICE_NAME}"
    ;;
  webapp)
    SPEC_FILE="${SPECS_DIR}/webapp.yaml.tmpl"
    SERVICE_NAME="${WEBAPP_SERVICE_NAME}"
    ;;
  *)
    echo "ERROR: unknown service '${TARGET}'. Available: ${AVAILABLE}" >&2
    exit 1
    ;;
esac

# sttm-builder and the integrated webapp both need egress to Snowflake for
# Snowpark SQL + Cortex Agents REST API from the backend container.
if [[ "${TARGET}" == "sttm-builder" || "${TARGET}" == "webapp" ]]; then
  deploy_service "${SERVICE_NAME}" "${SPEC_FILE}" "${SNOWFLAKE_EGRESS_INTEGRATION}"
else
  deploy_service "${SERVICE_NAME}" "${SPEC_FILE}"
fi

echo "✓ ${SERVICE_NAME} deployed to compute pool ${SNOWFLAKE_COMPUTE_POOL}"
echo ""
echo "Check status:"
echo "  snowsql -a ${SNOWFLAKE_ACCOUNT} -u ${SNOWFLAKE_USER:-$(whoami)} -q \"SHOW SERVICES IN SCHEMA ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA};\""
