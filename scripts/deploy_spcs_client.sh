#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/infra/snowflake/env/client.env}"
BUILD_SCRIPT="${ROOT_DIR}/infra/snowflake/scripts/build-and-push.sh"
DEPLOY_SCRIPT="${ROOT_DIR}/infra/snowflake/scripts/deploy.sh"

if git -C "${ROOT_DIR}" rev-parse --short HEAD >/dev/null 2>&1; then
  DEFAULT_IMAGE_TAG="$(git -C "${ROOT_DIR}" rev-parse --short HEAD)"
else
  DEFAULT_IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
fi

IMAGE_TAG="${IMAGE_TAG:-${DEFAULT_IMAGE_TAG}}"
SKIP_BUILD="false"

usage() {
  cat <<EOF
Usage: $0 [--env-file path] [--image-tag tag] [--skip-build]

Builds and pushes:
  - sttm-builder
  - frontend
  - nginx

Then deploys:
  - webapp (single-service SPCS deployment)

Examples:
  $0 --env-file infra/snowflake/env/client.env
  $0 --env-file infra/snowflake/env/client.env --image-tag client-001
  $0 --env-file infra/snowflake/env/client.env --skip-build
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
  echo "Copy infra/snowflake/env/client.env.example to client.env and fill in client values." >&2
  exit 1
fi

echo "Using env file: ${ENV_FILE}"
echo "Using image tag: ${IMAGE_TAG}"

if [[ "${SKIP_BUILD}" != "true" ]]; then
  ENV_FILE="${ENV_FILE}" IMAGE_TAG="${IMAGE_TAG}" "${BUILD_SCRIPT}" sttm-builder
  ENV_FILE="${ENV_FILE}" IMAGE_TAG="${IMAGE_TAG}" "${BUILD_SCRIPT}" frontend
  ENV_FILE="${ENV_FILE}" IMAGE_TAG="${IMAGE_TAG}" "${BUILD_SCRIPT}" nginx
else
  echo "Skipping image build/push"
fi

ENV_FILE="${ENV_FILE}" IMAGE_TAG="${IMAGE_TAG}" "${DEPLOY_SCRIPT}" webapp

echo
echo "Deployment complete."
echo "Next checks:"
echo "  1. SHOW SERVICES IN SCHEMA <db>.<schema>;"
echo "  2. SHOW ENDPOINTS IN SERVICE <webapp_service_name>;"
echo "  3. DESCRIBE SERVICE <db>.<schema>.<webapp_service_name>;"
echo "  4. Open the public endpoint and verify Snowflake/Okta sign-in"
