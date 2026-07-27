-- Scheduled, deterministic freshness and profiling feature collection.
CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_REFRESH_FEATURES(
    "MODE" VARCHAR DEFAULT 'freshness'
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'refresh_features'
EXECUTE AS OWNER
AS
$$
import json
import re
from datetime import datetime

NS = "__STTM_METADATA_NAMESPACE__"
SEM_NS = "__SEMANTIC_REGISTRY_NAMESPACE__"


def _json(value, default):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value) if value else default
    except Exception:
        return default


def _ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def _fqn(database, schema, table):
    return '.'.join(_ident(value) for value in (database, schema, table))


def _find(payload, keys):
    if not isinstance(payload, dict):
        return None
    for key in keys:
        if payload.get(key) not in (None, ''):
            return payload[key]
    for value in payload.values():
        if isinstance(value, dict):
            found = _find(value, keys)
            if found not in (None, ''):
                return found
    return None


def _table_name(value):
    if isinstance(value, str):
        return value.upper()
    if not isinstance(value, dict):
        return ''
    explicit = value.get('fqn') or value.get('FQN')
    if explicit:
        return str(explicit).upper()
    parts = [value.get(key) or value.get(key.upper()) for key in ('database', 'schema', 'table')]
    return '.'.join(str(part) for part in parts if part).upper()


def _relationship_candidates(semantic):
    relationships = []
    if isinstance(semantic, dict):
        for key in ('relationships', 'relationship_candidates'):
            if isinstance(semantic.get(key), list):
                relationships.extend(semantic[key])
    candidates = []
    for relation in relationships:
        if not isinstance(relation, dict):
            continue
        left_table = _table_name(relation.get('left_table') or relation.get('from_table'))
        right_table = _table_name(relation.get('right_table') or relation.get('to_table') or relation.get('table'))
        conditions = relation.get('conditions') or relation.get('relationship_columns') or []
        if isinstance(conditions, dict):
            conditions = [conditions]
        for condition in conditions:
            if not isinstance(condition, dict):
                continue
            left_column = condition.get('left_column') or condition.get('from_column') or condition.get('source_column')
            right_column = condition.get('right_column') or condition.get('to_column') or condition.get('target_column')
            if left_table and right_table and left_column and right_column:
                candidates.append({
                    'left_table': left_table,
                    'right_table': right_table,
                    'left_column': str(left_column),
                    'right_column': str(right_column),
                    'relationship_name': relation.get('name') or relation.get('relationship_name'),
                })
    return candidates[:10]


def _resolve_catalog_fqn(name, catalog):
    normalized = str(name or '').upper()
    if normalized in catalog:
        return catalog[normalized]
    matches = [fqn for key, fqn in catalog.items() if key.endswith('.' + normalized)]
    return matches[0] if len(set(matches)) == 1 else None


def _overlap_sample(session, candidate, catalog):
    left_name = _resolve_catalog_fqn(candidate['left_table'], catalog)
    right_name = _resolve_catalog_fqn(candidate['right_table'], catalog)
    base = {**candidate, 'sample_limit': 5000}
    if not left_name or not right_name:
        return {**base, 'status': 'unresolved_table'}
    try:
        left_parts = left_name.split('.')
        right_parts = right_name.split('.')
        left_fqn = _fqn(*left_parts)
        right_fqn = _fqn(*right_parts)
        metrics = session.sql(f"""
            WITH left_values AS (
                SELECT DISTINCT {_ident(candidate['left_column'])} AS VALUE
                FROM {left_fqn} SAMPLE BERNOULLI (10)
                WHERE {_ident(candidate['left_column'])} IS NOT NULL
                LIMIT 5000
            ), right_values AS (
                SELECT DISTINCT {_ident(candidate['right_column'])} AS VALUE
                FROM {right_fqn} SAMPLE BERNOULLI (10)
                WHERE {_ident(candidate['right_column'])} IS NOT NULL
                LIMIT 5000
            )
            SELECT
                (SELECT COUNT(*) FROM left_values) AS LEFT_DISTINCT,
                (SELECT COUNT(*) FROM right_values) AS RIGHT_DISTINCT,
                (SELECT COUNT(*) FROM left_values JOIN right_values USING (VALUE)) AS OVERLAP_COUNT
        """).collect()[0]
        left_count = int(metrics['LEFT_DISTINCT'] or 0)
        right_count = int(metrics['RIGHT_DISTINCT'] or 0)
        overlap = int(metrics['OVERLAP_COUNT'] or 0)
        denominator = min(left_count, right_count)
        return {
            **base,
            'status': 'ready',
            'left_table': left_name,
            'right_table': right_name,
            'left_distinct': left_count,
            'right_distinct': right_count,
            'overlap_count': overlap,
            'overlap_pct': round(overlap / denominator, 4) if denominator else None,
        }
    except Exception as exc:
        return {**base, 'status': 'profile_error', 'error': str(exc)}


def refresh_features(session, mode='freshness'):
    mode = str(mode or 'freshness').lower()
    rows = session.sql(f"""
        SELECT DATABASE_NAME, SCHEMA_NAME, TABLE_NAME, FQN, ROW_COUNT,
               COLUMN_SET_HASH, LAST_ALTERED_TS, SEMANTIC_VIEW
        FROM {SEM_NS}.LATEST_TABLE_VIEWS
    """).collect()
    catalog = {}
    for row in rows:
        canonical = str(row['FQN'] or '.'.join([row['DATABASE_NAME'], row['SCHEMA_NAME'], row['TABLE_NAME']])).upper()
        catalog[canonical] = canonical
        catalog[str(row['TABLE_NAME']).upper()] = canonical if str(row['TABLE_NAME']).upper() not in catalog else ''
        catalog[f"{str(row['SCHEMA_NAME']).upper()}.{str(row['TABLE_NAME']).upper()}"] = canonical
    catalog = {key: value for key, value in catalog.items() if value}
    refreshed = 0
    skipped = 0
    failures = []
    for row in rows:
        try:
            table_fqn = str(row['FQN'] or '.'.join([row['DATABASE_NAME'], row['SCHEMA_NAME'], row['TABLE_NAME']])).upper()
            semantic = _json(row['SEMANTIC_VIEW'], {})
            if mode == 'freshness':
                frequency = _find(semantic, ['expected_frequency', 'refresh_frequency', 'freshness_sla'])
                maximum = _find(semantic, ['maximum_staleness_minutes', 'max_staleness_minutes'])
                maximum_bind = str(maximum) if maximum not in (None, '') else ''
                freshness_column = _find(semantic, ['freshness_column', 'watermark_column'])
                tier = str(_find(semantic, ['criticality', 'tier']) or 'tier_3').lower().replace(' ', '_')
                if tier != 'tier_1':
                    recent = session.sql(f"""
                        SELECT COUNT(*) AS CNT
                        FROM {NS}.TBL_FIR_FRESHNESS_FEATURES
                        WHERE TABLE_FQN=? AND REFRESHED_AT >= DATEADD('hour', -24, CURRENT_TIMESTAMP())
                    """, [table_fqn]).collect()[0]
                    if int(recent['CNT'] or 0) > 0:
                        skipped += 1
                        continue
                query_count = 0
                last_queried = None
                try:
                    history = session.sql("""
                        SELECT COUNT(*) AS QUERY_COUNT, MAX(START_TIME) AS LAST_QUERIED_AT
                        FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
                        WHERE START_TIME >= DATEADD('day', -7, CURRENT_TIMESTAMP())
                          AND UPPER(QUERY_TEXT) LIKE ?
                    """, [f"%{table_fqn}%"]).collect()[0]
                    query_count = int(history['QUERY_COUNT'] or 0)
                    last_queried = history['LAST_QUERIED_AT']
                except Exception:
                    pass
                session.sql(f"""
                    MERGE INTO {NS}.TBL_FIR_FRESHNESS_FEATURES target
                    USING (SELECT ? AS TABLE_FQN) source ON target.TABLE_FQN = source.TABLE_FQN
                    WHEN MATCHED THEN UPDATE SET
                        TIER=?, DECLARED_FREQUENCY=?, MAXIMUM_STALENESS_MINUTES=TRY_TO_NUMBER(NULLIF(?, '')),
                        FRESHNESS_COLUMN=?, OBSERVED_LAST_CHANGE_AT=?,
                        OBSERVED_LAG_MINUTES=DATEDIFF('minute', ?, CURRENT_TIMESTAMP()),
                        QUERY_COUNT_7D=?, LAST_QUERIED_AT=?, FEATURE_PAYLOAD=PARSE_JSON(?),
                        REFRESHED_AT=CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN INSERT (
                        TABLE_FQN, TIER, DECLARED_FREQUENCY, MAXIMUM_STALENESS_MINUTES,
                        FRESHNESS_COLUMN, OBSERVED_LAST_CHANGE_AT, OBSERVED_LAG_MINUTES,
                        QUERY_COUNT_7D, LAST_QUERIED_AT, FEATURE_PAYLOAD
                    ) VALUES (?, ?, ?, TRY_TO_NUMBER(NULLIF(?, '')), ?, ?, DATEDIFF('minute', ?, CURRENT_TIMESTAMP()),
                              ?, ?, PARSE_JSON(?))
                """, [
                    table_fqn, tier, frequency, maximum_bind, freshness_column,
                    row['LAST_ALTERED_TS'], row['LAST_ALTERED_TS'], query_count, last_queried,
                    json.dumps({'declared_source': 'SEM_TABLE_VIEWS', 'observed_source': 'metadata_and_query_history'}),
                    table_fqn, tier, frequency, maximum_bind, freshness_column,
                    row['LAST_ALTERED_TS'], row['LAST_ALTERED_TS'], query_count, last_queried,
                    json.dumps({'declared_source': 'SEM_TABLE_VIEWS', 'observed_source': 'metadata_and_query_history'}),
                ]).collect()
            elif mode == 'profile':
                column_rows = session.sql(f"""
                    SELECT COLUMN_NAME, DATA_TYPE, ATTRIBUTE_VIEW
                    FROM {SEM_NS}.LATEST_COLUMN_VIEWS
                    WHERE UPPER(DATABASE_NAME)=? AND UPPER(SCHEMA_NAME)=? AND UPPER(TABLE_NAME)=?
                    LIMIT 50
                """, [str(row['DATABASE_NAME']).upper(), str(row['SCHEMA_NAME']).upper(), str(row['TABLE_NAME']).upper()]).collect()
                physical = _fqn(row['DATABASE_NAME'], row['SCHEMA_NAME'], row['TABLE_NAME'])
                profiles = []
                for column in column_rows:
                    name = str(column['COLUMN_NAME'])
                    try:
                        metric = session.sql(f"""
                            SELECT COUNT(*) AS ROW_COUNT,
                                   COUNT_IF({_ident(name)} IS NULL) AS NULL_COUNT,
                                   APPROX_COUNT_DISTINCT({_ident(name)}) AS DISTINCT_COUNT
                            FROM {physical} SAMPLE BERNOULLI (10) LIMIT 100000
                        """).collect()[0]
                        profiles.append({
                            'column': name,
                            'data_type': column['DATA_TYPE'],
                            'sample_row_count': metric['ROW_COUNT'],
                            'null_count': metric['NULL_COUNT'],
                            'approx_distinct_count': metric['DISTINCT_COUNT'],
                            'semantic': _json(column['ATTRIBUTE_VIEW'], {}),
                        })
                    except Exception as exc:
                        profiles.append({'column': name, 'profile_error': str(exc)})
                overlap_samples = [
                    _overlap_sample(session, candidate, catalog)
                    for candidate in _relationship_candidates(semantic)
                ]
                session.sql(f"""
                    MERGE INTO {NS}.TBL_FIR_PROFILE_FEATURES target
                    USING (SELECT ? AS TABLE_FQN) source ON target.TABLE_FQN=source.TABLE_FQN
                    WHEN MATCHED THEN UPDATE SET SCHEMA_HASH=?, ROW_COUNT=?,
                        COLUMN_PROFILES=PARSE_JSON(?), OVERLAP_SAMPLES=PARSE_JSON(?),
                        PROFILE_STATUS='ready', PROFILED_AT=CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN INSERT (
                        TABLE_FQN, SCHEMA_HASH, ROW_COUNT, COLUMN_PROFILES,
                        OVERLAP_SAMPLES, PROFILE_STATUS
                    ) VALUES (?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), 'ready')
                """, [
                    table_fqn, row['COLUMN_SET_HASH'], row['ROW_COUNT'], json.dumps(profiles, default=str),
                    json.dumps(overlap_samples, default=str),
                    table_fqn, row['COLUMN_SET_HASH'], row['ROW_COUNT'], json.dumps(profiles, default=str),
                    json.dumps(overlap_samples, default=str),
                ]).collect()
            else:
                raise ValueError("MODE must be freshness or profile")
            refreshed += 1
        except Exception as exc:
            failures.append({'table_fqn': str(row['FQN'] or ''), 'error': str(exc)})
    return {
        'status': 'success' if not failures else 'partial',
        'mode': mode,
        'table_count': len(rows),
        'refreshed_count': refreshed,
        'skipped_count': skipped,
        'failures': failures,
        'refreshed_at': datetime.utcnow().isoformat(),
    }
$$;
