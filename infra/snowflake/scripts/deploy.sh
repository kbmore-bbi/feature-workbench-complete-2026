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

export SNOWFLAKE_DATABASE_LOWER="${SNOWFLAKE_DATABASE,,}"
export SNOWFLAKE_SCHEMA_LOWER="${SNOWFLAKE_SCHEMA,,}"
export SNOWFLAKE_IMAGE_REPOSITORY_LOWER="${SNOWFLAKE_IMAGE_REPOSITORY,,}"
export IMAGE_TAG

if ! command -v snow &>/dev/null; then
  echo "ERROR: Snowflake CLI ('snow') not found." >&2
  echo "       Install: pip install snowflake-cli  or  brew install snowflake-cli" >&2
  exit 1
fi

: "${SNOWFLAKE_PASSWORD:?SNOWFLAKE_PASSWORD is required}"

run_sql() {
  snow sql \
    --account "${SNOWFLAKE_ACCOUNT}" \
    --user "${SNOWFLAKE_USER:-$(whoami)}" \
    --authenticator snowflake \
    --role "${SNOWFLAKE_ROLE:?SNOWFLAKE_ROLE is required}" \
    --query "$1"
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

declare -A SERVICE_SPECS=(
  [sttm-builder]="${SPECS_DIR}/sttm-builder.yaml.tmpl:${STTM_BUILDER_SERVICE_NAME}"
  [frontend]="${SPECS_DIR}/frontend.yaml.tmpl:${FRONTEND_SERVICE_NAME}"
)

AVAILABLE="$(IFS="|"; echo "${!SERVICE_SPECS[*]}")"

usage() {
  echo "Usage: $0 <service>" >&2
  echo "       service: ${AVAILABLE}" >&2
  exit 1
}

[[ $# -lt 1 ]] && usage

TARGET="$1"
ENTRY="${SERVICE_SPECS[${TARGET}]:-}"
if [[ -z "${ENTRY}" ]]; then
  echo "ERROR: unknown service '${TARGET}'. Available: ${AVAILABLE}" >&2
  exit 1
fi

SPEC_FILE="${ENTRY%%:*}"
SERVICE_NAME="${ENTRY##*:}"

# sttm-builder needs egress to Snowflake for Snowpark SQL + Cortex Agents REST API.
# frontend is a static Next.js app — no Snowflake connections, no EAI needed.
if [[ "${TARGET}" == "sttm-builder" ]]; then
  deploy_service "${SERVICE_NAME}" "${SPEC_FILE}" "${SNOWFLAKE_EGRESS_INTEGRATION}"
else
  deploy_service "${SERVICE_NAME}" "${SPEC_FILE}"
fi

echo "✓ ${SERVICE_NAME} deployed to compute pool ${SNOWFLAKE_COMPUTE_POOL}"
echo ""
echo "Check status:"
echo "  snow sql -q \"SHOW SERVICES IN SCHEMA ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA};\""
