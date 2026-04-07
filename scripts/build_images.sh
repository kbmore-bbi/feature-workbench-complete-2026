#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/common.sh
source "${ROOT_DIR}/scripts/common.sh"

AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
IMAGE_TAG="${IMAGE_TAG:-$(short_sha)}"

ECR_FRONTEND_REPO="${ECR_FRONTEND_REPO:-bbi-mig-ai-workbench/frontend}"
ECR_BACKEND_REPO="${ECR_BACKEND_REPO:-bbi-mig-ai-workbench/backend}"
ECR_NGINX_REPO="${ECR_NGINX_REPO:-bbi-mig-ai-workbench/nginx}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

mkdir -p "${ROOT_DIR}/artifacts"
printf "IMAGE_TAG=%s\n" "${IMAGE_TAG}" > "${ROOT_DIR}/artifacts/image.env"

export DOCKER_BUILDKIT=1

aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

docker build --platform linux/amd64 -t "${ECR_REGISTRY}/${ECR_BACKEND_REPO}:${IMAGE_TAG}" "${ROOT_DIR}/backend"
docker push "${ECR_REGISTRY}/${ECR_BACKEND_REPO}:${IMAGE_TAG}"

docker build --platform linux/amd64 -t "${ECR_REGISTRY}/${ECR_FRONTEND_REPO}:${IMAGE_TAG}" "${ROOT_DIR}/frontend"
docker push "${ECR_REGISTRY}/${ECR_FRONTEND_REPO}:${IMAGE_TAG}"

docker build --platform linux/amd64 -t "${ECR_REGISTRY}/${ECR_NGINX_REPO}:${IMAGE_TAG}" "${ROOT_DIR}/nginx"
docker push "${ECR_REGISTRY}/${ECR_NGINX_REPO}:${IMAGE_TAG}"
