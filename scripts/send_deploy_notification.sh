#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${NOTIFICATION_TOPIC_ARN:-}" ]]; then
  echo "NOTIFICATION_TOPIC_ARN not set; skipping deployment notification."
  exit 0
fi

IMAGE_TAG="${IMAGE_TAG:-unknown}"
SERVICE_NAME="${SERVICE_NAME:-AI_WORKBENCH_DEV_WEBAPP}"
ENDPOINTS="$(cat "${ROOT_DIR}/artifacts/endpoints.txt" 2>/dev/null || echo "No endpoint output captured")"

aws sns publish \
  --topic-arn "${NOTIFICATION_TOPIC_ARN}" \
  --subject "BBI AI Workbench dev deploy: ${IMAGE_TAG}" \
  --message "Service: ${SERVICE_NAME}
Image tag: ${IMAGE_TAG}
Repository: ${CODEBUILD_SOURCE_REPO_URL:-bbi-mig-ai-workbench}
Commit: ${CODEBUILD_RESOLVED_SOURCE_VERSION:-unknown}

Endpoints:
${ENDPOINTS}"
