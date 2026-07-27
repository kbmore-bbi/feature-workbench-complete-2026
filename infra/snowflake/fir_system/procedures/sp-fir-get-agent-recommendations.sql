-- ============================================================
-- SP_FIR_GET_AGENT_RECOMMENDATIONS
-- Retrieves formatted recommendations for a specific agent and trigger.
-- Called by other agents to get FIR recommendations for learning_context.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_GET_AGENT_RECOMMENDATIONS(
    "AGENT_NAME" VARCHAR,
    "TRIGGER_TYPE" VARCHAR,
    "CONTEXT" VARIANT
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'get_recommendations'
EXECUTE AS CALLER
AS
$$
import json
import re
from datetime import datetime
from typing import Any, List, Dict, Optional


def _extract_context_filters(context: dict) -> dict:
    """Extract filtering criteria from the provided context."""
    return {
        'project_id': context.get('project_id'),
        'table_names': context.get('table_names', []),
        'column_names': context.get('column_names', []),
        'sttm_id': context.get('sttm_id'),
        'semantic_bundle_id': context.get('semantic_bundle_id'),
        'context_key': context.get('context_key'),
        'source_set_hash': context.get('source_set_hash'),
        'target_fqn': context.get('target_fqn'),
        'derived_set_hash': context.get('derived_set_hash'),
        'milestone': context.get('milestone'),
        'max_results': context.get('max_results', 10),
        'min_confidence': context.get('min_confidence', 0.3),
        'include_archived': context.get('include_archived', False)
    }


def _quote(value: Any) -> str:
    return "'" + str(value or '').replace("'", "''") + "'"


def _build_query(agent_name: str, trigger_type: str, filters: dict, *, exact_only: bool) -> str:
    """Build the SQL query with live scoring: confidence * usage_factor * recency * ML boost."""
    base_query = """
        SELECT
            r.AGENT_RECOMMENDATION_ID,
            r.FIR_RECORD_ID,
            r.TARGET_AGENT,
            r.TRIGGER_TYPE,
            r.RECOMMENDATION_TYPE,
            r.RECOMMENDATION_PRIORITY,
            r.AGENT_PAYLOAD,
            r.APPLICABLE_PROJECTS,
            r.APPLICABLE_TABLES,
            r.APPLICABLE_COLUMNS,
            r.APPLICABLE_SCHEMAS,
            r.SCOPE_TYPE,
            r.SCOPE_KEY,
            r.RECOMMENDATION_CATEGORY,
            r.ACTION_CONTRACT,
            r.GROUP_KEY,
            r.CONTENT_VERSION,
            r.EVIDENCE_SUMMARY,
            r.CONTEXT_KEY,
            r.SOURCE_SET_HASH,
            r.TARGET_FQN,
            r.DERIVED_SET_HASH,
            r.MILESTONE,
            r.QUESTION_ID,
            r.EVIDENCE_IDS,
            r.CONFIDENCE,
            r.USAGE_COUNT,
            r.SUCCESS_COUNT,
            r.CREATED_AT,
            LEAST(100, GREATEST(1, ROUND(
                (COALESCE(r.CONFIDENCE, 0.5) * 100)
                * (1.0 + LN(1 + COALESCE(r.SUCCESS_COUNT, 0)) / LN(1 + GREATEST(COALESCE(r.USAGE_COUNT, 0), 1)))
                * POWER(0.95, DATEDIFF('day', r.CREATED_AT, CURRENT_TIMESTAMP()) / 30.0)
                * (0.5 + 0.5 * COALESCE(m.RECOMMENDATION_HELPFULNESS_PROBABILITY, 0.5))
            ))) AS COMPUTED_SCORE
        FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
        LEFT JOIN __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FIR_MODEL_SCORES m
            ON r.AGENT_RECOMMENDATION_ID = m.ENTITY_ID
            AND m.ENTITY_TYPE = 'recommendation'
            AND m.UPDATED_AT > DATEADD('day', -7, CURRENT_TIMESTAMP())
        WHERE r.TARGET_AGENT = {agent_name}
          AND r.TRIGGER_TYPE = {trigger_type}
          AND r.CONFIDENCE >= {min_confidence}
    """.format(
        agent_name=_quote(agent_name),
        trigger_type=_quote(trigger_type),
        min_confidence=filters['min_confidence']
    )

    if not filters['include_archived']:
        base_query += " AND r.STATUS = 'active'"

    exact_fields = {
        'CONTEXT_KEY': filters.get('context_key'),
        'SOURCE_SET_HASH': filters.get('source_set_hash'),
        'TARGET_FQN': filters.get('target_fqn'),
        'DERIVED_SET_HASH': filters.get('derived_set_hash'),
    }
    if exact_only:
        if filters.get('context_key'):
            base_query += f" AND r.CONTEXT_KEY = {_quote(filters['context_key'])}"
    else:
        # TRIGGER_TYPE already identifies the runtime checkpoint. The structured
        # fallback therefore matches table identity without requiring legacy
        # milestone aliases to be identical as well.
        for column in ('SOURCE_SET_HASH', 'TARGET_FQN', 'DERIVED_SET_HASH'):
            value = exact_fields.get(column)
            if value:
                base_query += f" AND r.{column} = {_quote(value)}"
        if filters.get('project_id'):
            base_query += (
                " AND (COALESCE(ARRAY_SIZE(r.APPLICABLE_PROJECTS), 0) = 0"
                f" OR ARRAY_CONTAINS({_quote(filters['project_id'])}::VARIANT, r.APPLICABLE_PROJECTS))"
            )
        if filters.get('column_names'):
            columns_array = "ARRAY_CONSTRUCT(" + ",".join(
                _quote(column) for column in filters['column_names']
            ) + ")"
            base_query += (
                " AND (COALESCE(ARRAY_SIZE(r.APPLICABLE_COLUMNS), 0) = 0 OR "
                f"ARRAYS_OVERLAP(r.APPLICABLE_COLUMNS, {columns_array}))"
            )

    base_query += """
        ORDER BY COMPUTED_SCORE DESC, r.RECOMMENDATION_PRIORITY DESC, r.CREATED_AT DESC
        LIMIT {max_results}
    """.format(max_results=filters['max_results'])

    return base_query


def _filter_by_applicability(recommendations: list, filters: dict) -> list:
    """Filter recommendations based on project, table, and column applicability."""
    filtered = []

    for rec in recommendations:
        applicable_projects = rec.get('applicable_projects')
        applicable_tables = rec.get('applicable_tables')
        applicable_columns = rec.get('applicable_columns')

        project_match = True
        if applicable_projects and filters['project_id']:
            project_match = filters['project_id'] in applicable_projects

        table_match = True
        if applicable_tables and filters['table_names']:
            structured_identity_match = bool(
                filters.get('source_set_hash')
                and rec.get('source_set_hash') == filters.get('source_set_hash')
                and (
                    not filters.get('target_fqn')
                    or str(rec.get('target_fqn') or '').upper()
                    == str(filters['target_fqn']).upper()
                )
                and (
                    not filters.get('derived_set_hash')
                    or rec.get('derived_set_hash') == filters.get('derived_set_hash')
                )
            )
            table_match = structured_identity_match or (
                {str(value).upper() for value in applicable_tables}
                == {str(value).upper() for value in filters['table_names']}
            )

        column_match = True
        if applicable_columns and filters['column_names']:
            column_match = any(c in applicable_columns for c in filters['column_names'])

        if project_match and table_match and column_match:
            filtered.append(rec)

    return filtered


def _format_for_learning_context(recommendations: list) -> list:
    """Format recommendations for injection into agent learning_context."""
    formatted = []

    for rec in recommendations:
        payload = rec.get('agent_payload', {})
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except:
                payload = {}

        formatted.append({
            'source': 'fir_system',
            'recommendation_id': rec.get('agent_recommendation_id'),
            'type': rec.get('recommendation_type'),
            'priority': rec.get('recommendation_priority'),
            'score': rec.get('computed_score', rec.get('recommendation_priority')),
            'confidence': rec.get('confidence'),
            'context_key': rec.get('context_key'),
            'question_id': rec.get('question_id'),
            'evidence_ids': rec.get('evidence_ids') or [],
            'evidence_summary': rec.get('evidence_summary'),
            'scope_type': rec.get('scope_type'),
            'scope_key': rec.get('scope_key'),
            'category': rec.get('recommendation_category'),
            'action_contract': rec.get('action_contract') or [],
            'group_key': rec.get('group_key'),
            'content_version': rec.get('content_version') or 1,
            'payload': payload,
            'usage_stats': {
                'used': rec.get('usage_count', 0),
                'successful': rec.get('success_count', 0)
            }
        })

    return formatted


def get_recommendations(session, agent_name: str, trigger_type: str, context: Any) -> dict:
    """Main handler to get recommendations for an agent."""
    results = {
        'status': 'success',
        'agent': agent_name,
        'trigger': trigger_type,
        'recommendations': [],
        'total_found': 0,
        'total_returned': 0,
        'errors': [],
        'retrieved_at': datetime.utcnow().isoformat()
    }

    try:
        if isinstance(context, str):
            context = json.loads(context)
        elif context is None:
            context = {}

        filters = _extract_context_filters(context)

        has_exact_context = bool(filters.get('context_key'))
        has_structured_fallback = bool(
            filters.get('source_set_hash')
            and filters.get('target_fqn')
            and filters.get('milestone')
        )
        if not has_exact_context and not has_structured_fallback:
            results['retrieval_mode'] = 'missing_exact_context'
            return results

        query = _build_query(agent_name, trigger_type, filters, exact_only=has_exact_context)
        raw_results = session.sql(query).collect()
        retrieval_mode = 'exact_context' if has_exact_context else 'structured'
        if has_exact_context and not raw_results and has_structured_fallback:
            query = _build_query(agent_name, trigger_type, filters, exact_only=False)
            raw_results = session.sql(query).collect()
            retrieval_mode = 'structured'
        elif has_exact_context and not raw_results:
            retrieval_mode = 'no_exact_match'

        recommendations = []
        for row in raw_results:
            rec = {
                'agent_recommendation_id': row['AGENT_RECOMMENDATION_ID'],
                'fir_record_id': row['FIR_RECORD_ID'],
                'target_agent': row['TARGET_AGENT'],
                'trigger_type': row['TRIGGER_TYPE'],
                'recommendation_type': row['RECOMMENDATION_TYPE'],
                'recommendation_priority': row['RECOMMENDATION_PRIORITY'],
                'computed_score': row['COMPUTED_SCORE'],
                'agent_payload': json.loads(row['AGENT_PAYLOAD']) if isinstance(row['AGENT_PAYLOAD'], str) else (row['AGENT_PAYLOAD'] or {}),
                'applicable_projects': json.loads(row['APPLICABLE_PROJECTS']) if isinstance(row['APPLICABLE_PROJECTS'], str) else (row['APPLICABLE_PROJECTS'] or []),
                'applicable_tables': json.loads(row['APPLICABLE_TABLES']) if isinstance(row['APPLICABLE_TABLES'], str) else (row['APPLICABLE_TABLES'] or []),
                'applicable_columns': json.loads(row['APPLICABLE_COLUMNS']) if isinstance(row['APPLICABLE_COLUMNS'], str) else (row['APPLICABLE_COLUMNS'] or []),
                'applicable_schemas': json.loads(row['APPLICABLE_SCHEMAS']) if isinstance(row['APPLICABLE_SCHEMAS'], str) else (row['APPLICABLE_SCHEMAS'] or []),
                'scope_type': row['SCOPE_TYPE'],
                'scope_key': row['SCOPE_KEY'],
                'recommendation_category': row['RECOMMENDATION_CATEGORY'],
                'action_contract': json.loads(row['ACTION_CONTRACT']) if isinstance(row['ACTION_CONTRACT'], str) else (row['ACTION_CONTRACT'] or []),
                'group_key': row['GROUP_KEY'],
                'content_version': row['CONTENT_VERSION'],
                'evidence_summary': row['EVIDENCE_SUMMARY'],
                'context_key': row['CONTEXT_KEY'],
                'source_set_hash': row['SOURCE_SET_HASH'],
                'target_fqn': row['TARGET_FQN'],
                'derived_set_hash': row['DERIVED_SET_HASH'],
                'milestone': row['MILESTONE'],
                'question_id': row['QUESTION_ID'],
                'evidence_ids': json.loads(row['EVIDENCE_IDS']) if isinstance(row['EVIDENCE_IDS'], str) else (row['EVIDENCE_IDS'] or []),
                'confidence': row['CONFIDENCE'],
                'usage_count': row['USAGE_COUNT'],
                'success_count': row['SUCCESS_COUNT'],
                'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None
            }
            recommendations.append(rec)

        results['total_found'] = len(recommendations)

        filtered = _filter_by_applicability(recommendations, filters)

        formatted = _format_for_learning_context(filtered)

        results['recommendations'] = formatted
        results['total_returned'] = len(formatted)
        results['retrieval_mode'] = retrieval_mode

    except Exception as e:
        results['status'] = 'failed'
        results['errors'].append(str(e))

    return results
$$;


-- ============================================================
-- SP_FIR_RECORD_RECOMMENDATION_SUCCESS
-- Compatibility bridge for old callers. New callers write explicit shown/used/
-- accepted/corrected/rejected/published outcomes with context and artifact IDs.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_RECORD_RECOMMENDATION_SUCCESS(
    "RECOMMENDATION_ID" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
BEGIN
    INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_FIR_RECOMMENDATION_OUTCOMES (
        OUTCOME_ID, AGENT_RECOMMENDATION_ID, OUTCOME_TYPE, OUTCOME_PAYLOAD
    )
    SELECT UUID_STRING(), :RECOMMENDATION_ID, 'accepted',
           OBJECT_CONSTRUCT('source', 'legacy_success_bridge')
    WHERE EXISTS (
        SELECT 1 FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        WHERE AGENT_RECOMMENDATION_ID = :RECOMMENDATION_ID
    );

    RETURN OBJECT_CONSTRUCT(
        'status', 'success',
        'recommendation_id', :RECOMMENDATION_ID,
        'recorded_at', CURRENT_TIMESTAMP()::STRING
    );
END;
$$;
