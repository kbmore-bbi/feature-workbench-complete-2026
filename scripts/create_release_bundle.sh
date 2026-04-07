#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/release"
VERSION_LABEL="${VERSION_LABEL:-$(git rev-parse --short HEAD)}"
OUTPUT_DIR="${RELEASE_DIR}/${VERSION_LABEL}"

mkdir -p "${OUTPUT_DIR}"

git -C "${ROOT_DIR}" archive --format=tar.gz --output="${OUTPUT_DIR}/source.tar.gz" HEAD

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${OUTPUT_DIR}/source.tar.gz" > "${OUTPUT_DIR}/checksums.txt"
else
  shasum -a 256 "${OUTPUT_DIR}/source.tar.gz" > "${OUTPUT_DIR}/checksums.txt"
fi

cat > "${OUTPUT_DIR}/release-metadata.json" <<EOF
{
  "version": "${VERSION_LABEL}",
  "commit": "$(git -C "${ROOT_DIR}" rev-parse HEAD)",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "artifacts": [
    "source.tar.gz",
    "checksums.txt"
  ]
}
EOF

if [[ "${INCLUDE_IMAGE_BUNDLE:-false}" == "true" ]]; then
  require_images=(
    "bbi-mig-ai-workbench/frontend:${VERSION_LABEL}"
    "bbi-mig-ai-workbench/backend:${VERSION_LABEL}"
    "bbi-mig-ai-workbench/nginx:${VERSION_LABEL}"
  )

  for image in "${require_images[@]}"; do
    docker image inspect "${image}" >/dev/null
  done

  docker save \
    "bbi-mig-ai-workbench/frontend:${VERSION_LABEL}" \
    "bbi-mig-ai-workbench/backend:${VERSION_LABEL}" \
    "bbi-mig-ai-workbench/nginx:${VERSION_LABEL}" \
    -o "${OUTPUT_DIR}/images.tar"
fi

echo "Release bundle written to ${OUTPUT_DIR}"

