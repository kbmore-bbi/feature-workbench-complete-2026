-- ============================================================
-- SP_FIR_RECONCILE_RECOMMENDATION_IDENTITIES
-- Repairs legacy/model-authored context labels by deriving canonical
-- V2 source, target, and derived identities from linked FIR evidence.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_RECONCILE_RECOMMENDATION_IDENTITIES()
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'reconcile_recommendation_identities'
EXECUTE AS OWNER
AS
$$
import hashlib
import json


def _json_value(value):
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def _normalized_values(value):
    parsed = _json_value(value)
    if not isinstance(parsed, list):
        return []
    return sorted({
        str(item).strip().upper()
        for item in parsed
        if str(item).strip()
    })


def _stable_hash(values):
    return hashlib.sha256(
        json.dumps(values, separators=(',', ':')).encode('utf-8')
    ).hexdigest()


def reconcile_recommendation_identities(session):
    evidence_rows = session.sql("""
        SELECT
            r.AGENT_RECOMMENDATION_ID,
            e.SOURCE_TABLES,
            e.TARGET_TABLE,
            e.DERIVED_SOURCE_IDS
        FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
        JOIN __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 f
          ON f.FIR_RECORD_ID = r.FIR_RECORD_ID
        JOIN __STTM_METADATA_NAMESPACE__.TBL_FIR_CONTEXT_EVIDENCE e
          ON e.EVIDENCE_CONTEXT_ID = f.EVIDENCE_CONTEXT_ID
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY r.AGENT_RECOMMENDATION_ID
            ORDER BY e.CREATED_AT DESC
        ) = 1
    """).collect()

    identities = {}
    for row in evidence_rows:
        identities[row['AGENT_RECOMMENDATION_ID']] = {
            'sources': _normalized_values(row['SOURCE_TABLES']),
            'derived': _normalized_values(row['DERIVED_SOURCE_IDS']),
            'target': str(row['TARGET_TABLE'] or '').strip().upper() or None,
            'source': 'context_evidence',
        }

    # FIR 1.x document recommendations used SQL_ASSET_ID as FIR_RECORD_ID.
    # Recover those identities only from explicitly resolved source/target roles.
    evidence_recommendation_ids = set(identities)
    legacy_rows = session.sql("""
        SELECT
            r.AGENT_RECOMMENDATION_ID,
            ref.REFERENCE_ROLE,
            ref.RESOLVED_FQN
        FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
        JOIN __STTM_METADATA_NAMESPACE__.TBL_FIR_ASSET_TABLE_REFERENCES ref
          ON ref.SQL_ASSET_ID = r.FIR_RECORD_ID
        WHERE ref.RESOLUTION_STATUS = 'resolved'
          AND ref.RESOLVED_FQN IS NOT NULL
        ORDER BY r.AGENT_RECOMMENDATION_ID, ref.REFERENCE_ROLE, ref.RESOLVED_FQN
    """).collect()
    for row in legacy_rows:
        recommendation_id = row['AGENT_RECOMMENDATION_ID']
        if recommendation_id in evidence_recommendation_ids:
            continue
        identity = identities.setdefault(recommendation_id, {
            'sources': [],
            'derived': [],
            'target': None,
            'source': 'resolved_asset_references',
        })
        fqn = str(row['RESOLVED_FQN']).strip().upper()
        role = str(row['REFERENCE_ROLE'] or '').strip().lower()
        if role == 'target':
            identity['target'] = fqn
        elif role not in {'cte', 'cte_alias'}:
            identity['sources'].append(fqn)

    updated = 0
    skipped = 0
    recovered_legacy = 0
    for recommendation_id, identity in identities.items():
        sources = sorted(set(identity['sources']))
        derived = sorted(set(identity['derived']))
        target = identity['target']
        if not sources and not target:
            skipped += 1
            continue
        session.sql("""
            UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
            SET SOURCE_SET_HASH = ?,
                TARGET_FQN = ?,
                DERIVED_SET_HASH = ?,
                CONTEXT_VERSION = '2.0',
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE AGENT_RECOMMENDATION_ID = ?
        """, [
            _stable_hash(sources),
            target,
            _stable_hash(derived),
            recommendation_id,
        ]).collect()
        updated += 1
        if identity['source'] == 'resolved_asset_references':
            recovered_legacy += 1

    return {
        'status': 'success',
        'recommendations_examined': len(identities),
        'recommendations_updated': updated,
        'recommendations_skipped': skipped,
        'legacy_asset_recommendations_recovered': recovered_legacy,
    }
$$;

CALL __STTM_METADATA_NAMESPACE__.SP_FIR_RECONCILE_RECOMMENDATION_IDENTITIES();
