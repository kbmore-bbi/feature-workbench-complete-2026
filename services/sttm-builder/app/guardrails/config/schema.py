from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SnowflakeGuardrailsConfig(BaseModel):
    account_level_guardrails: bool = True
    masking_policy_tag: str = "sensitivity"
    row_access_enabled: bool = True


class PersonaPolicyConfig(BaseModel):
    allowed_operations: list[str] = Field(default_factory=list)
    allow_sample_rows: bool = False
    allow_raw_pii: bool = False


class RoutePolicyConfig(BaseModel):
    allowed_operations: list[str] = Field(default_factory=list)
    default_agent: str | None = None


class AgentPolicyConfig(BaseModel):
    allowed_callers: list[str] = Field(default_factory=list)
    allowed_operations: list[str] = Field(default_factory=list)
    allowed_downstream_agents: list[str] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list)
    allowed_data_classes: list[str] = Field(default_factory=list)
    output_contract: str = "standard_envelope"
    approval_triggers: list[str] = Field(default_factory=list)


class RagSourceConfig(BaseModel):
    enabled: bool = True
    trust_label: Literal["retrieved_untrusted"] = "retrieved_untrusted"
    max_chunks: int = 6
    allowed_context_keys: list[str] = Field(default_factory=list)


class RecommendationPolicyConfig(BaseModel):
    require_citations: bool = True
    approval_on_low_evidence: bool = True


class FeedbackPolicyConfig(BaseModel):
    allowed_categories: list[str] = Field(
        default_factory=lambda: ["general", "recommendation", "agent_quality", "ui_feedback"]
    )
    min_rating: int = 1
    max_rating: int = 5


class ApprovalPolicyConfig(BaseModel):
    high_risk_only: bool = True
    triggers: list[str] = Field(
        default_factory=lambda: [
            "derived_sql",
            "unsafe_sql",
            "low_confidence_mapping",
            "insufficient_evidence",
            "suspected_hallucination",
            "policy_downgrade",
            "cross_domain_recommendation",
        ]
    )


class ToxicityPolicyConfig(BaseModel):
    enabled: bool = True
    block_terms: list[str] = Field(
        default_factory=lambda: [
            "kill yourself",
            "hate you",
            "racial slur",
            "sexually explicit minor",
        ]
    )
    rewrite_on_match: bool = True


class GroundingPolicyConfig(BaseModel):
    require_citations_for: list[str] = Field(
        default_factory=lambda: ["conversation.recommend", "conversation.ask"]
    )
    allow_best_effort_without_citations: bool = False


class ManagedSafetyConfig(BaseModel):
    content_safety_provider: Literal["none", "azure"] = "none"
    prompt_shields_enabled: bool = False
    groundedness_enabled: bool = False
    text_moderation_enabled: bool = False


class IntentPolicyConfig(BaseModel):
    sttm_keywords: list[str] = Field(
        default_factory=lambda: [
            "map",
            "mapping",
            "remap",
            "source column",
            "target attribute",
            "transform",
            "transformation",
            "derived source",
            "semantic view",
            "sql",
            "join",
            "relationship",
        ]
    )
    recommendation_keywords: list[str] = Field(
        default_factory=lambda: [
            "recommend",
            "suggest",
            "best option",
            "what should i do",
            "next step",
        ]
    )
    feedback_keywords: list[str] = Field(
        default_factory=lambda: ["feedback", "review", "rating", "thumbs up", "thumbs down"]
    )


class RedactionConfig(BaseModel):
    engine: Literal["internal", "presidio"] = "internal"
    pii_types: list[str] = Field(
        default_factory=lambda: ["EMAIL", "PHONE", "SSN", "CREDIT_CARD"]
    )
    on_detection: Literal["mask", "tokenize", "suppress", "warn"] = "mask"


class OutputConfig(BaseModel):
    require_human_approval_for: list[str] = Field(
        default_factory=lambda: ["mapping", "derived_source", "low_confidence"]
    )
    reject_if_contains_raw_pii: bool = False
    reject_sql_patterns: list[str] = Field(
        default_factory=lambda: [
            "DROP",
            "DELETE",
            "INSERT",
            "UPDATE",
            "CREATE",
            "ALTER",
            "TRUNCATE",
            "MERGE",
            "COPY",
            "PUT",
            "REMOVE",
        ]
    )


class AuditConfig(BaseModel):
    backend: Literal["logger", "snowflake"] = "logger"
    async_enabled: bool = True


class GuardrailsConfig(BaseModel):
    client_id: str
    enabled: bool = True
    snowflake: SnowflakeGuardrailsConfig = Field(default_factory=SnowflakeGuardrailsConfig)
    personas: dict[str, PersonaPolicyConfig] = Field(default_factory=dict)
    routes: dict[str, RoutePolicyConfig] = Field(default_factory=dict)
    agents: dict[str, AgentPolicyConfig] = Field(default_factory=dict)
    rag_sources: dict[str, RagSourceConfig] = Field(default_factory=dict)
    intent: IntentPolicyConfig = Field(default_factory=IntentPolicyConfig)
    recommendation_policy: RecommendationPolicyConfig = Field(default_factory=RecommendationPolicyConfig)
    feedback_policy: FeedbackPolicyConfig = Field(default_factory=FeedbackPolicyConfig)
    approval_policy: ApprovalPolicyConfig = Field(default_factory=ApprovalPolicyConfig)
    toxicity_policy: ToxicityPolicyConfig = Field(default_factory=ToxicityPolicyConfig)
    grounding_policy: GroundingPolicyConfig = Field(default_factory=GroundingPolicyConfig)
    managed_safety: ManagedSafetyConfig = Field(default_factory=ManagedSafetyConfig)
    redaction: RedactionConfig = Field(default_factory=RedactionConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    audit: AuditConfig = Field(default_factory=AuditConfig)
