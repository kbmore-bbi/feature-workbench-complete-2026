from app.guardrails.config.loader import build_default_config
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.runtime.output_validator import OutputValidator


def test_output_validator_flags_unsafe_sql_artifact() -> None:
    validator = OutputValidator(build_default_config())
    decision = GovernanceDecision(
        trace_id="trace-1",
        request_id="req-1",
        operation="sttm.chat",
        persona="ADMIN",
    )

    artifact = validator.inspect_artifact(
        {
            "sql_text": "DELETE FROM SOME_TABLE",
            "answer_text": "Unsafe query draft",
        },
        decision,
    )

    assert artifact is not None
    assert decision.approval_required is True
    assert any(warning.code == "UNSAFE_SQL_ARTIFACT" for warning in decision.warnings)
