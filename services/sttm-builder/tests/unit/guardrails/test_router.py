from app.guardrails.config.loader import build_default_config
from app.guardrails.runtime.router import DeterministicRouter


def test_router_sends_conversation_ask_to_conversation_by_default() -> None:
    router = DeterministicRouter(build_default_config())

    decision = router.decide(
        operation="conversation.ask",
        payload={"data": {"message": "What can I do here?"}},
        surface="SOURCE_SELECTION",
    )

    assert decision.route == "conversation"
    assert decision.intent_class == "quick_answer"
    assert decision.target_agent == "workbench_conversation"


def test_router_sends_mapping_surface_to_sttm_builder() -> None:
    router = DeterministicRouter(build_default_config())

    decision = router.decide(
        operation="conversation.ask",
        payload={"data": {"message": "Can you fix this mapping?"}},
        surface="MAPPING",
    )

    assert decision.route == "sttm_builder"
    assert decision.intent_class == "sttm_handoff"
    assert decision.target_agent == "sttm_builder"
