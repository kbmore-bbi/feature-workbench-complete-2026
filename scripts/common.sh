#!/bin/bash

set -euo pipefail

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

json_get() {
  local json="$1"
  local key="$2"

  python3 - "$json" "$key" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
value = payload.get(sys.argv[2], "")
if isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
PY
}

load_snowflake_secret() {
  require_var SNOWFLAKE_SECRET_ARN

  local secret_json
  secret_json="$(aws secretsmanager get-secret-value \
    --secret-id "${SNOWFLAKE_SECRET_ARN}" \
    --query SecretString \
    --output text)"

  export SNOWFLAKE_ACCOUNT="${SNOWFLAKE_ACCOUNT:-$(json_get "${secret_json}" "account")}"
  export SNOWFLAKE_USER="${SNOWFLAKE_USER:-$(json_get "${secret_json}" "user")}"
  export SNOWFLAKE_PASSWORD="${SNOWFLAKE_PASSWORD:-$(json_get "${secret_json}" "password")}"
  export SNOWFLAKE_WAREHOUSE="${SNOWFLAKE_WAREHOUSE:-$(json_get "${secret_json}" "warehouse")}"
  export SNOWFLAKE_DATABASE="${SNOWFLAKE_DATABASE:-$(json_get "${secret_json}" "database")}"
  export SNOWFLAKE_SCHEMA="${SNOWFLAKE_SCHEMA:-$(json_get "${secret_json}" "schema")}"
  export SNOWFLAKE_ROLE="${SNOWFLAKE_ROLE:-$(json_get "${secret_json}" "role")}"
  export SNOWFLAKE_COMPUTE_POOL="${SNOWFLAKE_COMPUTE_POOL:-$(json_get "${secret_json}" "compute_pool")}"
  export SNOWFLAKE_IMAGE_REPOSITORY="${SNOWFLAKE_IMAGE_REPOSITORY:-$(json_get "${secret_json}" "image_repository")}"
  export SNOWFLAKE_REGISTRY_HOST="${SNOWFLAKE_REGISTRY_HOST:-$(json_get "${secret_json}" "registry_host")}"
  export SNOWFLAKE_REGISTRY_USERNAME="${SNOWFLAKE_REGISTRY_USERNAME:-$(json_get "${secret_json}" "registry_username")}"
  export SNOWFLAKE_REGISTRY_PASSWORD="${SNOWFLAKE_REGISTRY_PASSWORD:-$(json_get "${secret_json}" "registry_password")}"

  export SNOWSQL_PWD="${SNOWFLAKE_PASSWORD}"
}

short_sha() {
  local ref="${CODEBUILD_RESOLVED_SOURCE_VERSION:-$(git rev-parse HEAD)}"
  printf "%s" "${ref}" | cut -c1-12
}

