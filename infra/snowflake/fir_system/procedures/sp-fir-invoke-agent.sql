-- ============================================================
-- SP_FIR_INVOKE_AGENT
-- Bridge procedure called by Snowflake Tasks to invoke AGT_FIR_SYSTEM.
-- Gathers stream state, builds context, and calls the agent.
-- The agent then uses its tools (procedures + cortex search) to
-- intelligently process feedback, parse documents, generate inferences,
-- and create recommendations.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_INVOKE_AGENT(
    "TASK_PAYLOAD" VARIANT DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'invoke_agent'
EXECUTE AS CALLER
AS
$$
import json
import _snowflake
import uuid
import time
from datetime import datetime

DEPLOYED_NAMESPACE = "__STTM_METADATA_NAMESPACE__"


def _sql_literal(value):
    return "'" + str(value or "").replace("'", "''") + "'"


def _daily_usage(session, namespace):
    try:
        row = session.sql(f"""
            SELECT
                COALESCE(SUM(REQUEST_COUNT), 0) AS REQUESTS,
                COALESCE(SUM(TOTAL_TOKENS), 0) AS TOKENS
            FROM {namespace}.TBL_FIR_AGENT_BUDGET_LEDGER
            WHERE RUN_DATE = CURRENT_DATE()
        """).collect()[0]
        return int(row["REQUESTS"] or 0), int(row["TOKENS"] or 0)
    except Exception:
        # A rolling deployment may execute the procedure before the ledger DDL.
        # Fail closed so an unmetered catch-up cannot create a cost spike.
        return None, None


def _active_requests(session, namespace):
    try:
        row = session.sql(f"""
            SELECT COUNT(*) AS ACTIVE
            FROM {namespace}.TBL_FIR_AGENT_BUDGET_LEDGER
            WHERE STATUS = 'running'
              AND STARTED_AT > DATEADD('minute', -20, CURRENT_TIMESTAMP())
        """).collect()[0]
        return int(row["ACTIVE"] or 0)
    except Exception:
        return None


def _reserve_request(session, namespace, run_id, task_type, asset_id):
    session.sql(f"""
        INSERT INTO {namespace}.TBL_FIR_AGENT_BUDGET_LEDGER (
            RUN_ID, RUN_DATE, TRIGGER_REASON, ASSET_ID, STATUS,
            REQUEST_COUNT, INPUT_TOKENS, OUTPUT_TOKENS, TOTAL_TOKENS,
            STARTED_AT, METADATA
        )
        SELECT
            {_sql_literal(run_id)}, CURRENT_DATE(), {_sql_literal(task_type)},
            {_sql_literal(asset_id)}, 'running', 1, 0, 0, 0,
            CURRENT_TIMESTAMP(), OBJECT_CONSTRUCT()
    """).collect()


def _complete_request(session, namespace, run_id, status, body):
    usage = body.get("usage") if isinstance(body, dict) else {}
    usage = usage if isinstance(usage, dict) else {}
    input_tokens = int(
        usage.get("input_tokens") or usage.get("prompt_tokens") or 0
    )
    output_tokens = int(
        usage.get("output_tokens") or usage.get("completion_tokens") or 0
    )
    total_tokens = int(
        usage.get("total_tokens") or input_tokens + output_tokens
    )
    session.sql(f"""
        UPDATE {namespace}.TBL_FIR_AGENT_BUDGET_LEDGER
        SET STATUS = {_sql_literal(status)},
            INPUT_TOKENS = {input_tokens},
            OUTPUT_TOKENS = {output_tokens},
            TOTAL_TOKENS = {total_tokens},
            COMPLETED_AT = CURRENT_TIMESTAMP(),
            METADATA = OBJECT_CONSTRUCT(
                'response_status', {_sql_literal(status)},
                'token_usage_reported', {str(bool(usage)).upper()}
            )
        WHERE RUN_ID = {_sql_literal(run_id)}
    """).collect()


def _numeric(value):
    try:
        return int(value or 0)
    except Exception:
        return 0


def _observability_complete(
    session,
    namespace,
    run_id,
    payload_opts,
    work_scope,
    result,
    started_monotonic,
    body=None,
):
    try:
        body = body if isinstance(body, dict) else {}
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        input_tokens = _numeric(
            usage.get("input_tokens") or usage.get("prompt_tokens")
        )
        output_tokens = _numeric(
            usage.get("output_tokens") or usage.get("completion_tokens")
        )
        total_tokens = _numeric(
            usage.get("total_tokens") or input_tokens + output_tokens
        )
        agent_response = result.get("agent_response")
        agent_response = agent_response if isinstance(agent_response, dict) else {}
        context = result.get("context_built")
        context = context if isinstance(context, dict) else {}
        pending = context.get("pending_counts")
        pending = pending if isinstance(pending, dict) else {}
        unprocessed_count = _numeric(
            context.get("unprocessed_document_count")
        )
        asset_id = str(
            work_scope.get("sql_asset_id")
            or (payload_opts.get("processing_options") or {}).get(
                "priority_asset_id"
            )
            or ""
        )
        target_table = str(
            work_scope.get("target_table")
            or work_scope.get("target_table_fqn")
            or ""
        )
        target_column = str(work_scope.get("target_column") or "")
        content = body.get("content") if isinstance(body.get("content"), list) else []
        tool_calls = len(
            [
                item
                for item in content
                if isinstance(item, dict)
                and item.get("type") in ("tool_use", "tool_result")
            ]
        )
        metrics = agent_response.get("metrics")
        metrics = metrics if isinstance(metrics, dict) else agent_response
        processing_options = payload_opts.get("processing_options")
        processing_options = (
            processing_options if isinstance(processing_options, dict) else {}
        )
        target_row_count = _numeric(
            metrics.get("target_row_count")
            or processing_options.get("target_row_count")
            or sum(_numeric(value) for value in pending.values())
        )
        tool_calls = max(
            tool_calls,
            _numeric(metrics.get("tool_call_count") or metrics.get("tool_calls")),
        )
        duration_ms = int(
            max(0, time.monotonic() - started_monotonic) * 1000
        )
        status = str(result.get("status") or "unknown")
        circuit_status = (
            status
            if status in (
                "budget_exhausted",
                "budget_ledger_unavailable",
                "concurrency_limit",
            )
            else "closed"
        )
        query_tag = f"fir:{run_id}:{payload_opts.get('task_type', 'stream_triggered')}"
        metadata = {
            "daily_request_limit": payload_opts.get(
                "daily_request_limit", 50
            ),
            "daily_token_limit": payload_opts.get(
                "daily_token_limit", 20000000
            ),
            "pending_record_count": sum(_numeric(value) for value in pending.values()),
            "streams_with_data": context.get("streams_with_data") or [],
            "error_summary": "; ".join(
                str(value) for value in result.get("errors") or []
            )[:2000],
            "response_metadata": result.get("response_metadata") or {},
            "work_scope": work_scope,
        }
        session.sql(f"""
            MERGE INTO {namespace}.TBL_FIR_RUN_OBSERVABILITY target
            USING (
                SELECT
                    {_sql_literal(run_id)} AS RUN_ID,
                    {_sql_literal(payload_opts.get('task_type', 'stream_triggered'))}
                        AS TRIGGER_REASON
            ) source
            ON target.RUN_ID = source.RUN_ID
            WHEN MATCHED THEN UPDATE SET
                STATUS = {_sql_literal(status)},
                AGENT_REQUEST_COUNT = {1 if result.get('agent_invoked') else 0},
                INPUT_TOKENS = {input_tokens},
                OUTPUT_TOKENS = {output_tokens},
                TOTAL_TOKENS = {total_tokens},
                TOOL_CALL_COUNT = {tool_calls},
                DURATION_MS = {duration_ms},
                CIRCUIT_BREAKER_STATUS = {_sql_literal(circuit_status)},
                RESULT_VALIDATION_STATUS = {_sql_literal(
                    metrics.get('validation_status')
                    or metrics.get('result_validation_status')
                    or status
                )},
                COMPLETED_AT = CURRENT_TIMESTAMP(),
                METADATA = PARSE_JSON({_sql_literal(json.dumps(metadata, default=str))})
            WHEN NOT MATCHED THEN INSERT (
                RUN_ID, RUN_DATE, TRIGGER_REASON, USER_ID, PROJECT_ID,
                ASSET_ID, TARGET_TABLE, TARGET_COLUMN, AGENT_NAME, TOOL_NAME,
                STATUS, ASSET_COUNT, TARGET_ROW_COUNT,
                DUPLICATE_WORK_SKIPPED, PATTERNS_EXTRACTED,
                PATTERNS_ENRICHED, PATTERNS_REJECTED, PATTERNS_PROMOTED,
                AGENT_REQUEST_COUNT, INPUT_TOKENS, OUTPUT_TOKENS,
                TOTAL_TOKENS, TOOL_CALL_COUNT, DURATION_MS, RETRY_COUNT,
                CIRCUIT_BREAKER_STATUS, ESTIMATED_COST, QUERY_TAG,
                RESULT_VALIDATION_STATUS, STARTED_AT, COMPLETED_AT, METADATA
            ) VALUES (
                source.RUN_ID, CURRENT_DATE(), source.TRIGGER_REASON,
                {_sql_literal(work_scope.get('user_id') or '')},
                {_sql_literal(work_scope.get('project_id') or '')},
                NULLIF({_sql_literal(asset_id)}, ''),
                NULLIF({_sql_literal(target_table)}, ''),
                NULLIF({_sql_literal(target_column)}, ''),
                'AGT_FIR_SYSTEM', 'CORTEX_AGENT_RUN',
                {_sql_literal(status)},
                {1 if asset_id else unprocessed_count},
                {target_row_count},
                {_numeric(metrics.get('duplicate_work_skipped'))},
                {_numeric(metrics.get('patterns_extracted') or target_row_count)},
                {_numeric(metrics.get('patterns_enriched') or target_row_count)},
                {_numeric(metrics.get('patterns_rejected'))},
                {_numeric(metrics.get('patterns_promoted'))},
                {1 if result.get('agent_invoked') else 0},
                {input_tokens}, {output_tokens}, {total_tokens}, {tool_calls},
                {duration_ms}, {_numeric(payload_opts.get('retry_count'))},
                {_sql_literal(circuit_status)},
                {float(
                    usage.get('estimated_cost')
                    or usage.get('cost')
                    or payload_opts.get('estimated_cost')
                    or 0.0
                )},
                {_sql_literal(query_tag)},
                {_sql_literal(
                    metrics.get('validation_status')
                    or metrics.get('result_validation_status')
                    or status
                )},
                DATEADD('millisecond', -{duration_ms}, CURRENT_TIMESTAMP()),
                CURRENT_TIMESTAMP(),
                PARSE_JSON({_sql_literal(json.dumps(metadata, default=str))})
            )
        """).collect()
    except Exception:
        # Telemetry must never make FIR work fail during a rolling deployment.
        pass


def _current_namespace(session):
    try:
        row = session.sql("SELECT CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH").collect()[0]
        database = str(row["DB"] or "").strip()
        schema = str(row["SCH"] or "").strip()
        if database and schema and database.upper() != "NONE" and schema.upper() != "NONE":
            return database, schema
    except Exception:
        pass
    database, schema = DEPLOYED_NAMESPACE.split(".", 1)
    return database, schema


def _check_streams(session, namespace):
    """Check which streams have data to build context for the agent."""
    streams = [
        'STM_FIR_WORKBENCH_FEEDBACK',
        'STM_FIR_STTM_ATTRIBUTES',
        'STM_FIR_DERIVED_SOURCES',
        'STM_FIR_SEM_TABLE_VIEWS',
        'STM_FIR_CONVERSATION_TURNS',
        'STM_FIR_STTM_VERSIONS',
        'STM_FIR_CLIENT_SQL_ASSETS',
    ]
    streams_with_data = []
    for stream_name in streams:
        try:
            result = session.sql(
                f"SELECT SYSTEM$STREAM_HAS_DATA('{namespace}.{stream_name}') AS HAS_DATA"
            ).collect()
            if result and str(result[0]['HAS_DATA']).lower() == 'true':
                streams_with_data.append(stream_name)
        except Exception:
            pass
    return streams_with_data


def _consume_context_trigger_stream(session, namespace):
    marker = f"TMP_FIR_CONTEXT_STREAM_{uuid.uuid4().hex[:12].upper()}"
    try:
        session.sql(f"CREATE TEMP TABLE {marker} (ROW_COUNT NUMBER)").collect()
        session.sql(
            f"INSERT INTO {marker} "
            f"SELECT COUNT(*) FROM {namespace}.STM_FIR_CONTEXT_EVIDENCE"
        ).collect()
    except Exception:
        # Manual and rolling-deployment calls do not require the stream.
        pass


def _get_pending_counts(session, namespace):
    """Get counts of pending records at each processing stage."""
    counts = {}
    try:
        rows = session.sql(f"""
            SELECT PROCESSING_STAGE, COUNT(*) AS CNT
            FROM {namespace}.TBL_AGENT_FIR_360 f
            JOIN {namespace}.TBL_FIR_CONTEXT_EVIDENCE e
              ON e.EVIDENCE_CONTEXT_ID = f.EVIDENCE_CONTEXT_ID
            WHERE f.PROCESSING_STAGE IN ('pending', 'feedback_collected', 'inference_generated')
              AND e.EVIDENCE_STATUS = 'ready'
            GROUP BY f.PROCESSING_STAGE
        """).collect()
        for row in rows:
            counts[row['PROCESSING_STAGE']] = row['CNT']
    except Exception:
        pass
    return counts


def _get_unprocessed_documents(session, namespace):
    """Check for documents that haven't been processed by the FIR agent yet."""
    try:
        rows = session.sql(f"""
            SELECT
                a.SQL_ASSET_ID,
                a.TITLE,
                a.SQL_KIND,
                a.DIALECT,
                LENGTH(a.SQL_TEXT) AS SQL_LENGTH,
                a.DESCRIPTION,
                a.CREATED_AT
            FROM {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS a
            LEFT JOIN {namespace}.TBL_AGENT_FIR_360 f
                ON f.SOURCE_TYPE = 'document_upload'
                AND f.FEEDBACK_PAYLOAD:sql_asset_id::STRING = a.SQL_ASSET_ID
            WHERE f.FIR_RECORD_ID IS NULL
              AND a.STATUS = 'active'
            ORDER BY a.CREATED_AT DESC
            LIMIT 20
        """).collect()
        return [
            {
                'sql_asset_id': row['SQL_ASSET_ID'],
                'title': row['TITLE'],
                'sql_kind': row['SQL_KIND'],
                'dialect': row['DIALECT'],
                'sql_length': row['SQL_LENGTH'],
                'description': row['DESCRIPTION'],
                'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None
            }
            for row in rows
        ]
    except Exception:
        return []


def _get_recent_activity_summary(session, namespace):
    """Get summary of recent FIR activity for agent context."""
    summary = {}
    try:
        rows = session.sql(f"""
            SELECT SOURCE_TYPE, COUNT(*) AS CNT
            FROM {namespace}.TBL_AGENT_FIR_360
            WHERE CREATED_AT > DATEADD('hour', -24, CURRENT_TIMESTAMP())
            GROUP BY SOURCE_TYPE
        """).collect()
        summary['last_24h_by_source'] = {row['SOURCE_TYPE']: row['CNT'] for row in rows}
    except Exception:
        pass

    try:
        rows = session.sql(f"""
            SELECT COUNT(*) AS CNT
            FROM {namespace}.TBL_FIR_AGENT_RECOMMENDATIONS
            WHERE STATUS = 'active'
        """).collect()
        summary['active_recommendations'] = rows[0]['CNT'] if rows else 0
    except Exception:
        pass

    return summary


def invoke_agent(session, task_payload=None) -> dict:
    """Main handler: builds context and invokes AGT_FIR_SYSTEM."""
    current_database, current_schema = _current_namespace(session)
    namespace = f"{current_database}.{current_schema}"

    result = {
        'status': 'success',
        'agent_invoked': False,
        'agent_response': None,
        'context_built': {},
        'started_at': datetime.utcnow().isoformat(),
        'errors': []
    }
    budget_run_id = None
    observability_run_id = f"firrun_{uuid.uuid4().hex}"
    started_monotonic = time.monotonic()
    payload_opts = {}
    work_scope = {}
    response_body = {}

    def finish():
        _observability_complete(
            session,
            namespace,
            observability_run_id,
            payload_opts,
            work_scope,
            result,
            started_monotonic,
            response_body,
        )
        return result

    try:
        # Parse task payload
        if task_payload:
            if isinstance(task_payload, str):
                try:
                    payload_opts = json.loads(task_payload)
                except Exception:
                    pass
            else:
                payload_opts = dict(task_payload) if task_payload else {}

        processing_options = payload_opts.get('processing_options') or {}
        work_scope = dict(payload_opts.get('precomputation_context') or {})
        priority_asset = processing_options.get('priority_asset_id')
        if priority_asset and not work_scope.get('sql_asset_id'):
            work_scope['sql_asset_id'] = priority_asset

        _consume_context_trigger_stream(session, namespace)

        # Build context for the agent
        streams_with_data = _check_streams(session, namespace)
        pending_counts = _get_pending_counts(session, namespace)
        unprocessed_docs = _get_unprocessed_documents(session, namespace)
        activity_summary = _get_recent_activity_summary(session, namespace)

        # Determine what work needs to be done
        task_type = payload_opts.get('task_type', 'stream_triggered')
        query_tag = f"fir:{observability_run_id}:{task_type}"
        try:
            session.sql(
                f"ALTER SESSION SET QUERY_TAG = {_sql_literal(query_tag)}"
            ).collect()
        except Exception:
            pass
        has_stream_data = len(streams_with_data) > 0
        has_pending_records = sum(pending_counts.values()) > 0
        has_unprocessed_docs = len(unprocessed_docs) > 0

        # Manual, document_learning, and semantic_precomputation tasks always proceed
        force_run = task_type in ('manual', 'document_learning', 'semantic_precomputation')

        if not force_run and not has_stream_data and not has_pending_records and not has_unprocessed_docs:
            result['status'] = 'no_work'
            result['context_built'] = {
                'streams_checked': 7,
                'streams_with_data': 0,
                'pending_records': 0,
                'unprocessed_documents': 0
            }
            return finish()

        daily_request_limit = max(
            0, int(payload_opts.get("daily_request_limit", 50))
        )
        daily_token_limit = max(
            0, int(payload_opts.get("daily_token_limit", 20000000))
        )
        max_concurrency = max(
            1, int(payload_opts.get("max_concurrency", 2))
        )
        requests_used, tokens_used = _daily_usage(session, namespace)
        active_requests = _active_requests(session, namespace)
        result["budget"] = {
            "daily_request_limit": daily_request_limit,
            "daily_token_limit": daily_token_limit,
            "requests_used_before_run": requests_used,
            "tokens_used_before_run": tokens_used,
            "active_requests_before_run": active_requests,
            "max_concurrency": max_concurrency,
        }
        if (
            requests_used is None
            or tokens_used is None
            or active_requests is None
        ):
            result["status"] = "budget_ledger_unavailable"
            result["errors"].append(
                "FIR agent budget ledger is unavailable; invocation was skipped."
            )
            return finish()
        if active_requests >= max_concurrency:
            result["status"] = "concurrency_limit"
            result["budget"]["queue_retained"] = True
            return finish()
        if (
            requests_used >= daily_request_limit
            or tokens_used >= daily_token_limit
        ):
            result["status"] = "budget_exhausted"
            result["budget"]["queue_retained"] = True
            return finish()

        # Build the agent message with full context
        processing_options = {
            'collect_feedback': False,
            'generate_inferences': True,
            'create_semantic_versions': True,
            'generate_recommendations': True,
            'apply_decay': False,
            'parse_documents': has_unprocessed_docs,
            **processing_options,
        }

        base_instructions = (
            'Process the FIR pipeline based on the context provided. '
            'Stream capture and evidence enrichment already ran in parent tasks. '
            'Read pending FIR-360 records that include context_evidence to generate inferences. '
            'Also read inference_generated FIR-360 records to generate their recommendations. '
            'Use active FIR goal version 2.1. Store only Q1, Q2, Q3, Q5, Q6, and Q7 as inferences. '
            'Prepare Q4 and Q10 as explicit-feedback questions and Q8 and Q9 as recommendations, '
            'then prepare exact-context agent guidance and checkpoint messages. '
            'Use the deterministic V3 document_analysis_package as syntax-level preparation. '
            'Missing semantics for one table block only claims depending on that table; continue '
            'structural analysis elsewhere at reduced confidence and record the missing dependency. '
            'Copy bundle_curation.bundle_version_id from the stored workspace context into every '
            'recommendation agent_payload so findings remain attached to the reviewable draft. '
            'Unprocessed documents need to be read with ReadDocuments, '
            'analyzed for mapping patterns, transformations, join logic, '
            'and business rules, then fed into the pipeline as document_upload feedback. '
            'Use SearchFIRInferences to check for duplicates before creating new inferences. '
            'Use SearchFIRRecommendations to avoid duplicate recommendations. '
            'For every storage tool call, copy the complete fir_record_id exactly from ReadPendingFIR. '
            'Never invent, hash, shorten, or derive a fir_record_id. '
            'For each document, deeply parse the SQL to extract: '
            '1. Tables referenced (source and target) '
            '2. Column mappings (which source columns map to which target columns) '
            '3. Transformation patterns (CASE, CAST, CONCAT, date functions, etc.) '
            '4. Join patterns (how tables are related) '
            '5. Business rules (WHERE clauses, CASE logic that encodes business meaning) '
            '6. Data quality patterns (TRIM, UPPER, COALESCE for nulls) '
            '7. Every named and nested CTE/subquery, its dependencies, output grain, purpose, '
            'filters, grouping, windows, deduplication behavior, and downstream consumers '
            '8. SQL comments and naming conventions that explain business intent '
            '9. Constants, environment assumptions, ordering, effective-date logic, and fan-out risks. '
            'Combine the document with SEM_TABLE_VIEWS, SEM_COLUMN_VIEWS, SEM_NATIVE_VIEWS, '
            'and prior FIR evidence for every resolved table. A client-provided historical SQL '
            'mapping or mapping workbook is authoritative authored evidence, normally confidence '
            '0.96 or 0.99 respectively. Reduce confidence only for ambiguous resolution, parser '
            'warnings, internal contradictions, or conflict with explicit corrections. Publication '
            'adds execution and user-validation evidence; it is not required for document learning '
            'to be high confidence. Store each distinct useful insight as its own rich inference or '
            'recommendation so the persistent notification inbox can show several applicable items. '
            'Only one question may interrupt a checkpoint; all other guidance remains non-interruptive.'
        )

        if work_scope:
            base_instructions += (
                ' This run has an exact work_scope. Pass every populated project_id, sttm_id, '
                'context_key, and sql_asset_id value from work_scope to ReadPendingFIR. Do not '
                'analyze or store results for records outside that scope. For each table in the '
                'compact semantic manifest, call ReadSemanticEvidence with that exact FQN before '
                'making a semantic claim. Retrieve one table at a time.'
            )

        if task_type == 'document_learning':
            base_instructions += (
                ' PRIORITY: This is a document_learning run triggered by user uploading a file '
                'and choosing "Use as Highest-Priority Learning". Process ALL unprocessed documents '
                'immediately. Generate comprehensive recommendations for ALL agents covering every '
                'pattern found. Also run Phase 2.5 (Semantic Pre-computation) for tables mentioned '
                'in the document. The user is waiting for this to complete — be thorough but efficient.'
            )
            priority_asset = processing_options.get('priority_asset_id')
            if priority_asset:
                base_instructions += f' Priority asset ID: {priority_asset}.'

        agent_message = {
            'task_type': task_type,
            'streams_with_data': streams_with_data,
            'pending_counts': pending_counts,
            'unprocessed_documents': unprocessed_docs,
            'activity_summary': activity_summary,
            'batch_size': payload_opts.get('batch_size', 100),
            'processing_options': processing_options,
            'work_scope': work_scope,
            'instructions': base_instructions,
        }

        if payload_opts.get('precomputation_context'):
            agent_message['precomputation_context'] = payload_opts['precomputation_context']

        result['context_built'] = {
            'streams_with_data': streams_with_data,
            'pending_counts': pending_counts,
            'unprocessed_document_count': len(unprocessed_docs),
            'activity_summary': activity_summary,
            'work_scope': work_scope,
        }

        # Invoke the agent
        agent_payload = {
            'models': {'orchestration': 'claude-sonnet-4-6'},
            'messages': [
                {
                    'role': 'user',
                    'content': [{'type': 'text', 'text': json.dumps(agent_message)}]
                }
            ],
            'stream': False
        }

        budget_run_id = f"firrun_{uuid.uuid4().hex}"
        _reserve_request(
            session,
            namespace,
            budget_run_id,
            task_type,
            work_scope.get("sql_asset_id") or "",
        )

        response = _snowflake.send_snow_api_request(
            'POST',
            f'/api/v2/databases/{current_database}/schemas/{current_schema}/agents/AGT_FIR_SYSTEM:run',
            {},
            {},
            agent_payload,
            None,
            max(
                1,
                int(payload_opts.get("request_timeout_seconds", 840)),
            ) * 1000
        )

        result['agent_invoked'] = True

        if response is None:
            result['status'] = 'agent_error'
            result['errors'].append('Null response from Cortex Agent API')
            _complete_request(
                session, namespace, budget_run_id, result["status"], {}
            )
            return finish()

        status_code = response.get('status', 0)
        body_raw = response.get('content') or ''
        if isinstance(body_raw, dict):
            body = body_raw
        else:
            raw_text = body_raw.decode('utf-8', errors='replace') if isinstance(body_raw, bytes) else str(body_raw)
            try:
                body = json.loads(raw_text) if raw_text.strip() else {}
            except Exception:
                body = {'raw_content': raw_text[:4000]}
        response_body = body

        result['response_metadata'] = {
            'status_code': status_code,
            'content_length': len(body_raw) if hasattr(body_raw, '__len__') else None,
            'content_was_json': isinstance(body_raw, dict) or 'raw_content' not in body,
        }

        if status_code not in (200, 201):
            result['status'] = 'agent_error'
            result['errors'].append(f'Agent HTTP {status_code}: {json.dumps(body)[:500]}')
            _complete_request(
                session, namespace, budget_run_id, result["status"], body
            )
            return finish()

        # Extract agent response text
        agent_text = ''
        content_blocks = body.get('content', [])
        for block in content_blocks:
            if isinstance(block, dict) and block.get('type') == 'text':
                agent_text = block.get('text', '')
                break

        if not body and not agent_text:
            result['status'] = 'partial'
            result['errors'].append(
                'Agent returned an empty response body; committed tool writes may still have completed.'
            )

        # Try to parse as JSON (agent should return structured response)
        try:
            result['agent_response'] = json.loads(agent_text)
        except Exception:
            result['agent_response'] = {'raw_text': agent_text[:2000]}

        result['completed_at'] = datetime.utcnow().isoformat()
        _complete_request(
            session, namespace, budget_run_id, result["status"], body
        )

    except Exception as e:
        result['status'] = 'failed'
        result['errors'].append(str(e))
        if budget_run_id:
            try:
                _complete_request(
                    session, namespace, budget_run_id, result["status"], {}
                )
            except Exception:
                pass

    return finish()
$$;
