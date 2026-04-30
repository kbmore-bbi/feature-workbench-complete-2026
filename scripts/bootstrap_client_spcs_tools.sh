#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_VENV="${ROOT_DIR}/.client-tools-venv"
PYTHON_BIN="${PYTHON_BIN:-}"
SNOWFLAKE_CLI_VERSION="${SNOWFLAKE_CLI_VERSION:-}"

usage() {
  cat <<EOF
Usage: $0 [--python /path/to/python] [--snowflake-cli-version version]

Creates a lightweight tools virtualenv for client-side SPCS deployment and
installs Snowflake CLI into it. The virtualenv is reused on later runs.

Examples:
  $0
  $0 --python /opt/homebrew/bin/python3
  $0 --snowflake-cli-version 3.10.1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

if [[ -z "${PYTHON_BIN}" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python)"
  else
    echo "ERROR: python3 or python is required." >&2
    exit 1
  fi
fi

"${PYTHON_BIN}" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("ERROR: Python 3.10+ is required for the client deployment tools.")
PY

if [[ ! -d "${TOOLS_VENV}" ]]; then
  echo "Creating tools virtualenv at ${TOOLS_VENV}"
  "${PYTHON_BIN}" -m venv "${TOOLS_VENV}"
else
  echo "Reusing tools virtualenv at ${TOOLS_VENV}"
fi

PIP_BIN="${TOOLS_VENV}/bin/pip"
SNOW_BIN="${TOOLS_VENV}/bin/snow"

echo "Upgrading pip tooling"
"${PIP_BIN}" install --upgrade pip setuptools wheel

if [[ -n "${SNOWFLAKE_CLI_VERSION}" ]]; then
  echo "Installing snowflake-cli==${SNOWFLAKE_CLI_VERSION}"
  "${PIP_BIN}" install --upgrade "snowflake-cli==${SNOWFLAKE_CLI_VERSION}"
else
  echo "Installing latest snowflake-cli"
  "${PIP_BIN}" install --upgrade snowflake-cli
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but was not found in PATH." >&2
  exit 1
fi

echo
echo "Snow CLI installed successfully."
echo "Snow binary: ${SNOW_BIN}"
"${SNOW_BIN}" --version
echo
echo "Next steps:"
echo "  1. Copy infra/snowflake/env/client.env.example to infra/snowflake/env/client.env"
echo "  2. Fill the client-specific values in that env file"
echo "  3. Run ./scripts/configure_client_snow_connection.sh"
echo "  4. Run ./scripts/deploy_spcs_client_snow.sh"
