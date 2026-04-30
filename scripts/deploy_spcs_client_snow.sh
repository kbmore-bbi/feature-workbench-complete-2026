#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/infra/snowflake/env/client.env}"
TOOLS_VENV="${ROOT_DIR}/.client-tools-venv"
SNOW_BIN="${TOOLS_VENV}/bin/snow"
RENDER_SCRIPT="${ROOT_DIR}/scripts/render_spcs_spec.py"
SPEC_TEMPLATE="${ROOT_DIR}/infra/snowflake/service-specs/webapp.yaml.tmpl"
ARTIFACTS_DIR="${ROOT_DIR}/artifacts/client-spcs"
SKIP_BUILD="false"
SKIP_LOGIN="false"

if git -C "${ROOT_DIR}" rev-parse --short HEAD >/dev/null 2>&1; then
  DEFAULT_IMAGE_TAG="$(git -C "${ROOT_DIR}" rev-parse --short HEAD)"
else
  DEFAULT_IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
fi

IMAGE_TAG="${IMAGE_TAG:-${DEFAULT_IMAGE_TAG}}"

usage() {
  cat <<EOF
Usage: $0 [--env-file path] [--image-tag tag] [--skip-build] [--skip-login]

Deploys the integrated SPCS workbench using Snow CLI with an already configured
browser-authenticated connection.

This script:
  1. tests the Snow CLI connection
  2. logs Docker into the Snowflake image registry
  3. builds and pushes sttm-builder, frontend, and nginx images
  4. renders the single-service SPCS spec
  5. creates or upgrades the webapp service
  6. lists the public endpoints

Examples:
  $0
  $0 --env-file infra/snowflake/env/client.env --image-tag client-001
  $0 --skip-build
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
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
    --skip-login)
      SKIP_LOGIN="true"
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
  SNOWFLAKE_REGISTRY_HOST
  SNOWFLAKE_IMAGE_REPOSITORY
  SNOWFLAKE_COMPUTE_POOL
  WEBAPP_SERVICE_NAME
  SNOWFLAKE_EGRESS_INTEGRATION
  USERS_TABLE
  APP_ROLE_ADMIN
  APP_ROLE_PUBLISHER
  APP_ROLE_VIEWER
  SNOWFLAKE_STTM_BUILDER_AGENT
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "ERROR: ${var_name} must be set in ${ENV_FILE}" >&2
    exit 1
  fi
done

APP_NAME="${APP_NAME:-BBI AI Migration Workbench API}"
APP_ENV="${APP_ENV:-client}"
SNOWFLAKE_AGENT_ORCHESTRATION_MODEL="${SNOWFLAKE_AGENT_ORCHESTRATION_MODEL:-claude-sonnet-4}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but was not found in PATH." >&2
  exit 1
fi

echo "Testing Snow CLI connection '${SNOWFLAKE_CONNECTION}'"
"${SNOW_BIN}" connection test -c "${SNOWFLAKE_CONNECTION}"

if [[ "${SKIP_LOGIN}" != "true" ]]; then
  echo "Logging Docker into Snowflake image registry via Snow CLI"
  "${SNOW_BIN}" spcs image-registry login -c "${SNOWFLAKE_CONNECTION}"
else
  echo "Skipping image-registry login"
fi

export SNOWFLAKE_DATABASE_LOWER="$(printf "%s" "${SNOWFLAKE_DATABASE}" | tr '[:upper:]' '[:lower:]')"
export SNOWFLAKE_SCHEMA_LOWER="$(printf "%s" "${SNOWFLAKE_SCHEMA}" | tr '[:upper:]' '[:lower:]')"
export SNOWFLAKE_IMAGE_REPOSITORY_LOWER="$(printf "%s" "${SNOWFLAKE_IMAGE_REPOSITORY}" | tr '[:upper:]' '[:lower:]')"
export IMAGE_TAG
export APP_NAME
export APP_ENV
export USERS_TABLE
export APP_ROLE_ADMIN
export APP_ROLE_PUBLISHER
export APP_ROLE_VIEWER
export SNOWFLAKE_WAREHOUSE
export SNOWFLAKE_DATABASE
export SNOWFLAKE_SCHEMA
export SNOWFLAKE_STTM_BUILDER_AGENT
export SNOWFLAKE_AGENT_ORCHESTRATION_MODEL
export CORS_ALLOWED_ORIGINS

REGISTRY_BASE="${SNOWFLAKE_REGISTRY_HOST}/${SNOWFLAKE_DATABASE_LOWER}/${SNOWFLAKE_SCHEMA_LOWER}/${SNOWFLAKE_IMAGE_REPOSITORY_LOWER}"

build_and_push() {
  local name="$1"
  local context_dir="$2"
  local remote_image="${REGISTRY_BASE}/${name}:${IMAGE_TAG}"

  echo
  echo "Building ${name} -> ${remote_image}"
  docker build --platform linux/amd64 -t "${remote_image}" "${context_dir}"
  echo "Pushing ${remote_image}"
  docker push "${remote_image}"
}

if [[ "${SKIP_BUILD}" != "true" ]]; then
  build_and_push "sttm-builder" "${ROOT_DIR}/services/sttm-builder"
  build_and_push "frontend" "${ROOT_DIR}/frontend"
  build_and_push "nginx" "${ROOT_DIR}/nginx"
else
  echo "Skipping Docker build/push"
fi

mkdir -p "${ARTIFACTS_DIR}"
RENDERED_SPEC="${ARTIFACTS_DIR}/webapp.${IMAGE_TAG}.yaml"

echo
echo "Rendering service spec to ${RENDERED_SPEC}"
python3 "${RENDER_SCRIPT}" --template "${SPEC_TEMPLATE}" --output "${RENDERED_SPEC}"

echo
echo "Creating service '${WEBAPP_SERVICE_NAME}' if needed"
"${SNOW_BIN}" spcs service create "${WEBAPP_SERVICE_NAME}" \
  --connection "${SNOWFLAKE_CONNECTION}" \
  --database "${SNOWFLAKE_DATABASE}" \
  --schema "${SNOWFLAKE_SCHEMA}" \
  --role "${SNOWFLAKE_ROLE}" \
  --warehouse "${SNOWFLAKE_WAREHOUSE}" \
  --compute-pool "${SNOWFLAKE_COMPUTE_POOL}" \
  --spec-path "${RENDERED_SPEC}" \
  --eai-name "${SNOWFLAKE_EGRESS_INTEGRATION}" \
  --if-not-exists \
  --format TABLE

echo
echo "Upgrading service '${WEBAPP_SERVICE_NAME}' to the latest spec"
"${SNOW_BIN}" spcs service upgrade "${WEBAPP_SERVICE_NAME}" \
  --connection "${SNOWFLAKE_CONNECTION}" \
  --database "${SNOWFLAKE_DATABASE}" \
  --schema "${SNOWFLAKE_SCHEMA}" \
  --role "${SNOWFLAKE_ROLE}" \
  --warehouse "${SNOWFLAKE_WAREHOUSE}" \
  --spec-path "${RENDERED_SPEC}" \
  --format TABLE

echo
echo "Listing service endpoints"
"${SNOW_BIN}" spcs service list-endpoints "${WEBAPP_SERVICE_NAME}" \
  --connection "${SNOWFLAKE_CONNECTION}" \
  --database "${SNOWFLAKE_DATABASE}" \
  --schema "${SNOWFLAKE_SCHEMA}" \
  --role "${SNOWFLAKE_ROLE}" \
  --warehouse "${SNOWFLAKE_WAREHOUSE}" \
  --format TABLE

echo
echo "Deployment complete."
echo "Rendered spec: ${RENDERED_SPEC}"
echo "Next checks:"
echo "  1. snow spcs service status ${WEBAPP_SERVICE_NAME} -c ${SNOWFLAKE_CONNECTION} --database ${SNOWFLAKE_DATABASE} --schema ${SNOWFLAKE_SCHEMA}"
echo "  2. snow spcs service list-containers ${WEBAPP_SERVICE_NAME} -c ${SNOWFLAKE_CONNECTION} --database ${SNOWFLAKE_DATABASE} --schema ${SNOWFLAKE_SCHEMA}"
echo "  3. Open the public endpoint from the command output and verify Snowflake/Okta sign-in"
