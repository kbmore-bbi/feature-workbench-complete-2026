#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${ROOT_DIR}/scripts/common.sh"

load_snowflake_secret

AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
IMAGE_TAG="${IMAGE_TAG:-$(short_sha)}"

ECR_FRONTEND_REPO="${ECR_FRONTEND_REPO:-bbi-mig-ai-workbench/frontend}"
ECR_BACKEND_REPO="${ECR_BACKEND_REPO:-bbi-mig-ai-workbench/backend}"
ECR_NGINX_REPO="${ECR_NGINX_REPO:-bbi-mig-ai-workbench/nginx}"

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
SNOWFLAKE_REPO_LOWER="$(printf "%s" "${SNOWFLAKE_IMAGE_REPOSITORY}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_DB_LOWER="$(printf "%s" "${SNOWFLAKE_DATABASE}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_SCHEMA_LOWER="$(printf "%s" "${SNOWFLAKE_SCHEMA}" | tr '[:upper:]' '[:lower:]')"
SNOWFLAKE_BASE="${SNOWFLAKE_REGISTRY_HOST}/${SNOWFLAKE_DB_LOWER}/${SNOWFLAKE_SCHEMA_LOWER}/${SNOWFLAKE_REPO_LOWER}"
BLOCKING_SEVERITIES="${BLOCKING_SEVERITIES:-CRITICAL}"
ECR_SCAN_WAIT_ATTEMPTS="${ECR_SCAN_WAIT_ATTEMPTS:-60}"
ECR_SCAN_WAIT_DELAY_SECONDS="${ECR_SCAN_WAIT_DELAY_SECONDS:-15}"

mkdir -p "${ROOT_DIR}/artifacts"
printf "IMAGE_TAG=%s\n" "${IMAGE_TAG}" > "${ROOT_DIR}/artifacts/image.env"

wait_for_scan() {
  local repository="$1"
  local attempt
  local status=""

  for ((attempt=1; attempt<=ECR_SCAN_WAIT_ATTEMPTS; attempt++)); do
    status="$(aws ecr describe-image-scan-findings \
      --region "${AWS_REGION}" \
      --repository-name "${repository}" \
      --image-id imageTag="${IMAGE_TAG}" \
      --query 'imageScanStatus.status' \
      --output text 2>/dev/null || true)"

    if [[ "${status}" == "COMPLETE" ]]; then
      return 0
    fi

    if [[ "${status}" == "FAILED" ]]; then
      echo "ECR scan failed for ${repository}:${IMAGE_TAG}" >&2
      return 1
    fi

    sleep "${ECR_SCAN_WAIT_DELAY_SECONDS}"
  done

  echo "Timed out waiting for ECR scan on ${repository}:${IMAGE_TAG}" >&2
  return 1
}

assert_scan_passes() {
  local repository="$1"
  local findings_json

  findings_json="$(aws ecr describe-image-scan-findings \
    --region "${AWS_REGION}" \
    --repository-name "${repository}" \
    --image-id imageTag="${IMAGE_TAG}" \
    --query 'imageScanFindings.findingSeverityCounts' \
    --output json)"

  python3 - "${findings_json}" "${BLOCKING_SEVERITIES}" "${repository}" <<'PY'
import json
import sys

counts = json.loads(sys.argv[1] or "{}")
blocked = {item.strip().upper() for item in sys.argv[2].split(",") if item.strip()}
repository = sys.argv[3]
hits = {severity: counts.get(severity, 0) for severity in blocked if counts.get(severity, 0)}

if hits:
    raise SystemExit(f"ECR scan gate failed for {repository}: {hits}")

print(f"ECR scan gate passed for {repository}: {counts}")
PY
}

aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"
echo "${SNOWFLAKE_REGISTRY_PASSWORD}" | docker login --username "${SNOWFLAKE_REGISTRY_USERNAME}" --password-stdin "${SNOWFLAKE_REGISTRY_HOST}"

docker build --platform linux/amd64 -t "${ECR_REGISTRY}/${ECR_BACKEND_REPO}:${IMAGE_TAG}" "${ROOT_DIR}/backend"
docker push "${ECR_REGISTRY}/${ECR_BACKEND_REPO}:${IMAGE_TAG}"

docker build --platform linux/amd64 -t "${ECR_REGISTRY}/${ECR_FRONTEND_REPO}:${IMAGE_TAG}" "${ROOT_DIR}/frontend"
docker push "${ECR_REGISTRY}/${ECR_FRONTEND_REPO}:${IMAGE_TAG}"

docker build --platform linux/amd64 -t "${ECR_REGISTRY}/${ECR_NGINX_REPO}:${IMAGE_TAG}" "${ROOT_DIR}/nginx"
docker push "${ECR_REGISTRY}/${ECR_NGINX_REPO}:${IMAGE_TAG}"

wait_for_scan "${ECR_BACKEND_REPO}"
wait_for_scan "${ECR_FRONTEND_REPO}"
wait_for_scan "${ECR_NGINX_REPO}"

assert_scan_passes "${ECR_BACKEND_REPO}"
assert_scan_passes "${ECR_FRONTEND_REPO}"
assert_scan_passes "${ECR_NGINX_REPO}"

docker tag "${ECR_REGISTRY}/${ECR_BACKEND_REPO}:${IMAGE_TAG}" "${SNOWFLAKE_BASE}/backend:${IMAGE_TAG}"
docker tag "${ECR_REGISTRY}/${ECR_FRONTEND_REPO}:${IMAGE_TAG}" "${SNOWFLAKE_BASE}/frontend:${IMAGE_TAG}"
docker tag "${ECR_REGISTRY}/${ECR_NGINX_REPO}:${IMAGE_TAG}" "${SNOWFLAKE_BASE}/nginx:${IMAGE_TAG}"

docker push "${SNOWFLAKE_BASE}/backend:${IMAGE_TAG}"
docker push "${SNOWFLAKE_BASE}/frontend:${IMAGE_TAG}"
docker push "${SNOWFLAKE_BASE}/nginx:${IMAGE_TAG}"
