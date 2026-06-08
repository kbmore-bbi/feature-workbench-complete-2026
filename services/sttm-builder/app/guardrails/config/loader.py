from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.guardrails.config.schema import (
    AgentPolicyConfig,
    AuditConfig,
    ApprovalPolicyConfig,
    FeedbackPolicyConfig,
    GroundingPolicyConfig,
    GuardrailsConfig,
    IntentPolicyConfig,
    ManagedSafetyConfig,
    OutputConfig,
    PersonaPolicyConfig,
    RagSourceConfig,
    RedactionConfig,
    RecommendationPolicyConfig,
    RoutePolicyConfig,
    SnowflakeGuardrailsConfig,
    ToxicityPolicyConfig,
)


def _default_personas() -> dict[str, PersonaPolicyConfig]:
    shared_ops = [
        "agents.list",
        "workbench.info",
        "sttm.auto_map",
        "sttm.chat",
        "sttm.transform",
        "semantic_model.generate",
        "semantic_model.get",
        "semantic_model.job_status",
        "conversation.ask",
        "conversation.recommend",
        "conversation.feedback",
        "conversation.handoff.sttm",
        "conversation.search",
    ]
    return {
        "VIEWER": PersonaPolicyConfig(
            allowed_operations=shared_ops,
            allow_sample_rows=False,
            allow_raw_pii=False,
        ),
        "PUBLISHER": PersonaPolicyConfig(
            allowed_operations=shared_ops,
            allow_sample_rows=False,
            allow_raw_pii=False,
        ),
        "ADMIN": PersonaPolicyConfig(
            allowed_operations=[*shared_ops, "conversation.index.sync"],
            allow_sample_rows=True,
            allow_raw_pii=False,
        ),
    }


def _default_routes() -> dict[str, RoutePolicyConfig]:
    return {
        "sttm_builder": RoutePolicyConfig(
            allowed_operations=[
                "sttm.auto_map",
                "sttm.chat",
                "sttm.transform",
                "conversation.handoff.sttm",
            ],
            default_agent="sttm_builder",
        ),
        "conversation": RoutePolicyConfig(
            allowed_operations=[
                "conversation.ask",
                "conversation.recommend",
                "conversation.feedback",
                "conversation.search",
            ],
            default_agent="workbench_conversation",
        ),
    }


def _default_agents() -> dict[str, AgentPolicyConfig]:
    return {
        "workbench_conversation": AgentPolicyConfig(
            allowed_callers=["backend_router"],
            allowed_operations=[
                "conversation.ask",
                "conversation.recommend",
                "conversation.feedback",
                "conversation.search",
            ],
            allowed_downstream_agents=[],
            allowed_tools=["rag.semantic_context"],
            allowed_data_classes=["governed_structured_data", "retrieved_untrusted", "user_input"],
            output_contract="conversation_envelope",
            approval_triggers=["insufficient_evidence", "cross_domain_recommendation"],
        ),
        "sttm_builder": AgentPolicyConfig(
            allowed_callers=["backend_router", "conversation_handoff"],
            allowed_operations=[
                "sttm.auto_map",
                "sttm.chat",
                "sttm.transform",
                "conversation.handoff.sttm",
            ],
            allowed_downstream_agents=["semantic_model", "source_mapping", "transformation_rule", "analyst"],
            allowed_tools=["analyst", "sttm_subagent"],
            allowed_data_classes=["governed_structured_data", "user_input"],
            output_contract="sttm_envelope",
            approval_triggers=["derived_sql", "unsafe_sql", "low_confidence_mapping"],
        ),
        "semantic_model": AgentPolicyConfig(
            allowed_callers=["sttm_builder"],
            allowed_operations=["sttm.chat", "sttm.auto_map", "sttm.transform"],
            allowed_downstream_agents=[],
            allowed_tools=[],
            allowed_data_classes=["governed_structured_data"],
            output_contract="sttm_envelope",
            approval_triggers=[],
        ),
        "source_mapping": AgentPolicyConfig(
            allowed_callers=["sttm_builder"],
            allowed_operations=["sttm.auto_map", "sttm.chat"],
            allowed_downstream_agents=[],
            allowed_tools=["sttm_subagent"],
            allowed_data_classes=["governed_structured_data"],
            output_contract="sttm_envelope",
            approval_triggers=["low_confidence_mapping"],
        ),
        "transformation_rule": AgentPolicyConfig(
            allowed_callers=["sttm_builder"],
            allowed_operations=["sttm.transform", "sttm.chat"],
            allowed_downstream_agents=[],
            allowed_tools=["sttm_subagent"],
            allowed_data_classes=["governed_structured_data"],
            output_contract="sttm_envelope",
            approval_triggers=["unsafe_sql"],
        ),
        "analyst": AgentPolicyConfig(
            allowed_callers=["sttm_builder"],
            allowed_operations=["sttm.chat"],
            allowed_downstream_agents=[],
            allowed_tools=["analyst"],
            allowed_data_classes=["governed_structured_data"],
            output_contract="sttm_envelope",
            approval_triggers=["derived_sql", "unsafe_sql"],
        ),
    }


def _default_rag_sources() -> dict[str, RagSourceConfig]:
    return {
        "semantic_context": RagSourceConfig(
            enabled=True,
            max_chunks=6,
            allowed_context_keys=["semantic_context", "datahub_context", "relationships", "selected_columns_by_table"],
        ),
    }


def build_default_config(settings: Settings | None = None) -> GuardrailsConfig:
    return GuardrailsConfig(
        client_id="bbi-mig-ai-workbench",
        enabled=True if settings is None else settings.guardrails_enabled,
        snowflake=SnowflakeGuardrailsConfig(
            account_level_guardrails=True,
            masking_policy_tag="sensitivity",
            row_access_enabled=True,
        ),
        personas=_default_personas(),
        routes=_default_routes(),
        agents=_default_agents(),
        rag_sources=_default_rag_sources(),
        intent=IntentPolicyConfig(),
        recommendation_policy=RecommendationPolicyConfig(),
        feedback_policy=FeedbackPolicyConfig(),
        approval_policy=ApprovalPolicyConfig(),
        toxicity_policy=ToxicityPolicyConfig(),
        grounding_policy=GroundingPolicyConfig(),
        managed_safety=ManagedSafetyConfig(),
        redaction=RedactionConfig(
            engine="presidio" if settings and settings.guardrails_presidio_enabled else "internal"
        ),
        output=OutputConfig(reject_if_contains_raw_pii=settings.guardrails_reject_raw_pii if settings else False),
        audit=AuditConfig(backend="logger", async_enabled=True),
    )


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except ImportError as exc:
        raise RuntimeError("YAML config loading requires PyYAML to be installed.") from exc

    loaded = yaml.safe_load(path.read_text())
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected a mapping in {path}")
    return loaded


def load_config(
    source: str | Path | dict[str, Any] | GuardrailsConfig | None = None,
    *,
    settings: Settings | None = None,
) -> GuardrailsConfig:
    if source is None:
        return build_default_config(settings)

    if isinstance(source, GuardrailsConfig):
        return source

    if isinstance(source, dict):
        return GuardrailsConfig.model_validate(source)

    path = Path(source)
    suffix = path.suffix.lower()
    if suffix == ".json":
        payload = json.loads(path.read_text())
    elif suffix in {".yaml", ".yml"}:
        payload = _load_yaml(path)
    else:
        raise ValueError(f"Unsupported guardrails config format: {path.suffix}")

    return GuardrailsConfig.model_validate(payload)
