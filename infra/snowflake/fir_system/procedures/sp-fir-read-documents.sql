-- ============================================================
-- SP_FIR_READ_DOCUMENTS
-- Tool for AGT_FIR_SYSTEM to read raw uploaded document content
-- from TBL_WORKBENCH_CLIENT_SQL_ASSETS for intelligent parsing.
-- Returns full SQL text, metadata, and attributes for LLM analysis.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_READ_DOCUMENTS(
    "LIMIT_COUNT" INTEGER DEFAULT 10,
    "STATUS_FILTER" VARCHAR DEFAULT 'active',
    "ASSET_ID" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'read_documents'
EXECUTE AS OWNER
AS
$$
import json
from datetime import datetime

SEM_NS = "__SEMANTIC_REGISTRY_NAMESPACE__"


def read_documents(session, limit_count: int = 10, status_filter: str = 'active', asset_id: str = None) -> dict:
    """Read uploaded documents for the FIR agent to parse and understand."""
    results = {
        'status': 'success',
        'documents': [],
        'total_found': 0,
        'read_at': datetime.utcnow().isoformat()
    }

    try:
        if asset_id:
            rows = session.sql("""
                SELECT
                    SQL_ASSET_ID,
                    PROJECT_ID,
                    ENTITY_TYPE,
                    ENTITY_IDS,
                    TITLE,
                    SQL_TEXT,
                    SQL_KIND,
                    DIALECT,
                    DESCRIPTION,
                    SOURCE_LABEL,
                    AUTHOR_NAME,
                    TAGS,
                    ATTRIBUTES,
                    STATUS,
                    CREATED_AT,
                    UPDATED_AT
                FROM __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_CLIENT_SQL_ASSETS
                WHERE SQL_ASSET_ID = ?
            """, [asset_id]).collect()
        else:
            rows = session.sql(f"""
                SELECT
                    SQL_ASSET_ID,
                    PROJECT_ID,
                    ENTITY_TYPE,
                    ENTITY_IDS,
                    TITLE,
                    SQL_TEXT,
                    SQL_KIND,
                    DIALECT,
                    DESCRIPTION,
                    SOURCE_LABEL,
                    AUTHOR_NAME,
                    TAGS,
                    ATTRIBUTES,
                    STATUS,
                    CREATED_AT,
                    UPDATED_AT
                FROM __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_CLIENT_SQL_ASSETS
                WHERE STATUS = ?
                ORDER BY CREATED_AT DESC
                LIMIT {limit_count}
            """, [status_filter]).collect()

        results['total_found'] = len(rows)

        for row in rows:
            entity_ids = row['ENTITY_IDS']
            if isinstance(entity_ids, str):
                try:
                    entity_ids = json.loads(entity_ids)
                except Exception:
                    pass

            tags = row['TAGS']
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except Exception:
                    pass

            attributes = row['ATTRIBUTES']
            if isinstance(attributes, str):
                try:
                    attributes = json.loads(attributes)
                except Exception:
                    pass

            doc = {
                'sql_asset_id': row['SQL_ASSET_ID'],
                'project_id': row['PROJECT_ID'],
                'entity_type': row['ENTITY_TYPE'],
                'entity_ids': entity_ids,
                'title': row['TITLE'],
                'sql_text': row['SQL_TEXT'],
                'sql_kind': row['SQL_KIND'],
                'dialect': row['DIALECT'],
                'description': row['DESCRIPTION'],
                'source_label': row['SOURCE_LABEL'],
                'author_name': row['AUTHOR_NAME'],
                'tags': tags,
                'attributes': attributes,
                'status': row['STATUS'],
                'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None,
                'updated_at': str(row['UPDATED_AT']) if row['UPDATED_AT'] else None
            }
            reference_rows = session.sql("""
                SELECT REFERENCE_ID, RAW_IDENTIFIER, REFERENCE_ROLE, RESOLUTION_STATUS,
                       RESOLVED_FQN, CANDIDATE_FQNS, SEMANTIC_TABLE_VIEW_ID,
                       SEMANTIC_STATUS, RESOLUTION_METHOD, RESOLUTION_CONFIDENCE
                FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_ASSET_TABLE_REFERENCES
                WHERE SQL_ASSET_ID = ?
                ORDER BY REFERENCE_ROLE, RAW_IDENTIFIER
            """, [row['SQL_ASSET_ID']]).collect()
            references = []
            resolved_fqns = []
            for reference in reference_rows:
                candidates = reference['CANDIDATE_FQNS']
                if isinstance(candidates, str):
                    try:
                        candidates = json.loads(candidates)
                    except Exception:
                        candidates = []
                item = {
                    'reference_id': reference['REFERENCE_ID'],
                    'raw_identifier': reference['RAW_IDENTIFIER'],
                    'reference_role': reference['REFERENCE_ROLE'],
                    'resolution_status': reference['RESOLUTION_STATUS'],
                    'resolved_fqn': reference['RESOLVED_FQN'],
                    'candidate_fqns': candidates or [],
                    'semantic_table_view_id': reference['SEMANTIC_TABLE_VIEW_ID'],
                    'semantic_status': reference['SEMANTIC_STATUS'],
                    'resolution_method': reference['RESOLUTION_METHOD'],
                    'resolution_confidence': reference['RESOLUTION_CONFIDENCE'],
                }
                references.append(item)
                if item['resolution_status'] == 'resolved' and item['resolved_fqn']:
                    resolved_fqns.append(item['resolved_fqn'])

            table_semantics = []
            column_semantics = []
            prior_inferences = []
            if resolved_fqns:
                placeholders = ','.join('?' for _ in resolved_fqns)
                table_semantics = [
                    dict(item.as_dict())
                    for item in session.sql(f"""
                        SELECT t.FQN, t.VIEW_ID, t.VERSION, t.SEMANTIC_VIEW,
                               n.TARGET_FQN AS PHYSICAL_VIEW_NAME,
                               n.DDL_TEXT, n.CA_YAML_MODEL, t.GENERATED_AT,
                               n.CREATED_AT AS NATIVE_CREATED_AT
                        FROM {SEM_NS}.LATEST_TABLE_VIEWS t
                        LEFT JOIN {SEM_NS}.LATEST_NATIVE_VIEWS n
                          ON UPPER(n.DATABASE_NAME) = UPPER(t.DATABASE_NAME)
                         AND UPPER(n.SCHEMA_NAME) = UPPER(t.SCHEMA_NAME)
                         AND UPPER(n.TABLE_NAME) = UPPER(t.TABLE_NAME)
                        WHERE UPPER(t.FQN) IN ({placeholders})
                    """, [str(fqn).upper() for fqn in resolved_fqns]).collect()
                ]
                column_semantics = [
                    dict(item.as_dict())
                    for item in session.sql(f"""
                        SELECT FQN, TABLE_VIEW_ID, COLUMN_NAME, DATA_TYPE, ATTRIBUTE_VIEW,
                               GENERATED_AT, COLUMN_DESCRIPTION
                        FROM {SEM_NS}.LATEST_COLUMN_VIEWS
                        WHERE UPPER(SPLIT_PART(FQN, '.', 1) || '.' ||
                                    SPLIT_PART(FQN, '.', 2) || '.' ||
                                    SPLIT_PART(FQN, '.', 3)) IN ({placeholders})
                    """, [str(fqn).upper() for fqn in resolved_fqns]).collect()
                ]
                prior_inferences = [
                    dict(item.as_dict())
                    for item in session.sql(f"""
                        SELECT INFERENCE_ID, INFERENCE_GOAL_ID, SUBJECT_KEY, SUMMARY,
                               STRUCTURED_ANSWER, CONFIDENCE, CONFIDENCE_BAND,
                               VALIDATION_STATUS
                        FROM __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES
                        WHERE UPPER(SUBJECT_KEY) IN ({placeholders})
                          AND STATUS = 'active'
                        ORDER BY CONFIDENCE DESC, UPDATED_AT DESC
                        LIMIT 100
                    """, [str(fqn).upper() for fqn in resolved_fqns]).collect()
                ]
            doc['table_references'] = references
            doc['table_semantics'] = table_semantics
            doc['column_semantics'] = column_semantics
            doc['prior_fir_evidence'] = prior_inferences
            doc['inference_ready'] = bool(references) and all(
                item['resolution_status'] == 'resolved' and item['semantic_status'] == 'active'
                for item in references
            )
            results['documents'].append(doc)

    except Exception as e:
        results['status'] = 'failed'
        results['error'] = str(e)

    return results
$$;
