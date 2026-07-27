from app.core.agent_learning_service import AgentLearningService


class _Row:
    def __getitem__(self, index):
        return "lrn_existing"


class _Collectable:
    def __init__(self, rows=None):
        self._rows = rows or []

    def collect(self):
        return self._rows


class _Session:
    def __init__(self):
        self.statements = []
        self.procedure_calls = 0

    def sql(self, statement):
        self.statements.append(statement)
        if "CALL " in statement:
            self.procedure_calls += 1
            raise RuntimeError(
                "Unknown user-defined function DB.SCHEMA.SP_RECORD_AGENT_LEARNING"
            )
        if "SELECT LEARNING_ID" in statement:
            return _Collectable([_Row()])
        return _Collectable()


class _Settings:
    snowflake_database = "DB"
    snowflake_schema = "SCHEMA"


def test_missing_record_procedure_is_cached_and_direct_merge_is_used():
    session = _Session()
    service = AgentLearningService(session, _Settings())

    first = service.record_learning(
        "SOURCE_MAPPING",
        "mapping_acceptance",
        "Accepted mapping",
        {"target_column": "CUSTOMER_ID"},
    )
    second = service.record_learning(
        "SOURCE_MAPPING",
        "mapping_acceptance",
        "Accepted mapping again",
        {"target_column": "CUSTOMER_NAME"},
    )

    assert first == "lrn_existing"
    assert second == "lrn_existing"
    assert session.procedure_calls == 1
    assert sum("MERGE INTO DB.SCHEMA.TBL_AGENT_LEARNINGS" in sql for sql in session.statements) == 2
