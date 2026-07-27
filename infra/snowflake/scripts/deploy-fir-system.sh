#!/usr/bin/env bash
# Deploy AGT_FIR_SYSTEM DDL to Snowflake.
#
# Reads credentials from services/sttm-builder/.env.local (names only, values never printed).
# Placeholders are substituted at deploy time — no secrets in SQL files.
#
# Usage:
#   ./infra/snowflake/scripts/deploy-fir-system.sh [--dry-run] [--schema-only] [--streams-only] [--procedures-only] [--materialize-derived-only] [--get-agent-recommendations-only] [--tasks-only] [--skip-tasks] [--resume-tasks] [--skip-grants]
#
# Options:
#   --dry-run      Print rendered SQL to stdout instead of executing
#   --schema-only  Deploy only the FIR 2.0 additive table schema
#   --streams-only Deploy only FIR stream DDL
#   --procedures-only Deploy only FIR stored procedures
#   --materialize-derived-only Deploy only SP_FIR_MATERIALIZE_DERIVED_SOURCE
#   --get-agent-recommendations-only Deploy only SP_FIR_GET_AGENT_RECOMMENDATIONS
#   --tasks-only    Deploy only task DDL after table/procedure verification
#   --skip-tasks   Skip task creation and RESUME (useful on first deploy — resume manually)
#   --resume-tasks Resume the FIR task graph after all objects are deployed
#   --skip-grants  Skip grants (useful if running as non-privileged role during testing)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIR_DIR="${SCRIPT_DIR}/../fir_system"
ENV_FILE="${SCRIPT_DIR}/../../../services/sttm-builder/.env.local"

# ── Parse args ─────────────────────────────────────────────────────────────────
DRY_RUN=false
SCHEMA_ONLY=false
STREAMS_ONLY=false
PROCEDURES_ONLY=false
MATERIALIZE_DERIVED_ONLY=false
GET_AGENT_RECOMMENDATIONS_ONLY=false
TASKS_ONLY=false
SKIP_TASKS=false
RESUME_TASKS=false
SKIP_GRANTS=false

for arg in "$@"; do
  case "${arg}" in
    --dry-run)     DRY_RUN=true ;;
    --schema-only) SCHEMA_ONLY=true ;;
    --streams-only) STREAMS_ONLY=true ;;
    --procedures-only) PROCEDURES_ONLY=true ;;
    --materialize-derived-only) MATERIALIZE_DERIVED_ONLY=true ;;
    --get-agent-recommendations-only) GET_AGENT_RECOMMENDATIONS_ONLY=true ;;
    --tasks-only)  TASKS_ONLY=true ;;
    --skip-tasks)  SKIP_TASKS=true ;;
    --resume-tasks) RESUME_TASKS=true ;;
    --skip-grants) SKIP_GRANTS=true ;;
    *) echo "ERROR: unknown option '${arg}'" >&2; exit 1 ;;
  esac
done

# ── Load credentials ────────────────────────────────────────────────────────────
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: credentials file not found: ${ENV_FILE}" >&2
  echo "       Expected services/sttm-builder/.env.local at project root." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# Confirm required vars are present (names only — never print values)
REQUIRED_VARS=(
  SNOWFLAKE_ACCOUNT
  SNOWFLAKE_USER
  SNOWFLAKE_PASSWORD
  SNOWFLAKE_ROLE
  SNOWFLAKE_WAREHOUSE
  SNOWFLAKE_DATABASE
  SNOWFLAKE_SCHEMA
  SNOWFLAKE_SEMANTIC_VIEWS_DATABASE
  SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA
)
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: ${var} is not set in ${ENV_FILE}" >&2
    exit 1
  fi
done

echo "Credentials loaded from: ${ENV_FILE}"
echo "Vars confirmed present (values not shown): ${REQUIRED_VARS[*]}"
echo ""

# ── Derived placeholders ────────────────────────────────────────────────────────
NS="${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}"
SEMANTIC_NS="${SNOWFLAKE_SEMANTIC_VIEWS_DATABASE}.${SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA}"
export STTM_METADATA_NAMESPACE="${NS}"
export WAREHOUSE_NAME="${SNOWFLAKE_WAREHOUSE}"
export SERVICE_OWNER_ROLE="${SNOWFLAKE_ROLE}"
export DATABASE_NAME="${SNOWFLAKE_DATABASE}"

echo "Placeholder substitutions:"
echo "  __STTM_METADATA_NAMESPACE__ → ${NS}"
echo "  __WAREHOUSE_NAME__          → ${SNOWFLAKE_WAREHOUSE}"
echo "  __SERVICE_OWNER_ROLE__      → ${SNOWFLAKE_ROLE}"
echo "  __DATABASE__                → ${SNOWFLAKE_DATABASE}"
echo "  __SEMANTIC_REGISTRY_NAMESPACE__ → ${SEMANTIC_NS}"
echo ""

# ── Dependency check ────────────────────────────────────────────────────────────
SNOW_BIN="$(command -v snow || true)"
SNOWSQL_BIN="$(command -v snowsql || true)"
PYTHON_BIN="${SCRIPT_DIR}/../../../services/sttm-builder/.venv/bin/python"
SQL_RUNNER="${SCRIPT_DIR}/../../../scripts/run_snowflake_sql.py"
if [[ ! -x "${PYTHON_BIN}" && -z "${SNOW_BIN}" && -z "${SNOWSQL_BIN}" ]]; then
  echo "ERROR: neither a Snow CLI connection nor SnowSQL is available." >&2
  exit 1
fi

# ── Render + run ────────────────────────────────────────────────────────────────
render() {
  # Substitute __PLACEHOLDER__ tokens with env var values
  local file="$1"
  sed \
    -e "s|__STTM_METADATA_NAMESPACE__|${NS}|g" \
    -e "s|__WAREHOUSE_NAME__|${SNOWFLAKE_WAREHOUSE}|g" \
    -e "s|__SERVICE_OWNER_ROLE__|${SNOWFLAKE_ROLE}|g" \
    -e "s|__DATABASE__|${SNOWFLAKE_DATABASE}|g" \
    -e "s|__SEMANTIC_REGISTRY_NAMESPACE__|${SEMANTIC_NS}|g" \
    "${file}"
}

run_sql_file() {
  local label="$1"
  local file="$2"

  local rendered
  rendered="$(render "${file}")"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "──── [DRY RUN] ${label} ────────────────────────────────────────"
    echo "${rendered}"
    echo ""
    return
  fi

  # Write rendered SQL to a temp file so SnowSQL uses -f (file mode).
  # -q (inline query) cannot handle $$-delimited procedure bodies.
  local tmpfile
  tmpfile="$(mktemp "${TMPDIR:-/tmp}/fir_deploy.XXXXXXXX")"
  printf '%s' "${rendered}" > "${tmpfile}"

  echo "→ ${label}"
  local status=0
  if [[ -x "${PYTHON_BIN}" && -f "${SQL_RUNNER}" ]]; then
    "${PYTHON_BIN}" "${SQL_RUNNER}" --file "${tmpfile}" || status=$?
  elif [[ -n "${SNOW_BIN}" ]]; then
    if [[ -n "${SNOWFLAKE_CONNECTION:-}" ]]; then
      "${SNOW_BIN}" sql --silent -c "${SNOWFLAKE_CONNECTION}" -q "${rendered}" || status=$?
    else
      "${SNOW_BIN}" sql --silent -q "${rendered}" || status=$?
    fi
  else
    SNOWSQL_PWD="${SNOWFLAKE_PASSWORD}" "${SNOWSQL_BIN}" \
      -a "${SNOWFLAKE_ACCOUNT}" \
      -u "${SNOWFLAKE_USER}" \
      -r "${SNOWFLAKE_ROLE}" \
      -w "${SNOWFLAKE_WAREHOUSE}" \
      -d "${SNOWFLAKE_DATABASE}" \
      -s "${SNOWFLAKE_SCHEMA}" \
      -o friendly=false \
      -o header=false \
      -o output_format=plain \
      -f "${tmpfile}" || status=$?
  fi
  rm -f "${tmpfile}"
  if [[ ${status} -ne 0 ]]; then
    return "${status}"
  fi
  echo "  ✓ done"
  echo ""
}

deploy_procedures() {
  run_sql_file "SP_FIR_COLLECT_FEEDBACK"              "${FIR_DIR}/procedures/sp-fir-collect-feedback.sql"
  run_sql_file "SP_FIR_ENRICH_CONTEXT"                "${FIR_DIR}/procedures/sp-fir-enrich-context.sql"
  run_sql_file "SP_FIR_REFRESH_FEATURES"              "${FIR_DIR}/procedures/sp-fir-refresh-features.sql"
  run_sql_file "SP_FIR_BACKFILL_EVENTS"               "${FIR_DIR}/procedures/sp-fir-backfill-events.sql"
  run_sql_file "SP_FIR_GENERATE_INFERENCES"           "${FIR_DIR}/procedures/sp-fir-generate-inferences.sql"
  run_sql_file "SP_FIR_CREATE_SEMANTIC_VERSION"       "${FIR_DIR}/procedures/sp-fir-create-semantic-version.sql"
  run_sql_file "SP_FIR_GENERATE_RECOMMENDATIONS"      "${FIR_DIR}/procedures/sp-fir-generate-recommendations.sql"
  run_sql_file "SP_FIR_APPLY_CONFIDENCE_DECAY"        "${FIR_DIR}/procedures/sp-fir-apply-confidence-decay.sql"
  run_sql_file "SP_FIR_GET_AGENT_RECOMMENDATIONS"     "${FIR_DIR}/procedures/sp-fir-get-agent-recommendations.sql"
  run_sql_file "SP_FIR_ORCHESTRATE_BATCH"             "${FIR_DIR}/procedures/sp-fir-orchestrate-batch.sql"
  run_sql_file "SP_FIR_CONSOLIDATE_SEMANTIC_VERSIONS" "${FIR_DIR}/procedures/sp-fir-consolidate-semantic-versions.sql"
  run_sql_file "SP_FIR_READ_DOCUMENTS"                "${FIR_DIR}/procedures/sp-fir-read-documents.sql"
  run_sql_file "SP_FIR_READ_PENDING_RECORDS"          "${FIR_DIR}/procedures/sp-fir-read-pending-records.sql"
  run_sql_file "SP_FIR_STORE_INFERENCE"               "${FIR_DIR}/procedures/sp-fir-store-inference.sql"
  run_sql_file "SP_FIR_STORE_RECOMMENDATION"          "${FIR_DIR}/procedures/sp-fir-store-recommendation.sql"
  run_sql_file "SP_FIR_RECONCILE_RECOMMENDATION_IDENTITIES" "${FIR_DIR}/procedures/sp-fir-reconcile-recommendation-identities.sql"
  run_sql_file "SP_FIR_STORE_QA_PAIR"                 "${FIR_DIR}/procedures/sp-fir-store-qa-pair.sql"
  run_sql_file "SP_FIR_MATERIALIZE_DERIVED_SOURCE"    "${FIR_DIR}/procedures/sp-fir-materialize-derived-source.sql"
  run_sql_file "SP_FIR_PRECOMPUTE_FROM_SEMANTIC_VIEW" "${FIR_DIR}/procedures/sp-fir-precompute-from-semantic-view.sql"
  run_sql_file "SP_FIR_PRECOMPUTE_PERMUTATIONS"       "${FIR_DIR}/procedures/sp-fir-precompute-permutations.sql"
  run_sql_file "SP_FIR_SCORE_RECOMMENDATIONS"         "${FIR_DIR}/procedures/sp-fir-score-recommendations.sql"
  run_sql_file "SP_FIR_INVOKE_AGENT"                  "${FIR_DIR}/procedures/sp-fir-invoke-agent.sql"
}

if [[ "${SCHEMA_ONLY}" == "true" ]]; then
  if [[ "${STREAMS_ONLY}" == "true" || "${PROCEDURES_ONLY}" == "true" || "${MATERIALIZE_DERIVED_ONLY}" == "true" || "${GET_AGENT_RECOMMENDATIONS_ONLY}" == "true" || "${TASKS_ONLY}" == "true" || "${SKIP_TASKS}" == "true" || "${RESUME_TASKS}" == "true" ]]; then
    echo "ERROR: --schema-only cannot be combined with procedure or task options." >&2
    exit 1
  fi
  echo "=========================================="
  echo " FIR additive schema-only deployment"
  echo "=========================================="
  run_sql_file "FIR 2.0 additive schema" "${FIR_DIR}/tables/fir_v2_schema.sql"
  exit 0
fi

if [[ "${STREAMS_ONLY}" == "true" ]]; then
  if [[ "${PROCEDURES_ONLY}" == "true" || "${MATERIALIZE_DERIVED_ONLY}" == "true" || "${GET_AGENT_RECOMMENDATIONS_ONLY}" == "true" || "${TASKS_ONLY}" == "true" || "${SKIP_TASKS}" == "true" || "${RESUME_TASKS}" == "true" ]]; then
    echo "ERROR: --streams-only cannot be combined with procedure or task options." >&2
    exit 1
  fi
  echo "=========================================="
  echo " FIR stream-only deployment"
  echo "=========================================="
  run_sql_file "FIR Streams" "${FIR_DIR}/streams/fir_streams.sql"
  exit 0
fi

if [[ "${PROCEDURES_ONLY}" == "true" ]]; then
  if [[ "${STREAMS_ONLY}" == "true" || "${MATERIALIZE_DERIVED_ONLY}" == "true" || "${GET_AGENT_RECOMMENDATIONS_ONLY}" == "true" || "${TASKS_ONLY}" == "true" || "${SKIP_TASKS}" == "true" || "${RESUME_TASKS}" == "true" ]]; then
    echo "ERROR: --procedures-only cannot be combined with task options." >&2
    exit 1
  fi
  echo "=========================================="
  echo " FIR procedure-only deployment"
  echo "=========================================="
  deploy_procedures
  exit 0
fi

if [[ "${MATERIALIZE_DERIVED_ONLY}" == "true" ]]; then
  if [[ "${GET_AGENT_RECOMMENDATIONS_ONLY}" == "true" || "${TASKS_ONLY}" == "true" || "${SKIP_TASKS}" == "true" || "${RESUME_TASKS}" == "true" ]]; then
    echo "ERROR: --materialize-derived-only cannot be combined with task options." >&2
    exit 1
  fi
  echo "=========================================="
  echo " FIR derived materializer-only deployment"
  echo "=========================================="
  run_sql_file "SP_FIR_MATERIALIZE_DERIVED_SOURCE" "${FIR_DIR}/procedures/sp-fir-materialize-derived-source.sql"
  exit 0
fi

if [[ "${GET_AGENT_RECOMMENDATIONS_ONLY}" == "true" ]]; then
  if [[ "${TASKS_ONLY}" == "true" || "${SKIP_TASKS}" == "true" || "${RESUME_TASKS}" == "true" ]]; then
    echo "ERROR: --get-agent-recommendations-only cannot be combined with task options." >&2
    exit 1
  fi
  echo "=========================================="
  echo " FIR recommendation reader-only deployment"
  echo "=========================================="
  run_sql_file "SP_FIR_GET_AGENT_RECOMMENDATIONS" "${FIR_DIR}/procedures/sp-fir-get-agent-recommendations.sql"
  exit 0
fi

if [[ "${TASKS_ONLY}" == "true" ]]; then
  if [[ "${SKIP_TASKS}" == "true" ]]; then
    echo "ERROR: --tasks-only cannot be combined with --skip-tasks." >&2
    exit 1
  fi
  echo "=========================================="
  echo " FIR task-only deployment"
  echo "=========================================="
  run_sql_file "FIR Tasks" "${FIR_DIR}/tasks/fir_tasks.sql"
  if [[ "${RESUME_TASKS}" == "true" ]]; then
    run_sql_file "Resume FIR task graph" "${FIR_DIR}/tasks/fir_tasks_resume.sql"
  fi
  exit 0
fi

# ── Deployment sequence ─────────────────────────────────────────────────────────
echo "=========================================="
echo " AGT_FIR_SYSTEM — Local Deployment"
echo " Stage: LOCAL"
echo "=========================================="
echo ""

# 1. Tables
echo "[ 1/7 ] Tables"
run_sql_file "TBL_AGENT_FIR_360"              "${FIR_DIR}/tables/tbl_agent_fir_360.sql"
run_sql_file "TBL_SEMANTIC_VIEW_VERSIONS"      "${FIR_DIR}/tables/tbl_semantic_view_versions.sql"
run_sql_file "TBL_FIR_AGENT_RECOMMENDATIONS"   "${FIR_DIR}/tables/tbl_fir_agent_recommendations.sql"
run_sql_file "FIR 2.0 additive schema"          "${FIR_DIR}/tables/fir_v2_schema.sql"

# 2. Streams
echo "[ 2/7 ] Streams"
run_sql_file "FIR Streams" "${FIR_DIR}/streams/fir_streams.sql"

# 3. Procedures
echo "[ 3/7 ] Stored Procedures"
deploy_procedures

# 4. Cortex Search Services
echo "[ 4/7 ] Cortex Search Services"
run_sql_file "Workbench RAG Cortex Search Service" "${FIR_DIR}/cortex_search/workbench_rag_search_service.sql"
run_sql_file "FIR Cortex Search Services" "${FIR_DIR}/cortex_search/fir_search_services.sql"

# 5. Agent (requires Python with snowflake-connector)
echo "[ 5/7 ] Agent (AGT_FIR_SYSTEM)"
VENV_PYTHON="${SCRIPT_DIR}/../../../services/sttm-builder/.venv/bin/python"
DEPLOY_AGENT_SCRIPT="${SCRIPT_DIR}/../../../scripts/deploy_fir_agent.py"
if [[ -f "${VENV_PYTHON}" && -f "${DEPLOY_AGENT_SCRIPT}" ]]; then
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "  [DRY RUN] Would deploy AGT_FIR_SYSTEM via ${DEPLOY_AGENT_SCRIPT}"
  else
    "${VENV_PYTHON}" "${DEPLOY_AGENT_SCRIPT}" --skip-procedures --env-file "${ENV_FILE}"
    echo "  ✓ AGT_FIR_SYSTEM deployed"
  fi
else
  echo "  ⚠ Skipped: Python venv or deploy script not found."
  echo "    Run manually: python scripts/deploy_fir_agent.py --skip-procedures"
fi
echo ""

# 6. Tasks
if [[ "${SKIP_TASKS}" == "false" ]]; then
  echo "[ 6/7 ] Tasks"
  run_sql_file "FIR Tasks" "${FIR_DIR}/tasks/fir_tasks.sql"

  if [[ "${RESUME_TASKS}" == "true" ]]; then
    run_sql_file "Resume FIR task graph" "${FIR_DIR}/tasks/fir_tasks_resume.sql"
  else
    echo ""
    echo "NOTE: Tasks are created in SUSPENDED state."
    echo "      Re-run with --resume-tasks after verification to activate the graph."
    echo ""
  fi
else
  echo "[ 6/7 ] Tasks — SKIPPED (--skip-tasks)"
fi

# 7. Grants
if [[ "${SKIP_GRANTS}" == "false" ]]; then
  echo "[ 7/7 ] Grants"
  run_sql_file "FIR Grants" "${FIR_DIR}/grants/fir_grants.sql"
else
  echo "[ 7/7 ] Grants — SKIPPED (--skip-grants)"
fi

# ── Verification hint ───────────────────────────────────────────────────────────
if [[ "${DRY_RUN}" == "false" ]]; then
  echo "=========================================="
  echo " Deployment complete. Verify with:"
  echo "=========================================="
  echo ""
  echo "  SHOW TABLES    LIKE 'TBL_%FIR%'  IN SCHEMA ${NS};"
  echo "  SHOW STREAMS   LIKE 'STM_FIR_%'  IN SCHEMA ${NS};"
  echo "  SHOW PROCEDURES LIKE 'SP_FIR_%'  IN SCHEMA ${NS};"
  echo "  SHOW TASKS     LIKE 'TSK_FIR_%'  IN SCHEMA ${NS};"
  echo ""
  echo "  Manual test:"
  echo "    CALL ${NS}.SP_FIR_ORCHESTRATE_BATCH(OBJECT_CONSTRUCT("
  echo "      'task_type', 'manual',"
  echo "      'batch_size', 10,"
  echo "      'processing_options', OBJECT_CONSTRUCT("
  echo "        'collect_feedback', TRUE,"
  echo "        'generate_inferences', TRUE,"
  echo "        'create_semantic_versions', FALSE,"
  echo "        'generate_recommendations', TRUE,"
  echo "        'apply_decay', FALSE"
  echo "      )"
  echo "    ));"
fi
