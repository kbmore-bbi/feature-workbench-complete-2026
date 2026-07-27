-- ============================================================
-- SP_FIR_CONSOLIDATE_SEMANTIC_VERSIONS
-- Weekly consolidation and cleanup of semantic view versions.
-- Archives old versions, merges learnings across projects.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_CONSOLIDATE_SEMANTIC_VERSIONS()
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'consolidate_versions'
EXECUTE AS OWNER
AS
$$
import json
from datetime import datetime
from typing import Any, Dict, List


def _archive_old_versions(session) -> int:
    """Archive superseded versions older than 90 days."""
    session.sql("""
        UPDATE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
        SET STATUS = 'archived',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE STATUS = 'superseded'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) > 90
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE STATUS = 'archived'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    return count_result[0]['CNT'] if count_result else 0


def _find_cross_project_patterns(session) -> List[Dict]:
    """Find common patterns across projects that could be consolidated."""
    patterns = session.sql("""
        SELECT
            v.SEMANTIC_VIEW_FQN,
            COUNT(DISTINCT p.value) AS project_count,
            AVG(v.CONFIDENCE) AS avg_confidence,
            MAX(v.VERSION_NUMBER) AS max_version
        FROM __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS v,
             LATERAL FLATTEN(input => v.PROJECT_IDS, OUTER => TRUE) p
        WHERE v.STATUS = 'active'
          AND v.VERSION_NUMBER > 0
        GROUP BY v.SEMANTIC_VIEW_FQN
        HAVING COUNT(DISTINCT p.value) > 1
        ORDER BY project_count DESC, avg_confidence DESC
        LIMIT 20
    """).collect()

    return [
        {
            'semantic_view_fqn': row['SEMANTIC_VIEW_FQN'],
            'project_count': row['PROJECT_COUNT'],
            'avg_confidence': row['AVG_CONFIDENCE'],
            'max_version': row['MAX_VERSION']
        }
        for row in patterns
    ]


def _validate_pending_versions(session) -> int:
    """Auto-validate versions with high confidence and multiple sources."""
    session.sql("""
        UPDATE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
        SET VALIDATION_STATUS = 'validated',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE VALIDATION_STATUS = 'pending'
          AND STATUS = 'active'
          AND CONFIDENCE >= 0.75
          AND ARRAY_SIZE(LEARNING_SOURCES) >= 5
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE VALIDATION_STATUS = 'validated'
          AND STATUS = 'active'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    return count_result[0]['CNT'] if count_result else 0


def _cleanup_orphaned_records(session) -> Dict[str, int]:
    """Clean up orphaned records in FIR tables."""
    cleanup_stats = {
        'orphaned_recommendations': 0,
        'stale_pending_records': 0
    }

    session.sql("""
        UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        SET STATUS = 'archived',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE STATUS = 'active'
          AND FIR_RECORD_ID NOT IN (
              SELECT FIR_RECORD_ID FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
          )
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        WHERE STATUS = 'archived'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    cleanup_stats['orphaned_recommendations'] = count_result[0]['CNT'] if count_result else 0

    session.sql("""
        UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
        SET PROCESSING_STAGE = 'failed',
            PROCESSING_ERROR = 'Stale: pending for more than 7 days',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE PROCESSING_STAGE = 'pending'
          AND DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) > 7
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
        WHERE PROCESSING_STAGE = 'failed'
          AND PROCESSING_ERROR = 'Stale: pending for more than 7 days'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    cleanup_stats['stale_pending_records'] = count_result[0]['CNT'] if count_result else 0

    return cleanup_stats


def _compute_version_statistics(session) -> Dict[str, Any]:
    """Compute statistics about semantic versions."""
    stats = session.sql("""
        SELECT
            COUNT(*) AS total_versions,
            COUNT(CASE WHEN STATUS = 'active' THEN 1 END) AS active_versions,
            COUNT(CASE WHEN STATUS = 'superseded' THEN 1 END) AS superseded_versions,
            COUNT(CASE WHEN STATUS = 'archived' THEN 1 END) AS archived_versions,
            COUNT(CASE WHEN VALIDATION_STATUS = 'validated' THEN 1 END) AS validated_versions,
            AVG(CONFIDENCE) AS avg_confidence,
            COUNT(DISTINCT SEMANTIC_VIEW_FQN) AS unique_views
        FROM __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
    """).collect()

    if stats:
        row = stats[0]
        return {
            'total_versions': row['TOTAL_VERSIONS'],
            'active_versions': row['ACTIVE_VERSIONS'],
            'superseded_versions': row['SUPERSEDED_VERSIONS'],
            'archived_versions': row['ARCHIVED_VERSIONS'],
            'validated_versions': row['VALIDATED_VERSIONS'],
            'avg_confidence': float(row['AVG_CONFIDENCE']) if row['AVG_CONFIDENCE'] else 0,
            'unique_views': row['UNIQUE_VIEWS']
        }

    return {}


def consolidate_versions(session) -> dict:
    """Main handler for weekly semantic version consolidation."""
    results = {
        'status': 'success',
        'archived_count': 0,
        'validated_count': 0,
        'cross_project_patterns': [],
        'cleanup_stats': {},
        'version_statistics': {},
        'errors': [],
        'processed_at': datetime.utcnow().isoformat()
    }

    try:
        results['archived_count'] = _archive_old_versions(session)

        results['validated_count'] = _validate_pending_versions(session)

        results['cross_project_patterns'] = _find_cross_project_patterns(session)

        results['cleanup_stats'] = _cleanup_orphaned_records(session)

        results['version_statistics'] = _compute_version_statistics(session)

    except Exception as e:
        results['status'] = 'partial' if results['archived_count'] > 0 else 'failed'
        results['errors'].append(str(e))

    return results
$$;
