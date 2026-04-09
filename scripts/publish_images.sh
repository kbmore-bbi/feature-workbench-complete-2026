#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"${ROOT_DIR}/scripts/build_images.sh"
"${ROOT_DIR}/scripts/promote_images.sh"
