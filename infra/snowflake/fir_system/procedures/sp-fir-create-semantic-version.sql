-- ============================================================
-- SP_FIR_CREATE_SEMANTIC_VERSION
-- Creates a new curated semantic view version from accumulated inferences.
-- Tracks evolution: RAW → CURATED_V1 → CURATED_V2 → ...
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_CREATE_SEMANTIC_VERSION(
    "SEMANTIC_VIEW_FQN" VARCHAR,
    "PARENT_VERSION_ID" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'create_semantic_version'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime
from typing import Any, Optional


def _get_current_version(session, semantic_view_fqn: str) -> Optional[dict]:
    """Get the current active version for a semantic view."""
    result = session.sql("""
        SELECT
            VERSION_ID,
            VERSION_NUMBER,
            VERSION_LABEL,
            BUSINESS_GLOSSARY,
            RELATIONSHIP_RULES,
            TRANSFORMATION_PATTERNS,
            COLUMN_SEMANTICS,
            DERIVED_SOURCE_PATTERNS,
            CONFIDENCE
        FROM __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE SEMANTIC_VIEW_FQN = ?
          AND STATUS = 'active'
        ORDER BY VERSION_NUMBER DESC
        LIMIT 1
    """, [semantic_view_fqn]).collect()

    if result:
        row = result[0]
        return {
            'version_id': row['VERSION_ID'],
            'version_number': row['VERSION_NUMBER'],
            'version_label': row['VERSION_LABEL'],
            'business_glossary': json.loads(row['BUSINESS_GLOSSARY']) if row['BUSINESS_GLOSSARY'] else {},
            'relationship_rules': json.loads(row['RELATIONSHIP_RULES']) if row['RELATIONSHIP_RULES'] else [],
            'transformation_patterns': json.loads(row['TRANSFORMATION_PATTERNS']) if row['TRANSFORMATION_PATTERNS'] else [],
            'column_semantics': json.loads(row['COLUMN_SEMANTICS']) if row['COLUMN_SEMANTICS'] else {},
            'derived_source_patterns': json.loads(row['DERIVED_SOURCE_PATTERNS']) if row['DERIVED_SOURCE_PATTERNS'] else [],
            'confidence': row['CONFIDENCE'] or 0.5
        }
    return None


def _get_applicable_inferences(session, semantic_view_fqn: str) -> list:
    """Get inferences that explicitly reference this semantic object."""
    results = session.sql("""
        SELECT
            fir.FIR_RECORD_ID,
            fir.INFERENCE_ID,
            fir.INFERENCE_PAYLOAD,
            fir.INITIAL_CONFIDENCE,
            fir.SOURCE_TYPE,
            fir.SOURCE_EVENT_TYPE,
            fir.STTM_ID,
            fir.PROJECT_ID
        FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 fir
        LEFT JOIN __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES inf
          ON inf.INFERENCE_ID = fir.INFERENCE_ID
        WHERE fir.PROCESSING_STAGE IN (
                  'inference_generated', 'recommendation_created', 'completed'
              )
          AND fir.INFERENCE_PAYLOAD IS NOT NULL
          AND (
              UPPER(COALESCE(
                  fir.INFERENCE_PAYLOAD:business_understanding:semantic_change:view_fqn::STRING,
                  ''
              )) = UPPER(?)
              OR UPPER(COALESCE(inf.SUBJECT_KEY, '')) = UPPER(?)
              OR POSITION(
                  UPPER(?),
                  UPPER(COALESCE(TO_JSON(inf.STRUCTURED_ANSWER), ''))
              ) > 0
              OR POSITION(
                  UPPER(?),
                  UPPER(COALESCE(TO_JSON(fir.INFERENCE_PAYLOAD), ''))
              ) > 0
          )
        ORDER BY fir.CREATED_AT
        LIMIT 500
    """, [
        semantic_view_fqn,
        semantic_view_fqn,
        semantic_view_fqn,
        semantic_view_fqn,
    ]).collect()

    inferences = []
    for row in results:
        payload = json.loads(row['INFERENCE_PAYLOAD']) if isinstance(row['INFERENCE_PAYLOAD'], str) else (row['INFERENCE_PAYLOAD'] or {})
        inferences.append({
            'fir_record_id': row['FIR_RECORD_ID'],
            'inference_id': row['INFERENCE_ID'],
            'payload': payload,
            'confidence': row['INITIAL_CONFIDENCE'] or 0.5,
            'source_type': row['SOURCE_TYPE'],
            'event_type': row['SOURCE_EVENT_TYPE'],
            'sttm_id': row['STTM_ID'],
            'project_id': row['PROJECT_ID']
        })

    return inferences


def _extract_business_glossary(inferences: list, existing: dict) -> dict:
    """Extract business glossary terms from inferences."""
    glossary = dict(existing) if existing else {}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'column_relationship' in bu:
            rel = bu['column_relationship']
            if rel.get('rationale'):
                source_col = rel.get('source')
                target_col = rel.get('target')
                if source_col:
                    glossary[source_col] = glossary.get(source_col, {})
                    glossary[source_col]['rationale'] = rel.get('rationale')
                    glossary[source_col]['maps_to'] = target_col
                    glossary[source_col]['confidence'] = inf['confidence']

        if 'derived_source' in bu:
            ds = bu['derived_source']
            if ds.get('name') and ds.get('business_description'):
                glossary[ds['name']] = {
                    'type': 'derived_source',
                    'description': ds['business_description'],
                    'purpose': ds.get('purpose'),
                    'confidence': inf['confidence']
                }

    return glossary


def _extract_relationship_rules(inferences: list, existing: list) -> list:
    """Extract relationship rules from inferences."""
    rules = list(existing) if existing else []
    seen_keys = {f"{r.get('source_table')}|{r.get('target_table')}|{r.get('join_type')}" for r in rules}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'derived_source' in bu:
            ds = bu['derived_source']
            relationships = ds.get('relationships', [])
            if isinstance(relationships, list):
                for rel in relationships:
                    if isinstance(rel, dict):
                        key = f"{rel.get('left_table')}|{rel.get('right_table')}|{rel.get('join_type')}"
                        if key not in seen_keys:
                            rules.append({
                                'source_table': rel.get('left_table'),
                                'target_table': rel.get('right_table'),
                                'join_type': rel.get('join_type'),
                                'join_columns': rel.get('on_columns'),
                                'business_context': ds.get('purpose'),
                                'confidence': inf['confidence'],
                                'source_inference': inf['inference_id']
                            })
                            seen_keys.add(key)

    return rules


def _extract_transformation_patterns(inferences: list, existing: list) -> list:
    """Extract transformation patterns from inferences."""
    patterns = list(existing) if existing else []
    seen_transformations = {p.get('pattern') for p in patterns if p.get('pattern')}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'column_relationship' in bu:
            rel = bu['column_relationship']
            transformation = rel.get('transformation')
            rule = rel.get('rule')

            if transformation and transformation not in seen_transformations:
                patterns.append({
                    'pattern': transformation,
                    'rule_type': rule,
                    'source_column': rel.get('source'),
                    'target_column': rel.get('target'),
                    'rationale': rel.get('rationale'),
                    'confidence': inf['confidence'],
                    'source_inference': inf['inference_id']
                })
                seen_transformations.add(transformation)

    return patterns


def _extract_column_semantics(inferences: list, existing: dict) -> dict:
    """Extract column semantics from inferences."""
    semantics = dict(existing) if existing else {}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'column_relationship' in bu:
            rel = bu['column_relationship']
            source_col = rel.get('source')
            target_col = rel.get('target')

            if source_col:
                if source_col not in semantics:
                    semantics[source_col] = {'mappings': [], 'confidence': 0}

                semantics[source_col]['mappings'].append({
                    'target': target_col,
                    'rule': rel.get('rule'),
                    'rationale': rel.get('rationale'),
                    'ai_accepted': bu.get('ai_suggestion_accepted', False)
                })
                semantics[source_col]['confidence'] = max(
                    semantics[source_col]['confidence'],
                    inf['confidence']
                )

    return semantics


def _extract_derived_source_patterns(inferences: list, existing: list) -> list:
    """Extract derived source patterns from inferences."""
    patterns = list(existing) if existing else []
    seen_names = {p.get('name') for p in patterns if p.get('name')}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'derived_source' in bu:
            ds = bu['derived_source']
            name = ds.get('name')

            if name and name not in seen_names:
                patterns.append({
                    'name': name,
                    'purpose': ds.get('purpose'),
                    'business_description': ds.get('business_description'),
                    'source_tables': ds.get('source_tables'),
                    'confidence': inf['confidence'],
                    'source_inference': inf['inference_id']
                })
                seen_names.add(name)

    return patterns


def _calculate_version_confidence(inferences: list, existing_confidence: float) -> float:
    """Calculate confidence for the new version."""
    if not inferences:
        return existing_confidence

    avg_inference_confidence = sum(i['confidence'] for i in inferences) / len(inferences)

    high_confidence_count = sum(1 for i in inferences if i['confidence'] >= 0.8)
    high_confidence_ratio = high_confidence_count / len(inferences) if inferences else 0

    new_confidence = (existing_confidence * 0.3) + (avg_inference_confidence * 0.5) + (high_confidence_ratio * 0.2)
    return round(min(1.0, new_confidence), 3)


def create_semantic_version(session, semantic_view_fqn: str, parent_version_id: str = None) -> dict:
    """Main handler to create a new curated semantic view version."""
    results = {
        'status': 'success',
        'version_id': None,
        'version_number': None,
        'version_label': None,
        'inferences_used': 0,
        'enhancements': {},
        'errors': [],
        'created_at': datetime.utcnow().isoformat()
    }

    try:
        current_version = None
        if parent_version_id:
            parent_result = session.sql("""
                SELECT * FROM __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
                WHERE VERSION_ID = ?
            """, [parent_version_id]).collect()
            if parent_result:
                row = parent_result[0]
                current_version = {
                    'version_id': row['VERSION_ID'],
                    'version_number': row['VERSION_NUMBER'],
                    'business_glossary': json.loads(row['BUSINESS_GLOSSARY']) if row['BUSINESS_GLOSSARY'] else {},
                    'relationship_rules': json.loads(row['RELATIONSHIP_RULES']) if row['RELATIONSHIP_RULES'] else [],
                    'transformation_patterns': json.loads(row['TRANSFORMATION_PATTERNS']) if row['TRANSFORMATION_PATTERNS'] else [],
                    'column_semantics': json.loads(row['COLUMN_SEMANTICS']) if row['COLUMN_SEMANTICS'] else {},
                    'derived_source_patterns': json.loads(row['DERIVED_SOURCE_PATTERNS']) if row['DERIVED_SOURCE_PATTERNS'] else [],
                    'confidence': row['CONFIDENCE'] or 0.5
                }
        else:
            current_version = _get_current_version(session, semantic_view_fqn)

        inferences = _get_applicable_inferences(session, semantic_view_fqn)

        if not inferences and not current_version:
            results['status'] = 'skipped'
            results['errors'].append('No inferences available and no existing version')
            return results

        existing = current_version or {
            'version_number': -1,
            'business_glossary': {},
            'relationship_rules': [],
            'transformation_patterns': [],
            'column_semantics': {},
            'derived_source_patterns': [],
            'confidence': 0.5
        }

        new_glossary = _extract_business_glossary(inferences, existing['business_glossary'])
        new_rules = _extract_relationship_rules(inferences, existing['relationship_rules'])
        new_patterns = _extract_transformation_patterns(inferences, existing['transformation_patterns'])
        new_semantics = _extract_column_semantics(inferences, existing['column_semantics'])
        new_derived = _extract_derived_source_patterns(inferences, existing['derived_source_patterns'])

        new_version_number = existing['version_number'] + 1
        new_version_label = 'RAW' if new_version_number == 0 else f'CURATED_V{new_version_number}'

        new_confidence = _calculate_version_confidence(inferences, existing['confidence'])

        version_id = str(uuid.uuid4())
        parent_id = current_version['version_id'] if current_version else None

        learning_sources = [i['fir_record_id'] for i in inferences]
        mapping_ids = list(set(i['sttm_id'] for i in inferences if i.get('sttm_id')))
        project_ids = list(set(i['project_id'] for i in inferences if i.get('project_id')))

        if current_version:
            session.sql("""
                UPDATE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
                SET STATUS = 'superseded',
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE SEMANTIC_VIEW_FQN = ?
                  AND STATUS = 'active'
            """, [semantic_view_fqn]).collect()

        session.sql("""
            INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS (
                VERSION_ID, SEMANTIC_VIEW_FQN, VERSION_NUMBER, VERSION_LABEL,
                PARENT_VERSION_ID, PROMOTION_REASON,
                BUSINESS_GLOSSARY, RELATIONSHIP_RULES, TRANSFORMATION_PATTERNS,
                COLUMN_SEMANTICS, DERIVED_SOURCE_PATTERNS,
                LEARNING_SOURCES, MAPPING_EXECUTION_IDS, PROJECT_IDS,
                CONFIDENCE, VALIDATION_STATUS, STATUS,
                CREATED_AT, UPDATED_AT
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?,
                PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?),
                PARSE_JSON(?), PARSE_JSON(?),
                PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?),
                ?, 'pending', 'active',
                CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            )
        """, [
            version_id, semantic_view_fqn, new_version_number, new_version_label,
            parent_id, f'Created from {len(inferences)} inferences',
            json.dumps(new_glossary), json.dumps(new_rules), json.dumps(new_patterns),
            json.dumps(new_semantics), json.dumps(new_derived),
            json.dumps(learning_sources), json.dumps(mapping_ids), json.dumps(project_ids),
            new_confidence
        ]).collect()

        results['version_id'] = version_id
        results['version_number'] = new_version_number
        results['version_label'] = new_version_label
        results['inferences_used'] = len(inferences)
        results['enhancements'] = {
            'glossary_terms': len(new_glossary),
            'relationship_rules': len(new_rules),
            'transformation_patterns': len(new_patterns),
            'column_semantics': len(new_semantics),
            'derived_source_patterns': len(new_derived)
        }
        results['confidence'] = new_confidence

    except Exception as e:
        results['status'] = 'failed'
        results['errors'].append(str(e))

    return results
$$;
