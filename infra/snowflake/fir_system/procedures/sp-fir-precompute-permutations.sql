-- ============================================================
-- SP_FIR_PRECOMPUTE_PERMUTATIONS
-- Discovers all meaningful table combinations from semantic views
-- and invokes AGT_FIR_SYSTEM for proactive recommendation generation.
-- Only generates permutations for tables with actual relationships
-- at MEDIUM+ confidence — NOT blind N² enumeration.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_PRECOMPUTE_PERMUTATIONS(
    "OPTIONS" VARIANT DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'precompute_permutations'
EXECUTE AS CALLER
AS
$$
import hashlib
import json
import uuid
import _snowflake
from datetime import datetime

META_NS = "__STTM_METADATA_NAMESPACE__"
SEM_NS = "__SEMANTIC_REGISTRY_NAMESPACE__"


def _stable_hash(values):
    normalized = sorted({str(value).strip().upper() for value in (values or []) if str(value).strip()})
    return hashlib.sha256(
        json.dumps(normalized, separators=(',', ':')).encode('utf-8')
    ).hexdigest()


def _context_variant(
    source_tables,
    target_fqn=None,
    milestone='before_auto_map',
    scope_type=None,
    scope_identity=None,
    candidate_tables=None,
):
    """Build the project-independent part of WorkbenchContextSnapshotV2 identity."""
    sources = sorted({str(value).strip().upper() for value in source_tables if str(value).strip()})
    scope_payload = {
        'scope_type': scope_type,
        'scope_identity': scope_identity,
        'milestone': milestone,
    }
    return {
        'source_tables': sources,
        'source_set_hash': _stable_hash(sources),
        'target_fqn': str(target_fqn or '').strip().upper() or None,
        'derived_source_ids': [],
        'derived_set_hash': _stable_hash([]),
        'milestone': milestone,
        'scope_type': scope_type,
        'scope_key': (
            'scope_' + hashlib.sha256(
                json.dumps(scope_payload, sort_keys=True, separators=(',', ':')).encode('utf-8')
            ).hexdigest()[:40]
            if scope_type and scope_identity
            else None
        ),
        'scope_identity': scope_identity,
        'candidate_tables': sorted({
            str(value).strip().upper()
            for value in (candidate_tables or [])
            if str(value).strip()
        }),
        # Project, selected columns, and lifecycle are only known at runtime.
        'context_key': None,
    }


def _current_namespace(session):
    row = session.sql("SELECT CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH").collect()[0]
    return str(row['DB']), str(row['SCH'])


def _consume_precompute_streams(session, namespace):
    """Advance only the dedicated permutation stream offsets."""
    session.sql(
        "CREATE TEMP TABLE IF NOT EXISTS FIR_PRECOMPUTE_STREAM_DRAIN (ACTION STRING, ROW_ID STRING)"
    ).collect()
    consumed = 0
    for stream in (
        'STM_FIR_PRECOMPUTE_SEM_TABLE_VIEWS',
        'STM_FIR_PRECOMPUTE_SEM_COLUMN_VIEWS',
        'STM_FIR_PRECOMPUTE_SEMANTIC_VERSIONS',
    ):
        try:
            rows = session.sql(f"""
                INSERT INTO FIR_PRECOMPUTE_STREAM_DRAIN
                SELECT METADATA$ACTION, METADATA$ROW_ID FROM {namespace}.{stream}
            """).collect()
            if rows:
                data = rows[0].as_dict() if hasattr(rows[0], 'as_dict') else {}
                consumed += int(next(iter(data.values()), 0) or 0)
        except Exception:
            pass
    return consumed


def _get_all_semantic_views_with_relationships(session, namespace):
    """Get all tables with active semantic views and extract FK relationships
    from semantic_model.attributes[].constraints (the actual data structure)."""
    rows = session.sql(f"""
        SELECT
            FQN,
            TABLE_NAME,
            SCHEMA_NAME,
            DATABASE_NAME,
            COALESCE(SEMANTIC_VIEW:semantic_level::STRING, 'L1_CONTEXT') AS SEMANTIC_LEVEL,
            SEMANTIC_VIEW,
            SEMANTIC_VIEW:semantic_model:attributes AS ATTRIBUTES,
            SEMANTIC_VIEW:relationships AS TOP_RELATIONSHIPS,
            COLUMN_COUNT,
            ROW_COUNT
        FROM {namespace}.LATEST_TABLE_VIEWS
        ORDER BY SCHEMA_NAME, TABLE_NAME
    """).collect()
    results = []
    for row in rows:
        # Extract FK relationships from attributes constraints
        rels = []
        attrs = row['ATTRIBUTES']
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except Exception:
                attrs = []
        if isinstance(attrs, list):
            for attr in attrs:
                constraints = attr.get('constraints', []) if isinstance(attr, dict) else []
                for c in constraints:
                    if isinstance(c, dict) and c.get('type') == 'FOREIGN_KEY':
                        confidence = c.get('confidence', 'LOW')
                        refs = c.get('references', {})
                        if refs.get('table'):
                            rels.append({
                                'related_table': refs['table'],
                                'related_column': refs.get('column'),
                                'source_column': attr.get('name'),
                                'confidence': confidence,
                            })

        # Also check top-level relationships if present
        top_rels = row['TOP_RELATIONSHIPS']
        if isinstance(top_rels, str):
            try:
                top_rels = json.loads(top_rels)
            except Exception:
                top_rels = []
        if isinstance(top_rels, list):
            rels.extend(top_rels)

        results.append({
            'fqn': row['FQN'],
            'table_name': row['TABLE_NAME'],
            'schema_name': row['SCHEMA_NAME'],
            'database_name': row['DATABASE_NAME'],
            'semantic_level': row['SEMANTIC_LEVEL'],
            'semantic_view': json.loads(row['SEMANTIC_VIEW'])
                if isinstance(row['SEMANTIC_VIEW'], str) else (row['SEMANTIC_VIEW'] or {}),
            'relationships': rels,
            'column_count': row['COLUMN_COUNT'],
            'row_count': row['ROW_COUNT'],
        })
    return results


def _get_column_semantics(session, namespace, table):
    rows = session.sql(f"""
        SELECT COLUMN_NAME, DATA_TYPE, ATTRIBUTE_VIEW
        FROM {namespace}.LATEST_COLUMN_VIEWS
        WHERE UPPER(DATABASE_NAME) = ?
          AND UPPER(SCHEMA_NAME) = ?
          AND UPPER(TABLE_NAME) = ?
    """, [
        str(table['database_name']).upper(),
        str(table['schema_name']).upper(),
        str(table['table_name']).upper(),
    ]).collect()
    columns = []
    for row in rows:
        payload = row['ATTRIBUTE_VIEW']
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {}
        payload = dict(payload) if isinstance(payload, dict) else {}
        payload['name'] = payload.get('name') or row['COLUMN_NAME']
        payload['data_type'] = payload.get('data_type') or row['DATA_TYPE']
        columns.append(payload)
    return columns


def _get_curated_semantics(session, namespace, table_fqn):
    rows = session.sql(f"""
        SELECT VERSION_ID, VERSION_NUMBER, BUSINESS_GLOSSARY, RELATIONSHIP_RULES,
               TRANSFORMATION_PATTERNS, COLUMN_SEMANTICS, DERIVED_SOURCE_PATTERNS,
               QA_PAIRS, CONFIDENCE, VALIDATION_STATUS
        FROM {namespace}.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE UPPER(SEMANTIC_VIEW_FQN) = ?
          AND STATUS = 'active'
          AND VALIDATION_STATUS = 'validated'
        ORDER BY VERSION_NUMBER DESC, UPDATED_AT DESC
        LIMIT 1
    """, [str(table_fqn).upper()]).collect()
    if not rows:
        return None
    return rows[0].as_dict() if hasattr(rows[0], 'as_dict') else dict(rows[0])


def _attach_precompute_lineage(session, namespace, variant, semantic_context):
    identity = {
        'source_set_hash': variant['source_set_hash'],
        'target_fqn': variant.get('target_fqn'),
        'derived_set_hash': variant['derived_set_hash'],
        'milestone': variant['milestone'],
        'scope_type': variant.get('scope_type'),
        'scope_key': variant.get('scope_key'),
    }
    semantic_hash = hashlib.sha256(
        json.dumps(semantic_context, sort_keys=True, separators=(',', ':'), default=str).encode('utf-8')
    ).hexdigest()
    fir_key = hashlib.sha256(
        json.dumps({'identity': identity, 'semantic_hash': semantic_hash}, sort_keys=True).encode('utf-8')
    ).hexdigest()[:40]
    existing = session.sql(f"""
        SELECT f.FIR_RECORD_ID, f.EVIDENCE_CONTEXT_ID, e.EVIDENCE_PAYLOAD
        FROM {namespace}.TBL_AGENT_FIR_360 f
        LEFT JOIN {namespace}.TBL_FIR_CONTEXT_EVIDENCE e
          ON e.EVIDENCE_CONTEXT_ID = f.EVIDENCE_CONTEXT_ID
        WHERE f.FIR_RECORD_KEY = ?
        ORDER BY f.CREATED_AT DESC
        LIMIT 1
    """, [f'precompute|{fir_key}']).collect()
    if existing:
        variant['fir_record_id'] = existing[0]['FIR_RECORD_ID']
        existing_payload = existing[0]['EVIDENCE_PAYLOAD'] or {}
        if isinstance(existing_payload, str):
            try:
                existing_payload = json.loads(existing_payload)
            except Exception:
                existing_payload = {}
        variant['evidence_ids'] = (
            existing_payload.get('readable_evidence_ids')
            or [existing[0]['EVIDENCE_CONTEXT_ID']]
        )
        return

    fir_record_id = str(uuid.uuid4())
    evidence_id = str(uuid.uuid4())
    evidence_context_key = f'prectx_{fir_key}'
    readable_evidence_ids = []
    for item in semantic_context:
        source_fqn = str(item.get('fqn') or '')
        readable_hash = hashlib.sha256(
            json.dumps(
                {
                    'source_fqn': source_fqn,
                    'milestone': variant['milestone'],
                    'scope_key': variant.get('scope_key'),
                    'semantic_hash': semantic_hash,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        readable_id = f"evidence_{readable_hash[:32]}"
        readable_evidence_ids.append(readable_id)
        table_semantic = item.get('table_semantic_view') or {}
        summary = (
            table_semantic.get('description')
            or table_semantic.get('business_description')
            or f"Semantic registry context for {source_fqn}"
        )
        session.sql(f"""
            MERGE INTO {namespace}.TBL_FIR_EVIDENCE_ITEMS target
            USING (
                SELECT ? AS EVIDENCE_ID, 'semantic_registry' AS SOURCE_TYPE,
                       ? AS SOURCE_TABLE, ? AS SOURCE_RECORD_ID,
                       ? AS TITLE, ? AS SUMMARY, ? AS REDACTED_EXCERPT,
                       PARSE_JSON(?) AS STRUCTURED_PAYLOAD, ? AS CONTEXT_KEY,
                       0.80 AS EVIDENCE_WEIGHT, ? AS SOURCE_HASH
            ) source
            ON target.SOURCE_HASH = source.SOURCE_HASH
            WHEN MATCHED THEN UPDATE SET
                TITLE = source.TITLE,
                SUMMARY = source.SUMMARY,
                REDACTED_EXCERPT = source.REDACTED_EXCERPT,
                STRUCTURED_PAYLOAD = source.STRUCTURED_PAYLOAD,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                EVIDENCE_ID, SOURCE_TYPE, SOURCE_TABLE, SOURCE_RECORD_ID,
                TITLE, SUMMARY, REDACTED_EXCERPT, STRUCTURED_PAYLOAD,
                CONTEXT_KEY, EVIDENCE_WEIGHT, SOURCE_HASH
            ) VALUES (
                source.EVIDENCE_ID, source.SOURCE_TYPE, source.SOURCE_TABLE,
                source.SOURCE_RECORD_ID, source.TITLE, source.SUMMARY,
                source.REDACTED_EXCERPT, source.STRUCTURED_PAYLOAD,
                source.CONTEXT_KEY, source.EVIDENCE_WEIGHT, source.SOURCE_HASH
            )
        """, [
            readable_id,
            source_fqn,
            source_fqn,
            f"Semantic definition: {source_fqn}",
            str(summary)[:5000],
            json.dumps(table_semantic, default=str)[:4000],
            json.dumps(item, default=str),
            evidence_context_key,
            readable_hash,
        ]).collect()

    evidence_payload = {
        'kind': 'semantic_precomputation',
        'identity': identity,
        'semantic_context': semantic_context,
        'readable_evidence_ids': readable_evidence_ids,
    }
    session.sql(f"""
        INSERT INTO {namespace}.TBL_FIR_CONTEXT_EVIDENCE (
            EVIDENCE_CONTEXT_ID, CONTEXT_KEY, SOURCE_TABLES, TARGET_TABLE,
            DERIVED_SOURCE_IDS, MILESTONE, SEMANTIC_HASH, EVIDENCE_PAYLOAD
        ) SELECT ?, ?, PARSE_JSON(?), ?, PARSE_JSON('[]'), ?, ?, PARSE_JSON(?)
    """, [
        evidence_id, evidence_context_key,
        json.dumps(variant['source_tables'] or variant.get('candidate_tables') or []),
        variant.get('target_fqn'), variant['milestone'], semantic_hash,
        json.dumps(evidence_payload, default=str),
    ]).collect()
    session.sql(f"""
        INSERT INTO {namespace}.TBL_AGENT_FIR_360 (
            FIR_RECORD_ID, FIR_RECORD_KEY, SOURCE_TYPE, SOURCE_EVENT_TYPE,
            ENTITY_TYPE, ENTITY_IDS, PROCESSING_STAGE, PROCESSING_VERSION,
            FEEDBACK_PAYLOAD, INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
            CONTEXT_KEY, MILESTONE, EVIDENCE_CONTEXT_ID
        ) SELECT ?, ?, 'implicit', 'semantic.precomputed', 'semantic_context', PARSE_JSON(?),
                 'pending', '2.0', PARSE_JSON(?), 0.70, 0.70, PARSE_JSON(?), ?, ?, ?
    """, [
        fir_record_id, f'precompute|{fir_key}',
        json.dumps(
            variant['source_tables']
            + variant.get('candidate_tables', [])
            + ([variant['target_fqn']] if variant.get('target_fqn') else [])
        ),
        json.dumps(evidence_payload, default=str),
        json.dumps(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING', 'AGT_TRANSFORMATION_RULE']),
        evidence_context_key, variant['milestone'], evidence_id,
    ]).collect()
    variant['fir_record_id'] = fir_record_id
    variant['evidence_ids'] = readable_evidence_ids or [evidence_id]


def _get_document_table_learnings(session, namespace):
    """Query TBL_WORKBENCH_CLIENT_SQL_ASSETS for active documents and extract
    table references, join patterns, CTE patterns, and transformations from
    the ATTRIBUTES JSON column."""
    rows = session.sql(f"""
        SELECT
            SQL_ASSET_ID,
            TITLE,
            ATTRIBUTES
        FROM {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS
        WHERE STATUS = 'active'
          AND ATTRIBUTES IS NOT NULL
        ORDER BY UPDATED_AT DESC
        LIMIT 50
    """).collect()

    learnings = []
    for row in rows:
        attrs = row['ATTRIBUTES']
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except Exception:
                continue
        if not isinstance(attrs, dict):
            continue

        source_tables = attrs.get('source_tables', [])
        join_patterns = attrs.get('join_patterns', [])
        cte_patterns = attrs.get('ctes', [])
        transformations = attrs.get('transformations', [])

        if not source_tables and not join_patterns:
            continue

        learnings.append({
            'asset_id': row['SQL_ASSET_ID'],
            'filename': row['TITLE'],
            'tables': source_tables if isinstance(source_tables, list) else [],
            'join_patterns': join_patterns if isinstance(join_patterns, list) else [],
            'ctes': cte_patterns if isinstance(cte_patterns, list) else [],
            'transformations': transformations if isinstance(transformations, list) else [],
        })

    return learnings


def _extract_meaningful_combinations(tables):
    """Find all meaningful table combinations based on FK relationships.

    Relationships come from semantic_model.attributes[].constraints FK references.
    The related_table is just a table name (not FQN), so we match by table_name
    within the same schema/database.
    """
    table_map = {t['fqn']: t for t in tables}
    # Build name lookup: table_name -> list of FQNs (same schema preferred)
    name_to_fqns = {}
    for t in tables:
        name_to_fqns.setdefault(t['table_name'].upper(), []).append(t)

    pairs = set()

    for table in tables:
        for rel in table.get('relationships', []):
            related_name = (rel.get('related_table') or rel.get('right_table') or '').upper()
            confidence = (rel.get('confidence') or 'LOW').upper()
            if confidence not in ('HIGH', 'MEDIUM'):
                continue
            if not related_name:
                continue

            # Find matching table by name (prefer same schema)
            candidates = name_to_fqns.get(related_name, [])
            matched = None
            for c in candidates:
                if c['fqn'] == table['fqn']:
                    continue
                if c['schema_name'] == table['schema_name'] and c['database_name'] == table['database_name']:
                    matched = c
                    break
            if not matched and candidates:
                matched = next((c for c in candidates if c['fqn'] != table['fqn']), None)

            if matched:
                pair_key = tuple(sorted([table['fqn'], matched['fqn']]))
                pairs.add(pair_key)

    pair_list = [
        {'table_a': p[0], 'table_b': p[1]}
        for p in pairs
    ]

    # Build adjacency graph for multi-table groups
    adjacency = {}
    for p in pairs:
        adjacency.setdefault(p[0], set()).add(p[1])
        adjacency.setdefault(p[1], set()).add(p[0])

    groups = []
    for table_fqn, neighbors in adjacency.items():
        if len(neighbors) >= 2:
            group_tables = sorted([table_fqn] + list(neighbors))
            if len(group_tables) <= 5:
                groups.append(group_tables)

    seen_groups = set()
    unique_groups = []
    for g in groups:
        key = tuple(g)
        if key not in seen_groups:
            seen_groups.add(key)
            unique_groups.append(g)

    return pair_list, unique_groups


def _check_existing_recommendations(session, namespace, table_fqns, recent_days=7):
    """Check if recommendations already exist for these tables to avoid duplicates."""
    source_set_hash = _stable_hash(table_fqns)
    rows = session.sql(f"""
        SELECT COUNT(*) AS CNT
        FROM {namespace}.TBL_FIR_AGENT_RECOMMENDATIONS
        WHERE STATUS = 'active'
          AND SOURCE_SET_HASH = ?
          AND CREATED_AT > DATEADD('day', ?, CURRENT_TIMESTAMP())
    """, [source_set_hash, -max(1, int(recent_days))]).collect()
    return rows[0]['CNT'] if rows else 0


def _invoke_fir_agent_for_precomputation(session, db, schema, precompute_payload):
    """Invoke AGT_FIR_SYSTEM with pre-computation context."""
    agent_message = {
        'task_type': 'semantic_precomputation',
        'streams_with_data': ['STM_FIR_SEM_TABLE_VIEWS'],
        'pending_counts': {},
        'unprocessed_documents': [],
        'activity_summary': {},
        'batch_size': 50,
        'processing_options': {
            'collect_feedback': False,
            'generate_inferences': True,
            'create_semantic_versions': False,
            'generate_recommendations': True,
            'apply_decay': False,
            'parse_documents': False,
            'precompute_recommendations': True,
        },
        'precomputation_context': precompute_payload,
        'instructions': (
            'This is a SEMANTIC PRE-COMPUTATION run. Your job is to generate proactive '
            'recommendations for the table combinations provided. For each table pair or group, '
            'generate recommendations covering: '
            '1. Single table selected: table meaning, related tables, possible targets, business context '
            '2. Table pairs with relationships: explain relationship, confidence, join patterns '
            '3. Multi-table groups: derived source suggestions with business meaning '
            '4. Source-to-target combinations: automapping hints, preprocessing rules '
            '5. Question and answer pairs: common questions users would ask about these tables '
            'Use SearchFIRKnowledge to avoid duplicates. '
            'Each context_variants entry is one exact source/target/milestone identity. '
            'Use that entry\'s fir_record_id for StoreFIRInference and StoreRecommendation, '
            'and copy its evidence_ids into both calls. First store the applicable fixed-goal '
            'Q1/Q2/Q3/Q5/Q6/Q7 inference, then store recommendations derived from it. '
            'Store Q8 blast-radius and Q9 query-pattern outputs only as recommendations. '
            'Never store Q4 or Q10 from precomputation because they require explicit user feedback. '
            'Copy its source_set_hash, target_fqn, derived_set_hash, milestone, context_key, '
            'scope_type, scope_key, and applicable_schemas unchanged into StoreRecommendation. '
            'Never merge identities across variants. Set recommendation_category and a structured '
            'action_contract for every user-facing recommendation. '
            'Set APPLICABLE_TABLES to the same full FQNs so it triggers at the right time. '
            'Include supporting inference IDs and evidence IDs in evidence_ids and agent_payload. '
            'CRITICAL: For every APP_USER_NOTIFICATION recommendation, you MUST provide a '
            'display_message that is clear, conversational, and actionable. Never pass None. '
            'Example: "FACT_SALES joins to ORDER_DIM via ORDER_KEY. This is the primary '
            'fact-dimension link in this star schema — consider adding ORDER_DIM for date/shipping context." '
            'Also provide display_options with at least: '
            '[{"id":"useful","label":"Looks useful"},{"id":"dismiss","label":"Not relevant"}] '
            'The precomputation_context includes document_context from uploaded SQL scripts. '
            'Use these to connect document learnings with table relationships: '
            '- If a document shows TABLE_A JOIN TABLE_B, create recommendations for that pair '
            '- If a document has CTEs combining multiple tables, create derived_source_suggestion recs '
            '- Set applicable_tables to the FULL FQNs so they connect when users select those tables '
            'CRITICAL: Every APP_USER_NOTIFICATION must have a non-empty display_message. '
        ),
    }

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
        f'/api/v2/databases/{db}/schemas/{schema}/agents/AGT_FIR_SYSTEM:run',
        {},
        {},
        agent_payload,
        None,
        600000  # 10 minute timeout for comprehensive pre-computation
    )
    return response


def precompute_permutations(session, options=None):
    """Discover meaningful table combinations and invoke FIR for pre-computation."""
    db, schema = _current_namespace(session)
    namespace = META_NS

    result = {
        'status': 'success',
        'started_at': datetime.utcnow().isoformat(),
        'tables_with_views': 0,
        'meaningful_pairs': 0,
        'table_groups': 0,
        'recommendations_skipped': 0,
        'agent_invocations': 0,
        'errors': [],
    }
    result['consumed_stream_rows'] = _consume_precompute_streams(session, namespace)

    opts = {}
    if options:
        if isinstance(options, str):
            try:
                opts = json.loads(options)
            except Exception:
                pass
        else:
            opts = dict(options) if options else {}

    max_pairs_per_batch = opts.get('max_pairs_per_batch', 10)
    skip_if_recent = opts.get('skip_if_recent_days', 7)

    # Allow overriding where to read semantic views from
    sem_views_ns = opts.get('semantic_views_namespace', SEM_NS)
    tables = _get_all_semantic_views_with_relationships(session, sem_views_ns)
    result['tables_with_views'] = len(tables)

    if not tables:
        result['status'] = 'no_semantic_views'
        return result

    # Merge document learnings from TBL_WORKBENCH_CLIENT_SQL_ASSETS
    document_learnings = _get_document_table_learnings(session, namespace)
    result['document_learnings_count'] = len(document_learnings)

    # Build a set of existing table FQNs and names for lookup
    existing_fqns = {t['fqn'].upper() for t in tables}
    existing_names = {t['table_name'].upper() for t in tables}

    for doc in document_learnings:
        # Missing semantic assets are resolved by TBL_FIR_ASSET_TABLE_REFERENCES
        # and deferred for user resolution; they are never guessed into a bundle.
        for tbl_ref in doc.get('tables', []):
            tbl_name = tbl_ref.upper() if isinstance(tbl_ref, str) else ''
            if not tbl_name:
                continue
            # Check if this table (by name or FQN) is already known
            if tbl_name not in existing_fqns and tbl_name.split('.')[-1] not in existing_names:
                result_key = 'document_tables_deferred'
                result[result_key] = result.get(result_key, 0) + 1

        # For join patterns in documents, add as relationships (pairs)
        for jp in doc.get('join_patterns', []):
            if isinstance(jp, dict):
                left = (jp.get('left_table') or jp.get('table_a') or '').upper()
                right = (jp.get('right_table') or jp.get('table_b') or '').upper()
                if left and right:
                    # Find or create entries for these tables and add relationship
                    for t in tables:
                        if t['fqn'].upper() == left or t['table_name'].upper() == left.split('.')[-1]:
                            t['relationships'].append({
                                'related_table': right.split('.')[-1],
                                'related_column': jp.get('join_column'),
                                'source_column': jp.get('source_column'),
                                'confidence': 'MEDIUM',
                            })
                            break

    pairs, groups = _extract_meaningful_combinations(tables)
    result['meaningful_pairs'] = len(pairs)
    result['table_groups'] = len(groups)

    if not pairs and not groups:
        result['status'] = 'no_relationships_found'
        return result

    batch_payload = {
        'tables': [
            {
                'fqn': t['fqn'],
                'table_name': t['table_name'],
                'schema_name': t['schema_name'],
                'semantic_level': t['semantic_level'],
                'column_count': t['column_count'],
            }
            for t in tables
        ],
        'pairs': [],
        'groups': groups[:5],
        'context_variants': [],
        'document_context': [
            {
                'filename': doc['filename'],
                'tables': doc['tables'],
                'join_patterns': doc['join_patterns'],
                'ctes': doc['ctes'],
            }
            for doc in document_learnings[:10]
        ],
    }

    for pair in pairs[:max_pairs_per_batch]:
        table_fqns = [pair['table_a'], pair['table_b']]
        existing = _check_existing_recommendations(
            session, namespace, table_fqns, skip_if_recent
        )
        if existing > 3:
            result['recommendations_skipped'] += 1
            continue
        batch_payload['pairs'].append(pair)
        batch_payload['context_variants'].extend([
            _context_variant(table_fqns, milestone='source_set_completed'),
            _context_variant(table_fqns, milestone='join_completed'),
            _context_variant(
                table_fqns,
                milestone='source_query_review',
                scope_type='table_set',
                scope_identity='|'.join(sorted(table_fqns)),
            ),
            _context_variant([pair['table_a']], pair['table_b'], milestone='target_selected'),
            _context_variant([pair['table_a']], pair['table_b'], milestone='derived_source_planning'),
            _context_variant([pair['table_a']], pair['table_b'], milestone='before_auto_map'),
            _context_variant([pair['table_b']], pair['table_a'], milestone='target_selected'),
            _context_variant([pair['table_b']], pair['table_a'], milestone='derived_source_planning'),
            _context_variant([pair['table_b']], pair['table_a'], milestone='before_auto_map'),
        ])

    for group in batch_payload['groups']:
        batch_payload['context_variants'].append(
            _context_variant(group, milestone='source_set_completed')
        )
        for target_fqn in group:
            batch_payload['context_variants'].append(
                _context_variant(
                    [table_fqn for table_fqn in group if table_fqn != target_fqn],
                    target_fqn,
                    milestone='before_auto_map',
                )
            )

    tables_by_schema = {}
    for table in tables:
        schema_fqn = f"{table['database_name']}.{table['schema_name']}".upper()
        tables_by_schema.setdefault(schema_fqn, []).append(str(table['fqn']).upper())
    for schema_fqn, candidate_tables in tables_by_schema.items():
        batch_payload['context_variants'].append(
            _context_variant(
                [],
                milestone='schema_browsed',
                scope_type='schema',
                scope_identity=schema_fqn,
                candidate_tables=candidate_tables,
            )
        )

    related_fqns = {
        table_fqn
        for variant in batch_payload['context_variants']
        for table_fqn in [
            *variant['source_tables'],
            *variant.get('candidate_tables', []),
            variant.get('target_fqn'),
        ]
        if table_fqn
    }
    for table_fqn in sorted(related_fqns):
        batch_payload['context_variants'].extend([
            _context_variant([table_fqn], milestone='selection_changed'),
            _context_variant([], table_fqn, milestone='target_selected'),
        ])

    unique_variants = {}
    for variant in batch_payload['context_variants']:
        key = (
            variant['source_set_hash'], variant.get('target_fqn') or '',
            variant['derived_set_hash'], variant['milestone'],
            variant.get('scope_key') or '',
        )
        unique_variants[key] = variant
    batch_payload['context_variants'] = list(unique_variants.values())

    relevant_fqns = {
        table_fqn
        for variant in batch_payload['context_variants']
        for table_fqn in [
            *variant['source_tables'],
            *variant.get('candidate_tables', []),
            variant.get('target_fqn'),
        ]
        if table_fqn
    }
    table_by_fqn = {str(table['fqn']).upper(): table for table in tables}
    semantic_context = []
    for table_fqn in sorted(relevant_fqns):
        table = table_by_fqn.get(table_fqn)
        if not table:
            continue
        semantic_context.append({
            'fqn': table['fqn'],
            'semantic_level': table['semantic_level'],
            'table_semantic_view': table['semantic_view'],
            'column_semantics': _get_column_semantics(session, sem_views_ns, table),
            'curated_semantics': _get_curated_semantics(session, namespace, table['fqn']),
            'relationships': table['relationships'],
            'row_count': table['row_count'],
            'column_count': table['column_count'],
        })
    batch_payload['semantic_context'] = semantic_context
    for variant in batch_payload['context_variants']:
        scoped_semantics = [
            item for item in semantic_context
            if str(item['fqn']).upper() in set(
                variant['source_tables']
                + variant.get('candidate_tables', [])
                + ([variant['target_fqn']] if variant.get('target_fqn') else [])
            )
        ]
        _attach_precompute_lineage(session, namespace, variant, scoped_semantics)

    if not batch_payload['pairs'] and not batch_payload['groups']:
        result['status'] = 'all_skipped_recent_exists'
        return result

    try:
        response = _invoke_fir_agent_for_precomputation(session, db, schema, batch_payload)
        result['agent_invocations'] = 1
        if response:
            status_code = response.get('status', 0)
            if status_code not in (200, 201):
                result['errors'].append(f'Agent HTTP {status_code}')
    except Exception as e:
        result['errors'].append(str(e))
        result['status'] = 'partial'

    result['completed_at'] = datetime.utcnow().isoformat()
    return result
$$;
