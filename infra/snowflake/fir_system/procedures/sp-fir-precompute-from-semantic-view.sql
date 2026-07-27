-- ============================================================
-- SP_FIR_PRECOMPUTE_FROM_SEMANTIC_VIEW
-- Given a semantic view FQN, reads its VARIANT content from SEM_TABLE_VIEWS,
-- extracts tables/columns/relationships, and builds a structured payload
-- for AGT_FIR_SYSTEM to generate proactive recommendations.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_PRECOMPUTE_FROM_SEMANTIC_VIEW(
    "VIEW_FQN" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'precompute_from_view'
EXECUTE AS CALLER
AS
$$
import json
from datetime import datetime

SEM_NS = "__SEMANTIC_REGISTRY_NAMESPACE__"


def _get_semantic_view(session, namespace, view_fqn):
    """Fetch the semantic view content for a specific table FQN."""
    rows = session.sql(f"""
        SELECT
            VIEW_ID,
            DATABASE_NAME,
            SCHEMA_NAME,
            TABLE_NAME,
            FQN,
            COALESCE(SEMANTIC_VIEW:semantic_level::STRING, 'L1_CONTEXT') AS SEMANTIC_LEVEL,
            SEMANTIC_VIEW,
            ROW_COUNT,
            COLUMN_COUNT,
            GENERATED_AT
        FROM {namespace}.LATEST_TABLE_VIEWS
        WHERE UPPER(FQN) = UPPER(?)
    """, [view_fqn]).collect()
    if not rows:
        return None
    row = rows[0]
    return {
        'view_id': row['VIEW_ID'],
        'database_name': row['DATABASE_NAME'],
        'schema_name': row['SCHEMA_NAME'],
        'table_name': row['TABLE_NAME'],
        'fqn': row['FQN'],
        'semantic_level': row['SEMANTIC_LEVEL'],
        'semantic_view': json.loads(row['SEMANTIC_VIEW']) if isinstance(row['SEMANTIC_VIEW'], str) else row['SEMANTIC_VIEW'],
        'row_count': row['ROW_COUNT'],
        'column_count': row['COLUMN_COUNT'],
        'generated_at': str(row['GENERATED_AT']) if row['GENERATED_AT'] else None,
    }


def _get_related_tables(session, namespace, schema_name, table_fqn):
    """Find tables in the same schema that have semantic views and potential relationships."""
    rows = session.sql(f"""
        SELECT
            FQN,
            TABLE_NAME,
            COALESCE(SEMANTIC_VIEW:semantic_level::STRING, 'L1_CONTEXT') AS SEMANTIC_LEVEL,
            SEMANTIC_VIEW:relationships AS RELATIONSHIPS,
            COLUMN_COUNT
        FROM {namespace}.LATEST_TABLE_VIEWS
        WHERE SCHEMA_NAME = ?
          AND FQN != ?
        ORDER BY GENERATED_AT DESC
    """, [schema_name, table_fqn]).collect()
    results = []
    for row in rows:
        rels = row['RELATIONSHIPS']
        if isinstance(rels, str):
            try:
                rels = json.loads(rels)
            except Exception:
                rels = None
        results.append({
            'fqn': row['FQN'],
            'table_name': row['TABLE_NAME'],
            'semantic_level': row['SEMANTIC_LEVEL'],
            'relationships': rels,
            'column_count': row['COLUMN_COUNT'],
        })
    return results


def _find_meaningful_pairs(primary_view, related_tables):
    """Find table pairs with actual relationships (not blind permutation)."""
    pairs = []
    primary_fqn = primary_view['fqn']
    sv = primary_view.get('semantic_view') or {}
    primary_relationships = sv.get('relationships', [])

    for rel in primary_relationships:
        related_table = rel.get('related_table') or rel.get('right_table') or ''
        confidence = rel.get('confidence', 'LOW')
        if confidence in ('HIGH', 'MEDIUM') or rel.get('relationship_type') == 'FORMAL':
            for rt in related_tables:
                if related_table and (related_table in rt['fqn'] or related_table == rt['table_name']):
                    pairs.append({
                        'table_a': primary_fqn,
                        'table_b': rt['fqn'],
                        'relationship': rel,
                        'confidence': confidence,
                    })
                    break

    for rt in related_tables:
        rt_rels = rt.get('relationships') or []
        if isinstance(rt_rels, list):
            for rel in rt_rels:
                related_table = rel.get('related_table') or rel.get('right_table') or ''
                confidence = rel.get('confidence', 'LOW')
                if confidence in ('HIGH', 'MEDIUM'):
                    if related_table and (related_table in primary_fqn or related_table == primary_view.get('table_name', '')):
                        already = any(p['table_b'] == rt['fqn'] or p['table_a'] == rt['fqn'] for p in pairs)
                        if not already:
                            pairs.append({
                                'table_a': rt['fqn'],
                                'table_b': primary_fqn,
                                'relationship': rel,
                                'confidence': confidence,
                            })

    return pairs


def _get_column_views(session, namespace, table_fqn):
    """Fetch column-level semantic views for a table."""
    rows = session.sql(f"""
        SELECT
            COLUMN_NAME,
            DATA_TYPE,
            ATTRIBUTE_VIEW
        FROM {namespace}.LATEST_COLUMN_VIEWS
        WHERE FQN LIKE ? || '.%'
        LIMIT 50
    """, [table_fqn]).collect()
    results = []
    for row in rows:
        av = row['ATTRIBUTE_VIEW']
        if isinstance(av, str):
            try:
                av = json.loads(av)
            except Exception:
                av = {}
        results.append({
            'column_name': row['COLUMN_NAME'],
            'data_type': row['DATA_TYPE'],
            'attribute_view': av,
        })
    return results


def precompute_from_view(session, view_fqn=None):
    """Build pre-computation context for a given semantic view FQN."""
    namespace = SEM_NS
    result = {
        'status': 'success',
        'view_fqn': view_fqn,
        'started_at': datetime.utcnow().isoformat(),
        'tables_analyzed': 0,
        'pairs_found': 0,
        'precomputation_payload': None,
    }

    if not view_fqn:
        result['status'] = 'no_input'
        return result

    primary_view = _get_semantic_view(session, namespace, view_fqn)
    if not primary_view:
        result['status'] = 'view_not_found'
        return result

    schema_name = primary_view['schema_name']
    related_tables = _get_related_tables(session, namespace, schema_name, view_fqn)
    meaningful_pairs = _find_meaningful_pairs(primary_view, related_tables)
    column_views = _get_column_views(session, namespace, view_fqn)

    result['tables_analyzed'] = 1 + len(related_tables)
    result['pairs_found'] = len(meaningful_pairs)

    result['precomputation_payload'] = {
        'primary_table': {
            'fqn': primary_view['fqn'],
            'table_name': primary_view['table_name'],
            'semantic_level': primary_view['semantic_level'],
            'semantic_view_content': primary_view['semantic_view'],
            'column_count': primary_view['column_count'],
            'row_count': primary_view['row_count'],
            'column_views': column_views,
        },
        'related_tables': [
            {
                'fqn': rt['fqn'],
                'table_name': rt['table_name'],
                'semantic_level': rt['semantic_level'],
                'column_count': rt['column_count'],
            }
            for rt in related_tables
        ],
        'meaningful_pairs': meaningful_pairs,
        'schema_name': schema_name,
    }

    result['completed_at'] = datetime.utcnow().isoformat()
    return result
$$;
