#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Load env
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../env/dev.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE}" >&2
  echo "       Copy env/dev.env.example → env/dev.env and fill in values." >&2
  exit 1
fi
set -a; source "${ENV_FILE}"; set +a

IMAGE_TAG="${IMAGE_TAG:-latest}"

DB_LOWER="${SNOWFLAKE_DATABASE,,}"
SCHEMA_LOWER="${SNOWFLAKE_SCHEMA,,}"
REPO_LOWER="${SNOWFLAKE_IMAGE_REPOSITORY,,}"
REGISTRY="${SNOWFLAKE_REGISTRY_HOST}/${DB_LOWER}/${SCHEMA_LOWER}/${REPO_LOWER}"

declare -A SERVICE_CONTEXTS=(
  [sttm-builder]="${REPO_ROOT}/services/sttm-builder"
  [api-gateway]="${REPO_ROOT}/services/api-gateway"
)

AVAILABLE="$(IFS="|"; echo "${!SERVICE_CONTEXTS[*]}")"

usage() {
  echo "Usage: $0 <service>" >&2
  echo "       service: ${AVAILABLE}" >&2
  exit 1
}

[[ $# -lt 1 ]] && usage

TARGET="$1"
CONTEXT="${SERVICE_CONTEXTS[${TARGET}]:-}"
if [[ -z "${CONTEXT}" ]]; then
  echo "ERROR: unknown service '${TARGET}'. Available: ${AVAILABLE}" >&2
  exit 1
fi

REMOTE_IMAGE="${REGISTRY}/${TARGET}:${IMAGE_TAG}"

# Login to Snowflake OCI registry
echo "→ Logging in to ${SNOWFLAKE_REGISTRY_HOST}"
docker login "${SNOWFLAKE_REGISTRY_HOST}" \
  --username "${SNOWFLAKE_USER:-$(whoami)}" \
  --password-stdin <<< "${SNOWFLAKE_PASSWORD:?SNOWFLAKE_PASSWORD is required}"

echo "→ Building ${TARGET}:${IMAGE_TAG}"
docker build --platform linux/amd64 -t "${REMOTE_IMAGE}" "${CONTEXT}"

echo "→ Pushing  ${REMOTE_IMAGE}"
docker push "${REMOTE_IMAGE}"

echo "✓ ${REMOTE_IMAGE} pushed to ${REGISTRY}"
