#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy the BBI AI Migration Workbench to Snowpark Container Services
#
# Public service:
#   nginx + frontend + backend
#
# Private service:
#   automap worker (dedicated compute pool, fixed 2 instances)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_ENV_FILE="${CLIENT_ENV_FILE:-${ROOT_DIR}/infra/snowflake/env/client.env}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${ROOT_DIR}/services/sttm-builder/.env.local}"
PYTHON_BIN="${PYTHON_BIN:-${ROOT_DIR}/services/sttm-builder/.venv/bin/python}"
RENDER_SCRIPT="${ROOT_DIR}/scripts/render_spcs_spec.py"
ARTIFACTS_DIR="${ROOT_DIR}/artifacts/client-spcs-v2"
DEFAULT_IMAGE_TAG="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
if ! git -C "${ROOT_DIR}" diff --quiet --ignore-submodules -- 2>/dev/null || ! git -C "${ROOT_DIR}" diff --cached --quiet --ignore-submodules -- 2>/dev/null; then
  DEFAULT_IMAGE_TAG="${DEFAULT_IMAGE_TAG}-$(date +%Y%m%d%H%M%S)"
fi
IMAGE_TAG="${IMAGE_TAG:-${DEFAULT_IMAGE_TAG}}"
SKIP_BUILD="${SKIP_BUILD:-false}"

if [[ ! -f "${CLIENT_ENV_FILE}" ]]; then
  echo "Missing client env file: ${CLIENT_ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${LOCAL_ENV_FILE}" ]]; then
  echo "Missing local env file: ${LOCAL_ENV_FILE}" >&2
  exit 1
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Missing python interpreter: ${PYTHON_BIN}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not found in PATH" >&2
  exit 1
fi

if ! command -v snowsql >/dev/null 2>&1; then
  echo "snowsql is required but not found in PATH" >&2
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
  if [[ -z "${current_value}" || "${current_value}" == "http://:8000" || "${current_value}" == "${short_http}" || "${current_value}" == "${short_https}" ]]; then
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
    echo "Missing required environment variable: ${var_name}" >&2
    exit 1
  fi
done

export SNOWSQL_PWD="${SNOWFLAKE_PASSWORD}"

SNOWFLAKE_DATABASE_LOWER="$(printf "%s" "${SNOWFLAKE_DATABASE}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_SCHEMA_LOWER="$(printf "%s" "${SNOWFLAKE_SCHEMA}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_IMAGE_REPOSITORY_LOWER="$(printf "%s" "${SNOWFLAKE_IMAGE_REPOSITORY}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_REST_HOST="${SNOWFLAKE_REST_HOST:-$(dns_label "${SNOWFLAKE_ACCOUNT}").snowflakecomputing.com}"
AUTO_MAPPING_SERVICE_NAME_LOWER="$(dns_label "${AUTO_MAPPING_SERVICE_NAME}")"
AUTO_MAPPING_ENDPOINT_NAME="${AUTO_MAPPING_ENDPOINT_NAME:-api}"
AUTO_MAPPING_ENDPOINT_NAME_LOWER="$(dns_label "${AUTO_MAPPING_ENDPOINT_NAME}")"
AUTO_MAPPING_SCHEMA_DNS="$(dns_label "${SNOWFLAKE_SCHEMA}")"
AUTO_MAPPING_DATABASE_DNS="$(dns_label "${SNOWFLAKE_DATABASE}")"
AUTO_MAPPING_INTERNAL_HOST=""

normalize_qualified_name_var SNOWFLAKE_STTM_BUILDER_AGENT
normalize_qualified_name_var SNOWFLAKE_SOURCE_MAPPING_AGENT
normalize_qualified_name_var SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT
normalize_qualified_name_var SNOWFLAKE_SEMANTIC_MODEL_AGENT
normalize_qualified_name_var SNOWFLAKE_DBT_CONVERSION_AGENT
normalize_qualified_name_var SNOWFLAKE_RELATIONSHIPS_PROCEDURE

export SNOWFLAKE_DATABASE_LOWER
export SNOWFLAKE_SCHEMA_LOWER
export SNOWFLAKE_IMAGE_REPOSITORY_LOWER
export SNOWFLAKE_REST_HOST
export AUTO_MAPPING_SERVICE_NAME_LOWER
export AUTO_MAPPING_ENDPOINT_NAME_LOWER
export AUTO_MAPPING_SCHEMA_DNS
export AUTO_MAPPING_DATABASE_DNS
export IMAGE_TAG
export APP_NAME="${APP_NAME:-BBI AI Migration Workbench API}"
export APP_ENV="${APP_ENV:-dev}"
export USERS_TABLE="${USERS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_USERS}"
export APP_ROLE_ADMIN="${APP_ROLE_ADMIN:-FOCUS_ADMIN}"
export APP_ROLE_PUBLISHER="${APP_ROLE_PUBLISHER:-WORKBENCH_PUBLISHER}"
export APP_ROLE_VIEWER="${APP_ROLE_VIEWER:-WORKBENCH_VIEWER}"
export SNOWFLAKE_HOST="${SNOWFLAKE_HOST:-}"
export SNOWFLAKE_STTM_BUILDER_AGENT="${SNOWFLAKE_STTM_BUILDER_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_STTM_BUILDER}"
export SNOWFLAKE_SOURCE_MAPPING_AGENT="${SNOWFLAKE_SOURCE_MAPPING_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_SOURCE_MAPPING}"
export SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT="${SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_WORKBENCH_CONVERSATION}"
export SNOWFLAKE_SEMANTIC_MODEL_AGENT="${SNOWFLAKE_SEMANTIC_MODEL_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_SEMANTIC_MODEL}"
export SNOWFLAKE_DBT_CONVERSION_AGENT="${SNOWFLAKE_DBT_CONVERSION_AGENT:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.AGT_DBT_CONVERSION}"
export SNOWFLAKE_RELATIONSHIPS_PROCEDURE="${SNOWFLAKE_RELATIONSHIPS_PROCEDURE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.SP_GET_TABLE_RELATIONSHIPS}"
export SNOWFLAKE_SEMANTIC_MODEL_TABLE="${SNOWFLAKE_SEMANTIC_MODEL_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_SEMANTIC_MODELS}"
export SNOWFLAKE_SEMANTIC_BUNDLES_TABLE="${SNOWFLAKE_SEMANTIC_BUNDLES_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_SEMANTIC_BUNDLES}"
export SNOWFLAKE_SEMANTIC_OVERRIDES_TABLE="${SNOWFLAKE_SEMANTIC_OVERRIDES_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_SEMANTIC_OVERRIDES}"
export SNOWFLAKE_DERIVED_SOURCES_TABLE="${SNOWFLAKE_DERIVED_SOURCES_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_DERIVED_SOURCES}"
export SNOWFLAKE_CONVERSATION_TURNS_TABLE="${SNOWFLAKE_CONVERSATION_TURNS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_CONVERSATION_TURNS}"
export SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE="${SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_FEEDBACK}"
export SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE="${SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_RECOMMENDATIONS}"
export SNOWFLAKE_RELATIONSHIP_FACTS_TABLE="${SNOWFLAKE_RELATIONSHIP_FACTS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_RELATIONSHIP_FACTS}"
export SNOWFLAKE_RAG_DOCUMENTS_TABLE="${SNOWFLAKE_RAG_DOCUMENTS_TABLE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.TBL_WORKBENCH_RAG_DOCUMENTS}"
export SNOWFLAKE_RAG_SEARCH_SERVICE="${SNOWFLAKE_RAG_SEARCH_SERVICE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.CSS_WORKBENCH_RAG}"
export SNOWFLAKE_AGENT_ORCHESTRATION_MODEL="${SNOWFLAKE_AGENT_ORCHESTRATION_MODEL:-claude-sonnet-4}"
export AUTO_MAPPING_SERVICE_URL="${AUTO_MAPPING_SERVICE_URL:-}"
export AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS="${AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS:-300}"
export AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS="${AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS:-2}"
export AUTO_MAPPING_WORKER_MAX_CONCURRENCY="${AUTO_MAPPING_WORKER_MAX_CONCURRENCY:-5}"
export AUTO_MAPPING_PROXY_BATCH_SIZE="${AUTO_MAPPING_PROXY_BATCH_SIZE:-17}"
export AUTO_MAPPING_PROXY_MAX_IN_FLIGHT="${AUTO_MAPPING_PROXY_MAX_IN_FLIGHT:-2}"
export SPCS_EXECUTE_AS_CALLER_ENABLED="${SPCS_EXECUTE_AS_CALLER_ENABLED:-true}"
export SNOWFLAKE_SESSION_RETRY_ATTEMPTS="${SNOWFLAKE_SESSION_RETRY_ATTEMPTS:-2}"
export SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS="${SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS:-1.0}"
export SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS="${SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS:-1800}"
export SNOWFLAKE_AGENT_RETRY_ATTEMPTS="${SNOWFLAKE_AGENT_RETRY_ATTEMPTS:-3}"
export SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS="${SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS:-1.0}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-}"
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

REGISTRY="${SNOWFLAKE_REGISTRY_HOST}"
REPO="${REGISTRY}/${SNOWFLAKE_DATABASE_LOWER}/${SNOWFLAKE_SCHEMA_LOWER}/${SNOWFLAKE_IMAGE_REPOSITORY_LOWER}"
WEBAPP_IMAGE="${REPO}/sttm-builder:${IMAGE_TAG}"
AUTOMAP_IMAGE="${REPO}/sttm-automap-worker:${IMAGE_TAG}"
FRONTEND_IMAGE="${REPO}/frontend:${IMAGE_TAG}"
NGINX_IMAGE="${REPO}/nginx:${IMAGE_TAG}"
DEPLOY_STAGE="${SNOWFLAKE_DEPLOY_STAGE:-${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.WORKBENCH_SPCS_DEPLOY_STAGE}"

mkdir -p "${ARTIFACTS_DIR}"
WEBAPP_SPEC_FILE="${ARTIFACTS_DIR}/webapp.${IMAGE_TAG}.yaml"
AUTOMAP_SPEC_FILE="${ARTIFACTS_DIR}/automap-worker.${IMAGE_TAG}.yaml"
WEBAPP_SPEC_NAME="webapp.${IMAGE_TAG}.yaml"
AUTOMAP_SPEC_NAME="automap-worker.${IMAGE_TAG}.yaml"

run_sql() {
  local sql="$1"
  snowsql \
    -a "${SNOWFLAKE_ACCOUNT}" \
    -u "${SNOWFLAKE_USER}" \
    -w "${SNOWFLAKE_WAREHOUSE}" \
    -r "${SNOWFLAKE_ROLE}" \
    -d "${SNOWFLAKE_DATABASE}" \
    -s "${SNOWFLAKE_SCHEMA}" \
    -o friendly=false \
    -o output_format=plain \
    -q "${sql}"
}

run_sql_scalar() {
  local sql="$1"
  snowsql \
    -a "${SNOWFLAKE_ACCOUNT}" \
    -u "${SNOWFLAKE_USER}" \
    -w "${SNOWFLAKE_WAREHOUSE}" \
    -r "${SNOWFLAKE_ROLE}" \
    -d "${SNOWFLAKE_DATABASE}" \
    -s "${SNOWFLAKE_SCHEMA}" \
    -o friendly=false \
    -o header=false \
    -o output_format=tsv \
    -q "${sql}" 2>/dev/null | awk 'NF {print $1; exit}'
}

SERVICE_DNS_DOMAIN="${SNOWFLAKE_SERVICE_DNS_DOMAIN:-$(run_sql_scalar "SELECT SYSTEM\$GET_SERVICE_DNS_DOMAIN('${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}');")}"
if [[ -z "${SERVICE_DNS_DOMAIN}" ]]; then
  echo "Failed to resolve Snowflake internal service DNS domain via SYSTEM\$GET_SERVICE_DNS_DOMAIN()" >&2
  exit 1
fi
# Service-to-service DNS for Snowpark Container Services resolves reliably with
# the service/schema/database Snowflake internal FQN. The endpoint-qualified
# SYSTEM$GET_SERVICE_DNS_DOMAIN form can render but fail DNS resolution from the
# sibling webapp service in this deployment.
AUTO_MAPPING_INTERNAL_HOST="${AUTO_MAPPING_SERVICE_NAME_LOWER}.${AUTO_MAPPING_SCHEMA_DNS}.${AUTO_MAPPING_DATABASE_DNS}.snowflakecomputing.internal"
normalize_auto_mapping_url
export SERVICE_DNS_DOMAIN
export AUTO_MAPPING_INTERNAL_HOST

build_and_push() {
  local full_image="$1"
  local context_dir="$2"

  docker build --platform linux/amd64 -t "${full_image}" "${context_dir}"
  docker push "${full_image}"
}

upload_spec() {
  local source_file="$1"
  run_sql "PUT 'file://${source_file}' @${DEPLOY_STAGE} AUTO_COMPRESS=FALSE OVERWRITE=TRUE;"
}

poll_service() {
  local service_name="$1"
  local label="$2"

  echo ""
  echo "Waiting for ${label} (${service_name}) to become READY..."
  for i in $(seq 1 30); do
    local status
    status="$(snowsql \
      -a "${SNOWFLAKE_ACCOUNT}" \
      -u "${SNOWFLAKE_USER}" \
      -w "${SNOWFLAKE_WAREHOUSE}" \
      -r "${SNOWFLAKE_ROLE}" \
      -d "${SNOWFLAKE_DATABASE}" \
      -s "${SNOWFLAKE_SCHEMA}" \
      -o friendly=false \
      -o header=false \
      -o output_format=tsv \
      -q "SHOW SERVICES LIKE '${service_name}';" \
      2>/dev/null | awk 'NF {print $2; exit}')"

    echo "  [${i}/30] ${label}: ${status}"

    if [[ "${status}" == "RUNNING" || "${status}" == "READY" ]]; then
      return 0
    fi

    if [[ "${status}" == "FAILED" ]]; then
      echo "  ${label} failed. Current service status payload:"
      run_sql "SELECT SYSTEM\$GET_SERVICE_STATUS('${service_name}')"
      return 1
    fi

    sleep 20
  done

  echo "Timed out waiting for ${service_name} to become READY" >&2
  run_sql "SELECT SYSTEM\$GET_SERVICE_STATUS('${service_name}')"
  return 1
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

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " BBI AI Migration Workbench — SPCS Deployment"
echo "═══════════════════════════════════════════════════════════"
echo " Registry        : ${REGISTRY}"
echo " Webapp service  : ${WEBAPP_SERVICE_NAME}"
echo " Worker service  : ${AUTO_MAPPING_SERVICE_NAME}"
echo " Webapp pool     : ${SNOWFLAKE_COMPUTE_POOL}"
echo " Worker pool     : ${AUTO_MAPPING_COMPUTE_POOL}"
echo " Image tag       : ${IMAGE_TAG}"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "▶ Step 1/7  Verifying Snowflake access..."
run_sql "SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_DATABASE(), CURRENT_SCHEMA();"

echo ""
echo "▶ Step 2/7  Ensuring compute pools exist..."
run_sql "CREATE COMPUTE POOL IF NOT EXISTS ${SNOWFLAKE_COMPUTE_POOL} MIN_NODES = 1 MAX_NODES = 1 INSTANCE_FAMILY = CPU_X64_S AUTO_RESUME = TRUE AUTO_SUSPEND_SECS = 3600;"
run_sql "CREATE COMPUTE POOL IF NOT EXISTS ${AUTO_MAPPING_COMPUTE_POOL} MIN_NODES = 2 MAX_NODES = 2 INSTANCE_FAMILY = CPU_X64_S AUTO_RESUME = TRUE AUTO_SUSPEND_SECS = 3600;"

echo ""
echo "▶ Step 3/7  Docker login to Snowflake registry..."
echo "${SNOWSQL_PWD}" | docker login "${REGISTRY}" \
  --username "${SNOWFLAKE_USER}" \
  --password-stdin

echo ""
echo "▶ Step 4/7  Building and pushing images..."
if [[ "${SKIP_BUILD}" != "true" ]]; then
  build_and_push "${WEBAPP_IMAGE}" "${ROOT_DIR}/services/sttm-builder"
  build_and_push "${AUTOMAP_IMAGE}" "${ROOT_DIR}/services/sttm-builder"
  build_and_push "${FRONTEND_IMAGE}" "${ROOT_DIR}/frontend"
  build_and_push "${NGINX_IMAGE}" "${ROOT_DIR}/nginx"
else
  echo "  Skipping Docker build/push"
fi

echo ""
echo "▶ Step 5/7  Rendering and uploading service specs..."
"${PYTHON_BIN}" "${RENDER_SCRIPT}" --template "${ROOT_DIR}/infra/snowflake/service-specs/webapp.yaml.tmpl" --output "${WEBAPP_SPEC_FILE}"
"${PYTHON_BIN}" "${RENDER_SCRIPT}" --template "${ROOT_DIR}/infra/snowflake/service-specs/automap-worker.yaml.tmpl" --output "${AUTOMAP_SPEC_FILE}"
run_sql "CREATE STAGE IF NOT EXISTS ${DEPLOY_STAGE};"
upload_spec "${WEBAPP_SPEC_FILE}"
upload_spec "${AUTOMAP_SPEC_FILE}"

echo ""
echo "▶ Step 6/7  Deploying services..."
run_sql "CREATE SERVICE IF NOT EXISTS ${WEBAPP_SERVICE_NAME} IN COMPUTE POOL ${SNOWFLAKE_COMPUTE_POOL} FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${WEBAPP_SPEC_NAME}' EXTERNAL_ACCESS_INTEGRATIONS = (${SNOWFLAKE_EGRESS_INTEGRATION}) MIN_INSTANCES = 1 MAX_INSTANCES = 1;"
run_sql "ALTER SERVICE ${WEBAPP_SERVICE_NAME} FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${WEBAPP_SPEC_NAME}';"
run_sql "ALTER SERVICE ${WEBAPP_SERVICE_NAME} RESUME;"
run_sql "CREATE SERVICE IF NOT EXISTS ${AUTO_MAPPING_SERVICE_NAME} IN COMPUTE POOL ${AUTO_MAPPING_COMPUTE_POOL} FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${AUTOMAP_SPEC_NAME}' EXTERNAL_ACCESS_INTEGRATIONS = (${SNOWFLAKE_EGRESS_INTEGRATION}) MIN_INSTANCES = 2 MAX_INSTANCES = 2;"
run_sql "ALTER SERVICE ${AUTO_MAPPING_SERVICE_NAME} FROM @${DEPLOY_STAGE} SPECIFICATION_FILE='${AUTOMAP_SPEC_NAME}';"
run_sql "ALTER SERVICE ${AUTO_MAPPING_SERVICE_NAME} SET MIN_INSTANCES = 2, MAX_INSTANCES = 2;"
run_sql "ALTER SERVICE ${AUTO_MAPPING_SERVICE_NAME} RESUME;"

echo ""
echo "▶ Step 6a/7  Applying caller-role grants..."
grant_role_if_set \
  "GRANT SERVICE ROLE ${AUTO_MAPPING_SERVICE_NAME}!backend_access TO ROLE __ROLE__;" \
  "${SNOWFLAKE_ROLE}" \
  "${APP_ROLE_ADMIN}" \
  "${APP_ROLE_PUBLISHER}" \
  "${APP_ROLE_VIEWER}"
grant_role_if_set \
  "GRANT USAGE ON PROCEDURE ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.SP_GET_TABLE_RELATIONSHIPS(VARCHAR, VARCHAR, VARCHAR) TO ROLE __ROLE__;" \
  "${SNOWFLAKE_ROLE}" \
  "${APP_ROLE_ADMIN}" \
  "${APP_ROLE_PUBLISHER}" \
  "${APP_ROLE_VIEWER}"
run_sql "GRANT CALLER INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ${SNOWFLAKE_SEMANTIC_BUNDLES_TABLE} TO ROLE ${SNOWFLAKE_ROLE};"
run_sql "GRANT CALLER INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ${SNOWFLAKE_SEMANTIC_OVERRIDES_TABLE} TO ROLE ${SNOWFLAKE_ROLE};"
run_sql "GRANT CALLER INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ${SNOWFLAKE_DERIVED_SOURCES_TABLE} TO ROLE ${SNOWFLAKE_ROLE};"

echo ""
echo "▶ Step 7/7  Waiting for readiness and printing endpoints..."
poll_service "${WEBAPP_SERVICE_NAME}" "Public webapp"
poll_service "${AUTO_MAPPING_SERVICE_NAME}" "Private automap worker"

echo ""
echo "Public service endpoints:"
run_sql "SHOW ENDPOINTS IN SERVICE ${WEBAPP_SERVICE_NAME};"
echo ""
echo "Private service endpoints:"
run_sql "SHOW ENDPOINTS IN SERVICE ${AUTO_MAPPING_SERVICE_NAME};"

echo ""
echo "✅ Deployment submitted successfully."
