from app.guardrails.config.loader import build_default_config
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.runtime.postflight import PostflightGuard
from app.schema.contracts import build_response_envelope
from app.schema.conversation import (
    ConversationArtifact,
    ConversationIntentClass,
    ConversationResponseData,
    ConversationRoute,
    ConversationStatus,
)


def test_conversation_postflight_requires_approval_without_citations() -> None:
    guard = PostflightGuard(build_default_config())
    decision = GovernanceDecision(
        trace_id="trace-1",
        request_id="req-1",
        operation="conversation.recommend",
        persona="PUBLISHER",
    )
    envelope = build_response_envelope(
        operation="conversation.recommend",
        request_id="req-1",
        data=ConversationResponseData(
            status=ConversationStatus.COMPLETED,
            route=ConversationRoute.CONVERSATION,
            intent_class=ConversationIntentClass.RECOMMENDATION,
            agent="workbench_conversation",
            message="I recommend table A.",
            artifact=ConversationArtifact(),
            citations=[],
        ),
    )

    finalized = guard.finalize_conversation_envelope(envelope, decision)

    assert finalized.data.approval_required is True
    assert finalized.meta["guardrails"]["grounding_status"] == "insufficient_evidence"


def test_conversation_postflight_rewrites_toxic_output() -> None:
    guard = PostflightGuard(build_default_config())
    decision = GovernanceDecision(
        trace_id="trace-2",
        request_id="req-2",
        operation="conversation.ask",
        persona="PUBLISHER",
    )
    envelope = build_response_envelope(
        operation="conversation.ask",
        request_id="req-2",
        data=ConversationResponseData(
            status=ConversationStatus.COMPLETED,
            route=ConversationRoute.CONVERSATION,
            intent_class=ConversationIntentClass.QUICK_ANSWER,
            agent="workbench_conversation",
            message="I hate you",
            artifact=ConversationArtifact(),
            citations=[],
        ),
    )

    finalized = guard.finalize_conversation_envelope(envelope, decision)

    assert "harmful or abusive" in (finalized.data.message or "")
    assert finalized.meta["guardrails"]["toxicity_status"] == "rewritten"
