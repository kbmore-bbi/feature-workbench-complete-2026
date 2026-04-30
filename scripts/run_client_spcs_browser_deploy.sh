#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/infra/snowflake/env/client.env}"
IMAGE_TAG="${IMAGE_TAG:-}"
SKIP_BUILD="false"
SKIP_LOGIN="false"
FORCE_RECREATE_CONNECTION="false"
PYTHON_BIN="${PYTHON_BIN:-}"
SNOWFLAKE_CLI_VERSION="${SNOWFLAKE_CLI_VERSION:-}"

usage() {
  cat <<EOF
Usage: $0 [--env-file path] [--image-tag tag] [--skip-build] [--skip-login] [--force-recreate-connection]

Bootstraps the local client deployment tools, configures a browser-authenticated
Snow CLI connection, and deploys the integrated single-service SPCS workbench.

Examples:
  $0
  $0 --env-file infra/snowflake/env/client.env --image-tag client-001
  $0 --skip-build
  $0 --force-recreate-connection
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
    --force-recreate-connection)
      FORCE_RECREATE_CONNECTION="true"
      shift
      ;;
    --python)
      PYTHON_BIN="$2"
      shift 2
      ;;
    --snowflake-cli-version)
      SNOWFLAKE_CLI_VERSION="$2"
      shift 2
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

bootstrap_args=()
if [[ -n "${PYTHON_BIN}" ]]; then
  bootstrap_args+=(--python "${PYTHON_BIN}")
fi
if [[ -n "${SNOWFLAKE_CLI_VERSION}" ]]; then
  bootstrap_args+=(--snowflake-cli-version "${SNOWFLAKE_CLI_VERSION}")
fi

"${ROOT_DIR}/scripts/bootstrap_client_spcs_tools.sh" "${bootstrap_args[@]}"

configure_args=(--env-file "${ENV_FILE}")
if [[ "${FORCE_RECREATE_CONNECTION}" == "true" ]]; then
  configure_args+=(--force-recreate)
fi

"${ROOT_DIR}/scripts/configure_client_snow_connection.sh" "${configure_args[@]}"

deploy_args=(--env-file "${ENV_FILE}")
if [[ -n "${IMAGE_TAG}" ]]; then
  deploy_args+=(--image-tag "${IMAGE_TAG}")
fi
if [[ "${SKIP_BUILD}" == "true" ]]; then
  deploy_args+=(--skip-build)
fi
if [[ "${SKIP_LOGIN}" == "true" ]]; then
  deploy_args+=(--skip-login)
fi

"${ROOT_DIR}/scripts/deploy_spcs_client_snow.sh" "${deploy_args[@]}"
