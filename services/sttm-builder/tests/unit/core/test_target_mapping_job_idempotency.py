from app.core.config import Settings
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.fir_patterns import TargetMappingPatternV2


class _Row:
    def __init__(self, values: dict) -> None:
        self._values = values

    def as_dict(self) -> dict:
        return self._values


class _Query:
    def __init__(self, session: "_Session", statement: str) -> None:
        self._session = session
        self._statement = statement

    def collect(self):
        if "SELECT LEARNING_JOB_ID, ASSET_ID" in self._statement:
            return [
                _Row(
                    {
                        "LEARNING_JOB_ID": self._session.job_ids[-1],
                        "ASSET_ID": "asset_1",
                        "PROJECT_ID": "project_1",
                        "STATUS": "running",
                        "STAGE": "semantic_enrichment",
                        "DISCOVERED_PATTERN_COUNT": 1,
                        "COMPLETED_PATTERN_COUNT": 0,
                        "FAILED_PATTERN_COUNT": 0,
                    }
                )
            ]
        return []


class _Session:
    def __init__(self) -> None:
        self.statements: list[str] = []
        self.job_ids: list[str] = []

    def sql(self, statement: str):
        self.statements.append(statement)
        marker = "AS LEARNING_JOB_ID"
        if marker in statement and "MERGE INTO" in statement:
            prefix = statement.split(marker, 1)[0]
            self.job_ids.append(prefix.rsplit("'", 2)[1])
        return _Query(self, statement)


def _pattern() -> TargetMappingPatternV2:
    return TargetMappingPatternV2(
        pattern_id="pattern_1",
        target_contract={
            "target_table": "CURATED.CRM.CUSTOMER",
            "target_column": "CUSTOMER_ID",
        },
        source_compatibility_signature="source-signature",
        mapping_recipe={"mode": "direct"},
        content_hash="pattern-content-hash",
    )


def test_identical_asset_and_extraction_reuses_learning_job() -> None:
    session = _Session()
    service = TargetMappingPatternService(session, Settings())

    first = service.create_learning_job(
        asset_id="asset_1",
        project_id="project_1",
        patterns=[_pattern()],
    )
    second = service.create_learning_job(
        asset_id="asset_1",
        project_id="project_1",
        patterns=[_pattern()],
    )

    assert first.learning_job_id == second.learning_job_id
    assert first.learning_job_id.startswith("firjob_")
    assert len(set(session.job_ids)) == 1
    assert all(
        "MERGE INTO" in statement
        for statement in session.statements
        if "TBL_FIR_LEARNING_JOBS" in statement
        and "SELECT LEARNING_JOB_ID, ASSET_ID" not in statement
    )
    assert any(
        "'agent_semantic_enrichment' AS WORK_ITEM_TYPE" in statement
        for statement in session.statements
    )


def test_retry_classifier_only_retries_transient_failures() -> None:
    assert TargetMappingPatternService._is_transient_failure(
        TimeoutError("Cortex request timeout")
    )
    assert TargetMappingPatternService._is_transient_failure(
        RuntimeError("Too many requests")
    )
    assert not TargetMappingPatternService._is_transient_failure(
        ValueError("Target mapping pattern is invalid")
    )
