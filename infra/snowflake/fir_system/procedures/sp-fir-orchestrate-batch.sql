-- ============================================================
-- SP_FIR_ORCHESTRATE_BATCH
-- Main orchestration procedure called by Snowflake Task.
-- Coordinates the full FIR processing pipeline.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_ORCHESTRATE_BATCH(
    "TASK_PAYLOAD" VARIANT
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'orchestrate_batch'
EXECUTE AS OWNER
AS
$$
import json
from datetime import datetime
from typing import Any, Dict


def orchestrate_batch(session, task_payload: Any) -> dict:
    """Main orchestration handler for FIR batch processing."""

    if isinstance(task_payload, str):
        task_payload = json.loads(task_payload)
    elif task_payload is None:
        task_payload = {}

    task_type = task_payload.get('task_type', 'scheduled_batch')
    batch_size = task_payload.get('batch_size', 100)
    processing_options = task_payload.get('processing_options', {})

    collect_feedback = processing_options.get('collect_feedback', True)
    generate_inferences = processing_options.get('generate_inferences', True)
    create_semantic_versions = processing_options.get('create_semantic_versions', True)
    generate_recommendations = processing_options.get('generate_recommendations', True)
    apply_decay = processing_options.get('apply_decay', False)

    results = {
        'task_type': task_type,
        'status': 'completed',
        'processing_summary': {
            'feedback_collected': 0,
            'inferences_generated': 0,
            'semantic_versions_created': 0,
            'recommendations_generated': 0,
            'decay_applied': False
        },
        'phase_details': {
            'collect_feedback': {'processed': 0, 'errors': []},
            'generate_inferences': {'processed': 0, 'errors': []},
            'create_semantic_versions': {'created': [], 'errors': []},
            'generate_recommendations': {'processed': 0, 'by_agent': {}, 'errors': []},
            'apply_decay': {'records_updated': 0, 'errors': []}
        },
        'next_run_hints': {
            'pending_feedback_count': 0,
            'suggested_batch_size': batch_size
        },
        'errors': [],
        'warnings': [],
        'started_at': datetime.utcnow().isoformat(),
        'completed_at': None
    }

    try:
        # Phase 1: Collect Feedback
        if collect_feedback:
            try:
                feedback_result = session.call('__STTM_METADATA_NAMESPACE__.SP_FIR_COLLECT_FEEDBACK')
                if isinstance(feedback_result, str):
                    feedback_result = json.loads(feedback_result)

                results['phase_details']['collect_feedback']['processed'] = feedback_result.get('total_collected', 0)
                results['phase_details']['collect_feedback']['errors'] = feedback_result.get('errors', [])
                results['processing_summary']['feedback_collected'] = feedback_result.get('total_collected', 0)

                if feedback_result.get('errors'):
                    results['warnings'].extend([f"Feedback: {e}" for e in feedback_result['errors']])

            except Exception as e:
                results['phase_details']['collect_feedback']['errors'].append(str(e))
                results['warnings'].append(f"Feedback collection failed: {str(e)}")

        # Phase 2: Generate Inferences
        if generate_inferences:
            try:
                inference_result = session.call('__STTM_METADATA_NAMESPACE__.SP_FIR_GENERATE_INFERENCES', batch_size)
                if isinstance(inference_result, str):
                    inference_result = json.loads(inference_result)

                results['phase_details']['generate_inferences']['processed'] = inference_result.get('total_generated', 0)
                results['phase_details']['generate_inferences']['errors'] = inference_result.get('errors', [])
                results['processing_summary']['inferences_generated'] = inference_result.get('total_generated', 0)

                if inference_result.get('errors'):
                    results['warnings'].extend([f"Inference: {e}" for e in inference_result['errors']])

            except Exception as e:
                results['phase_details']['generate_inferences']['errors'].append(str(e))
                results['warnings'].append(f"Inference generation failed: {str(e)}")

        # Phase 3: Create Semantic Versions (for tables with significant new inferences)
        if create_semantic_versions:
            try:
                tables_with_inferences = session.sql("""
                    SELECT DISTINCT
                        inf.INFERENCE_PAYLOAD:business_understanding:semantic_change:view_fqn::STRING AS view_fqn
                    FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 fir
                    JOIN __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES inf
                        ON fir.INFERENCE_ID = inf.INFERENCE_ID
                    WHERE fir.PROCESSING_STAGE IN ('inference_generated', 'completed')
                      AND inf.INFERENCE_TYPE = 'semantic_evolution'
                      AND fir.CREATED_AT > DATEADD('hour', -24, CURRENT_TIMESTAMP())
                      AND inf.INFERENCE_PAYLOAD:business_understanding:semantic_change:view_fqn IS NOT NULL
                    LIMIT 10
                """).collect()

                for row in tables_with_inferences:
                    view_fqn = row['VIEW_FQN']
                    if view_fqn:
                        try:
                            version_result = session.call(
                                '__STTM_METADATA_NAMESPACE__.SP_FIR_CREATE_SEMANTIC_VERSION',
                                view_fqn,
                                None
                            )
                            if isinstance(version_result, str):
                                version_result = json.loads(version_result)

                            if version_result.get('status') == 'success':
                                results['phase_details']['create_semantic_versions']['created'].append({
                                    'view_fqn': view_fqn,
                                    'version_id': version_result.get('version_id'),
                                    'version_label': version_result.get('version_label')
                                })
                                results['processing_summary']['semantic_versions_created'] += 1
                        except Exception as e:
                            results['phase_details']['create_semantic_versions']['errors'].append(f"{view_fqn}: {str(e)}")

            except Exception as e:
                results['phase_details']['create_semantic_versions']['errors'].append(str(e))
                results['warnings'].append(f"Semantic version creation failed: {str(e)}")

        # Phase 4: Generate Recommendations
        if generate_recommendations:
            try:
                rec_result = session.call('__STTM_METADATA_NAMESPACE__.SP_FIR_GENERATE_RECOMMENDATIONS', batch_size)
                if isinstance(rec_result, str):
                    rec_result = json.loads(rec_result)

                results['phase_details']['generate_recommendations']['processed'] = rec_result.get('total_generated', 0)
                results['phase_details']['generate_recommendations']['by_agent'] = rec_result.get('recommendations_by_agent', {})
                results['phase_details']['generate_recommendations']['errors'] = rec_result.get('errors', [])
                results['processing_summary']['recommendations_generated'] = rec_result.get('total_generated', 0)

                if rec_result.get('errors'):
                    results['warnings'].extend([f"Recommendation: {e}" for e in rec_result['errors']])

            except Exception as e:
                results['phase_details']['generate_recommendations']['errors'].append(str(e))
                results['warnings'].append(f"Recommendation generation failed: {str(e)}")

        # Phase 5: Apply Confidence Decay (optional, usually done by separate daily task)
        if apply_decay:
            try:
                decay_result = session.call('__STTM_METADATA_NAMESPACE__.SP_FIR_APPLY_CONFIDENCE_DECAY')
                if isinstance(decay_result, str):
                    decay_result = json.loads(decay_result)

                results['phase_details']['apply_decay']['records_updated'] = (
                    decay_result.get('fir_360_records_updated', 0) +
                    decay_result.get('recommendations_updated', 0)
                )
                results['processing_summary']['decay_applied'] = True

            except Exception as e:
                results['phase_details']['apply_decay']['errors'].append(str(e))
                results['warnings'].append(f"Confidence decay failed: {str(e)}")

        # Calculate next run hints
        pending_count_result = session.sql("""
            SELECT COUNT(*) AS cnt
            FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
            WHERE PROCESSING_STAGE = 'pending'
        """).collect()

        results['next_run_hints']['pending_feedback_count'] = pending_count_result[0]['CNT'] if pending_count_result else 0

        if results['next_run_hints']['pending_feedback_count'] > batch_size * 2:
            results['next_run_hints']['suggested_batch_size'] = min(500, batch_size * 2)

        # Determine overall status
        all_errors = []
        for phase, details in results['phase_details'].items():
            if details.get('errors'):
                all_errors.extend(details['errors'])

        if all_errors:
            results['errors'] = all_errors
            total_processed = (
                results['processing_summary']['feedback_collected'] +
                results['processing_summary']['inferences_generated'] +
                results['processing_summary']['recommendations_generated']
            )
            if total_processed == 0:
                results['status'] = 'failed'
            else:
                results['status'] = 'partial'

    except Exception as e:
        results['status'] = 'failed'
        results['errors'].append(str(e))

    results['completed_at'] = datetime.utcnow().isoformat()

    return results
$$;
