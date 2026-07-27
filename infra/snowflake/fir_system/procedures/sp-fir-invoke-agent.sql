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
from datetime import datetime

DEPLOYED_NAMESPACE = "__STTM_METADATA_NAMESPACE__"


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

    try:
        # Parse task payload
        payload_opts = {}
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

        # Build context for the agent
        streams_with_data = _check_streams(session, namespace)
        pending_counts = _get_pending_counts(session, namespace)
        unprocessed_docs = _get_unprocessed_documents(session, namespace)
        activity_summary = _get_recent_activity_summary(session, namespace)

        # Determine what work needs to be done
        task_type = payload_opts.get('task_type', 'stream_triggered')
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
            return result

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

        response = _snowflake.send_snow_api_request(
            'POST',
            f'/api/v2/databases/{current_database}/schemas/{current_schema}/agents/AGT_FIR_SYSTEM:run',
            {},
            {},
            agent_payload,
            None,
            900000  # 15 minutes: safely exceeds the FIR agent's 10-minute offline budget
        )

        result['agent_invoked'] = True

        if response is None:
            result['status'] = 'agent_error'
            result['errors'].append('Null response from Cortex Agent API')
            return result

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

        result['response_metadata'] = {
            'status_code': status_code,
            'content_length': len(body_raw) if hasattr(body_raw, '__len__') else None,
            'content_was_json': isinstance(body_raw, dict) or 'raw_content' not in body,
        }

        if status_code not in (200, 201):
            result['status'] = 'agent_error'
            result['errors'].append(f'Agent HTTP {status_code}: {json.dumps(body)[:500]}')
            return result

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

    except Exception as e:
        result['status'] = 'failed'
        result['errors'].append(str(e))

    return result
$$;
