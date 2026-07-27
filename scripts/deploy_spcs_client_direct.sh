#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_ENV_FILE="${CLIENT_ENV_FILE:-${ROOT_DIR}/infra/snowflake/env/client.env}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${ROOT_DIR}/services/sttm-builder/.env.local}"
ARTIFACTS_DIR="${ROOT_DIR}/artifacts/client-spcs-direct"
RENDER_SCRIPT="${ROOT_DIR}/scripts/render_spcs_spec.py"
WEBAPP_SPEC_TEMPLATE="${ROOT_DIR}/infra/snowflake/service-specs/webapp.yaml.tmpl"
AUTOMAP_SPEC_TEMPLATE="${ROOT_DIR}/infra/snowflake/service-specs/automap-worker.yaml.tmpl"
PYTHON_BIN="${PYTHON_BIN:-${ROOT_DIR}/services/sttm-builder/.venv/bin/python}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
SKIP_BUILD="false"

usage() {
  cat <<EOF
Usage: $0 [--client-env path] [--local-env path] [--image-tag tag] [--skip-build]

Deploys the public webapp service and the private auto-mapping worker to
Snowpark Container Services using direct Snowflake credentials from .env.local.
No Snow CLI is used.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client-env)
      CLIENT_ENV_FILE="$2"
      shift 2
      ;;
    --local-env)
      LOCAL_ENV_FILE="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD="true"
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

if [[ ! -f "${CLIENT_ENV_FILE}" ]]; then
  echo "Missing client env file: ${CLIENT_ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${LOCAL_ENV_FILE}" ]]; then
  echo "Missing local env file: ${LOCAL_ENV_FILE}" >&2
  exit 1
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Python interpreter not found at ${PYTHON_BIN}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not found in PATH" >&2
  exit 1
fi

set -a
source "${LOCAL_ENV_FILE}"
source "${CLIENT_ENV_FILE}"
set +a

dns_label() {
  printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]' | tr '_' '-'
}

is_placeholder_name() {
  local value="${1:-}"
  [[ -z "${value}" ]] && return 0
  [[ "${value}" == DB.SCHEMA.* ]] && return 0
  [[ "${value}" == YOUR_DB.YOUR_SCHEMA.* ]] && return 0
  return 1
}

normalize_qualified_name_var() {
  local var_name="$1"
  local current_value="${!var_name:-}"
  if is_placeholder_name "${current_value}"; then
    export "${var_name}="
  fi
}

normalize_auto_mapping_url() {
  local current_value="${AUTO_MAPPING_SERVICE_URL:-}"
  local short_http="http://${AUTO_MAPPING_SERVICE_NAME}:8000"
  local short_https="https://${AUTO_MAPPING_SERVICE_NAME}:8000"
  if [[ -z "${current_value}" || "${current_value}" == "${short_http}" || "${current_value}" == "${short_https}" ]]; then
    export AUTO_MAPPING_SERVICE_URL="http://${AUTO_MAPPING_INTERNAL_HOST}:8000"
  fi
}

required_vars=(
  SNOWFLAKE_ACCOUNT
  SNOWFLAKE_USER
  SNOWFLAKE_PASSWORD
  SNOWFLAKE_ROLE
  SNOWFLAKE_WAREHOUSE
  SNOWFLAKE_DATABASE
  SNOWFLAKE_SCHEMA
  SNOWFLAKE_REGISTRY_HOST
  SNOWFLAKE_IMAGE_REPOSITORY
  SNOWFLAKE_COMPUTE_POOL
  WEBAPP_SERVICE_NAME
  AUTO_MAPPING_COMPUTE_POOL
  AUTO_MAPPING_SERVICE_NAME
  SNOWFLAKE_EGRESS_INTEGRATION
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required variable: ${var_name}" >&2
    exit 1
  fi
done

run_sql() {
  local query="$1"
  "${PYTHON_BIN}" "${ROOT_DIR}/scripts/run_snowflake_sql.py" --query "${query}" --format plain
}

upload_to_stage() {
  local stage_name="$1"
  local source_path="$2"
  run_sql "PUT 'file://${source_path}' @${stage_name} AUTO_COMPRESS=FALSE OVERWRITE=TRUE"
}

grant_role_if_set() {
  local sql_template="$1"
  shift
  local role=""
  local seen="|"
  for role in "$@"; do
    role="${role:-}"
    [[ -z "${role}" ]] && continue
    if [[ "${seen}" == *"|${role}|"* ]]; then
      continue
    fi
    seen="${seen}${role}|"
    run_sql "${sql_template//__ROLE__/${role}}"
  done
}

build_and_push() {
  local image_name="$1"
  local context_dir="$2"
  local remote_image="${REGISTRY_BASE}/${image_name}:${IMAGE_TAG}"

  echo
  echo "Building ${image_name} -> ${remote_image}"
  docker build --platform linux/amd64 -t "${remote_image}" "${context_dir}"
  echo "Pushing ${remote_image}"
  docker push "${remote_image}"
}

export SNOWFLAKE_DATABASE_LOWER="$(printf "%s" "${SNOWFLAKE_DATABASE}" | tr '[:upper:]' '[:lower:]')"
export SNOWFLAKE_SCHEMA_LOWER="$(printf "%s" "${SNOWFLAKE_SCHEMA}" | tr '[:upper:]' '[:lower:]')"
export SNOWFLAKE_IMAGE_REPOSITORY_LOWER="$(printf "%s" "${SNOWFLAKE_IMAGE_REPOSITORY}" | tr '[:upper:]' '[:lower:]')"
AUTO_MAPPING_SERVICE_NAME_LOWER="$(dns_label "${AUTO_MAPPING_SERVICE_NAME}")"
AUTO_MAPPING_SCHEMA_DNS="$(dns_label "${SNOWFLAKE_SCHEMA}")"
AUTO_MAPPING_DATABASE_DNS="$(dns_label "${SNOWFLAKE_DATABASE}")"
AUTO_MAPPING_INTERNAL_HOST="${AUTO_MAPPING_SERVICE_NAME_LOWER}.${AUTO_MAPPING_SCHEMA_DNS}.${AUTO_MAPPING_DATABASE_DNS}.snowflakecomputing.internal"

normalize_qualified_name_var SNOWFLAKE_STTM_BUILDER_AGENT
normalize_qualified_name_var SNOWFLAKE_SOURCE_MAPPING_AGENT
normalize_qualified_name_var SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT
normalize_qualified_name_var SNOWFLAKE_SEMANTIC_MODEL_AGENT
normalize_qualified_name_var SNOWFLAKE_DBT_CONVERSION_AGENT
normalize_qualified_name_var SNOWFLAKE_RELATIONSHIPS_PROCEDURE
normalize_auto_mapping_url

export IMAGE_TAG
export APP_NAME="${APP_NAME:-BBI AI Migration Workbench API}"
export APP_ENV="${APP_ENV:-client}"
export USERS_TABLE="${USERS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_USERS}"
export APP_ROLE_ADMIN="${APP_ROLE_ADMIN:-FOCUS_ADMIN}"
export APP_ROLE_PUBLISHER="${APP_ROLE_PUBLISHER:-WORKBENCH_PUBLISHER}"
export APP_ROLE_VIEWER="${APP_ROLE_VIEWER:-WORKBENCH_VIEWER}"
export SNOWFLAKE_HOST="${SNOWFLAKE_HOST:-}"
export SNOWFLAKE_REST_HOST="${SNOWFLAKE_REST_HOST:-$(dns_label "${SNOWFLAKE_ACCOUNT}").snowflakecomputing.com}"
export SNOWFLAKE_SEMANTIC_MODEL_AGENT="${SNOWFLAKE_SEMANTIC_MODEL_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_SEMANTIC_MODEL}"
export SNOWFLAKE_SOURCE_MAPPING_AGENT="${SNOWFLAKE_SOURCE_MAPPING_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_SOURCE_MAPPING}"
export SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT="${SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT:-${SNOWFLAKE_STTM_BUILDER_AGENT}}"
export SNOWFLAKE_DBT_CONVERSION_AGENT="${SNOWFLAKE_DBT_CONVERSION_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_DBT_CONVERSION}"
export SNOWFLAKE_RELATIONSHIPS_PROCEDURE="${SNOWFLAKE_RELATIONSHIPS_PROCEDURE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.SP_GET_TABLE_RELATIONSHIPS}"
export SNOWFLAKE_SEMANTIC_MODEL_TABLE="${SNOWFLAKE_SEMANTIC_MODEL_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_SEMANTIC_MODELS}"
export SNOWFLAKE_SEMANTIC_VIEWS_DATABASE="${SNOWFLAKE_SEMANTIC_VIEWS_DATABASE:-${SNOWFLAKE_DATABASE}}"
export SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA="${SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA:-${SNOWFLAKE_SCHEMA}}"
export SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE="${SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE:-LATEST_TABLE_VIEWS}"
export SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE="${SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE:-LATEST_COLUMN_VIEWS}"
export SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE="${SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE:-LATEST_NATIVE_VIEWS}"
export SNOWFLAKE_DERIVED_SOURCES_TABLE="${SNOWFLAKE_DERIVED_SOURCES_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_DERIVED_SOURCES}"
export SNOWFLAKE_STTM_BUILDER_AGENT="${SNOWFLAKE_STTM_BUILDER_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_STTM_BUILDER}"
export SNOWFLAKE_CONVERSATION_TURNS_TABLE="${SNOWFLAKE_CONVERSATION_TURNS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_CONVERSATION_TURNS}"
export SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE="${SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_FEEDBACK}"
export SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE="${SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_RECOMMENDATIONS}"
export SNOWFLAKE_RELATIONSHIP_FACTS_TABLE="${SNOWFLAKE_RELATIONSHIP_FACTS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_RELATIONSHIP_FACTS}"
export SNOWFLAKE_RAG_DOCUMENTS_TABLE="${SNOWFLAKE_RAG_DOCUMENTS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_RAG_DOCUMENTS}"
export SNOWFLAKE_RAG_SEARCH_SERVICE="${SNOWFLAKE_RAG_SEARCH_SERVICE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.CSS_WORKBENCH_RAG}"
export SNOWFLAKE_AGENT_ORCHESTRATION_MODEL="${SNOWFLAKE_AGENT_ORCHESTRATION_MODEL:-claude-sonnet-4}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-}"
export AUTO_MAPPING_SERVICE_URL="${AUTO_MAPPING_SERVICE_URL:-http://${AUTO_MAPPING_INTERNAL_HOST}:8000}"
export AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS="${AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS:-300}"
export AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS="${AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS:-2}"
export AUTO_MAPPING_WORKER_MAX_CONCURRENCY="${AUTO_MAPPING_WORKER_MAX_CONCURRENCY:-5}"
export AUTO_MAP_PIPELINE_V2="${AUTO_MAP_PIPELINE_V2:-false}"
export AGENT_SPEC_SOURCE_MAPPING_SHA256="${AGENT_SPEC_SOURCE_MAPPING_SHA256:-7305680ead06485882e014c25d7ebc015fe019d3a8634c54392e2473fb2939c5}"
export AGENT_SPEC_TRANSFORMATION_RULE_SHA256="${AGENT_SPEC_TRANSFORMATION_RULE_SHA256:-a9cec5354f68c0790b4c5ba177b43670c9167bc429d2c6708b094ff42a2ce588}"
export SNOWFLAKE_SESSION_RETRY_ATTEMPTS="${SNOWFLAKE_SESSION_RETRY_ATTEMPTS:-2}"
export SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS="${SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS:-1.0}"
export SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS="${SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS:-1800}"
export SNOWFLAKE_AGENT_RETRY_ATTEMPTS="${SNOWFLAKE_AGENT_RETRY_ATTEMPTS:-3}"
export SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS="${SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS:-1.0}"
export SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT="${SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.STTM_BUILDER_OAUTH_CLIENT_CREDENTIALS}"
export SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT="${SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.STTM_BUILDER_OAUTH_SESSION_KEYS}"
export SPCS_ENABLE_CUSTOM_CREDENTIALS="false"
export SNOWFLAKE_OAUTH_SECRET_MAPPINGS=""

if [[ "${AUTH_MODE:-custom_oauth}" == "custom_oauth" ]]; then
  export SPCS_ENABLE_CUSTOM_CREDENTIALS="true"
  export AUTH_SESSION_COOKIE_SECURE="true"
  export SNOWFLAKE_OAUTH_SECRET_MAPPINGS="$(printf '%s\n' \
    '      secrets:' \
    "        - snowflakeSecret: ${SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT}" \
    '          secretKeyRef: username' \
    '          envVarName: SNOWFLAKE_OAUTH_CLIENT_ID' \
    "        - snowflakeSecret: ${SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT}" \
    '          secretKeyRef: password' \
    '          envVarName: SNOWFLAKE_OAUTH_CLIENT_SECRET' \
    "        - snowflakeSecret: ${SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT}" \
    '          secretKeyRef: username' \
    '          envVarName: AUTH_SESSION_SECRET' \
    "        - snowflakeSecret: ${SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT}" \
    '          secretKeyRef: password' \
    '          envVarName: AUTH_SESSION_ENCRYPTION_KEY')"
fi

REGISTRY_BASE="${SNOWFLAKE_REGISTRY_HOST}/${SNOWFLAKE_DATABASE_LOWER}/${SNOWFLAKE_SCHEMA_LOWER}/${SNOWFLAKE_IMAGE_REPOSITORY_LOWER}"
DEPLOY_STAGE="${SNOWFLAKE_DEPLOY_STAGE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.WORKBENCH_SPCS_DEPLOY_STAGE}"

mkdir -p "${ARTIFACTS_DIR}"
WEBAPP_SPEC_FILE="${ARTIFACTS_DIR}/webapp.${IMAGE_TAG}.yaml"
AUTOMAP_SPEC_FILE="${ARTIFACTS_DIR}/automap-worker.${IMAGE_TAG}.yaml"
WEBAPP_SPEC_NAME="webapp.${IMAGE_TAG}.yaml"
AUTOMAP_SPEC_NAME="automap-worker.${IMAGE_TAG}.yaml"

echo "Testing direct Snowflake SQL access"
run_sql "SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_DATABASE(), CURRENT_SCHEMA()"

echo
echo "Ensuring compute pools exist"
run_sql "CREATE COMPUTE POOL IF NOT EXISTS ${SNOWFLAKE_COMPUTE_POOL} MIN_NODES = 1 MAX_NODES = 1 INSTANCE_FAMILY = CPU_X64_S AUTO_RESUME = TRUE AUTO_SUSPEND_SECS = 3600"
run_sql "CREATE COMPUTE POOL IF NOT EXISTS ${AUTO_MAPPING_COMPUTE_POOL} MIN_NODES = 2 MAX_NODES = 2 INSTANCE_FAMILY = CPU_X64_S AUTO_RESUME = TRUE AUTO_SUSPEND_SECS = 3600"

echo
echo "Logging Docker into ${SNOWFLAKE_REGISTRY_HOST}"
printf "%s" "${SNOWFLAKE_PASSWORD}" | docker login "${SNOWFLAKE_REGISTRY_HOST}" --username "${SNOWFLAKE_USER}" --password-stdin

if [[ "${SKIP_BUILD}" != "true" ]]; then
  build_and_push "sttm-builder" "${ROOT_DIR}/services/sttm-builder"
  build_and_push "sttm-automap-worker" "${ROOT_DIR}/services/sttm-builder"
  build_and_push "frontend" "${ROOT_DIR}/frontend"
  build_and_push "nginx" "${ROOT_DIR}/nginx"
else
  echo "Skipping Docker build/push"
fi

echo
echo "Rendering service specs"
"${PYTHON_BIN}" "${RENDER_SCRIPT}" --template "${WEBAPP_SPEC_TEMPLATE}" --output "${WEBAPP_SPEC_FILE}"
"${PYTHON_BIN}" "${RENDER_SCRIPT}" --template "${AUTOMAP_SPEC_TEMPLATE}" --output "${AUTOMAP_SPEC_FILE}"

echo
echo "Ensuring deploy stage exists"
run_sql "CREATE STAGE IF NOT EXISTS ${DEPLOY_STAGE}"

echo
echo "Uploading rendered specs to stage"
upload_to_stage "${DEPLOY_STAGE}" "${WEBAPP_SPEC_FILE}"
upload_to_stage "${DEPLOY_STAGE}" "${AUTOMAP_SPEC_FILE}"

echo
echo "Deploying public webapp service ${WEBAPP_SERVICE_NAME}"
run_sql "CREATE SERVICE IF NOT EXISTS ${WEBAPP_SERVICE_NAME} IN COMPUTE POOL ${SNOWFLAKE_COMPUTE_POOL} EXTERNAL_ACCESS_INTEGRATIONS = (${SNOWFLAKE_EGRESS_INTEGRATION}) FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${WEBAPP_SPEC_NAME}' MIN_INSTANCES = 1 MAX_INSTANCES = 1"
run_sql "ALTER SERVICE ${WEBAPP_SERVICE_NAME} FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${WEBAPP_SPEC_NAME}'"

echo
echo "Deploying private auto-mapping worker service ${AUTO_MAPPING_SERVICE_NAME}"
run_sql "CREATE SERVICE IF NOT EXISTS ${AUTO_MAPPING_SERVICE_NAME} IN COMPUTE POOL ${AUTO_MAPPING_COMPUTE_POOL} EXTERNAL_ACCESS_INTEGRATIONS = (${SNOWFLAKE_EGRESS_INTEGRATION}) FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${AUTOMAP_SPEC_NAME}' MIN_INSTANCES = 2 MAX_INSTANCES = 2"
run_sql "ALTER SERVICE ${AUTO_MAPPING_SERVICE_NAME} FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${AUTOMAP_SPEC_NAME}'"
run_sql "ALTER SERVICE ${AUTO_MAPPING_SERVICE_NAME} SET MIN_INSTANCES = 2, MAX_INSTANCES = 2"

echo
echo "Applying caller-role grants"
grant_role_if_set \
  "GRANT SERVICE ROLE ${AUTO_MAPPING_SERVICE_NAME}!backend_access TO ROLE __ROLE__" \
  "${SNOWFLAKE_ROLE}" \
  "${APP_ROLE_ADMIN}" \
  "${APP_ROLE_PUBLISHER}" \
  "${APP_ROLE_VIEWER}"
grant_role_if_set \
  "GRANT USAGE ON PROCEDURE ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.SP_GET_TABLE_RELATIONSHIPS(VARCHAR, VARCHAR, VARCHAR) TO ROLE __ROLE__" \
  "${SNOWFLAKE_ROLE}" \
  "${APP_ROLE_ADMIN}" \
  "${APP_ROLE_PUBLISHER}" \
  "${APP_ROLE_VIEWER}"

echo
echo "Public service endpoints"
run_sql "SHOW ENDPOINTS IN SERVICE ${WEBAPP_SERVICE_NAME}"

echo
echo "Private worker endpoints"
run_sql "SHOW ENDPOINTS IN SERVICE ${AUTO_MAPPING_SERVICE_NAME}"

echo
echo "Deployment complete."
echo "Rendered webapp spec: ${WEBAPP_SPEC_FILE}"
echo "Rendered worker spec: ${AUTOMAP_SPEC_FILE}"
