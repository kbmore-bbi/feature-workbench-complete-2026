from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schema.contracts import CONTRACT_VERSION, ApiActor, ApiError, ApiWarning, OperationContext
from app.schema.common import TableRef
from app.schema.sttm_builder import STTMBuilderEnvelopeRequest


class ConversationOperation(str, Enum):
    ASK = "conversation.ask"
    RECOMMEND = "conversation.recommend"
    FEEDBACK = "conversation.feedback"
    HANDOFF_STTM = "conversation.handoff.sttm"
    SETTINGS_GET = "conversation.settings.get"
    SETTINGS_UPDATE = "conversation.settings.update"
    SIGNALS_LIST = "conversation.signals.list"
    SIGNALS_EVALUATE = "conversation.signals.evaluate"
    SIGNALS_RESPOND = "conversation.signals.respond"


class ConversationIntentClass(str, Enum):
    QUICK_ANSWER = "quick_answer"
    RECOMMENDATION = "recommendation"
    RAG_LOOKUP = "rag_lookup"
    FEEDBACK_CAPTURE = "feedback_capture"
    STTM_HANDOFF = "sttm_handoff"
    CLARIFICATION = "clarification"


class ConversationRoute(str, Enum):
    CONVERSATION = "conversation"
    STTM_BUILDER = "sttm_builder"
    DIRECT_REFUSAL = "direct_refusal"
    APPROVAL_REQUIRED = "approval_required"


class ConversationStatus(str, Enum):
    COMPLETED = "completed"
    NEEDS_INPUT = "needs_input"
    FAILED = "failed"
    APPROVAL_REQUIRED = "approval_required"


class FeedbackInput(BaseModel):
    category: str = "general"
    rating: int | None = None
    comment: str | None = None
    target_request_id: str | None = None
    signal_id: str | None = None
    feedback_type: str = "agent_quality"
    option_selected: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    selection_context: dict[str, Any] | None = None


class EvidenceCitation(BaseModel):
    source_id: str
    source_type: str
    snippet: str | None = None
    score: float | None = None


class ConversationArtifact(BaseModel):
    source_ids: list[str] = Field(default_factory=list)
    quick_replies: list[str] = Field(default_factory=list)
    review_recorded: bool = False
    handoff_operation: str | None = None
    handoff_request_id: str | None = None
    handoff_summary: str | None = None
    raw_feedback: dict[str, Any] | None = None
    conversation_id: str | None = None
    turn_ids: list[str] = Field(default_factory=list)
    route_reason: str | None = None
    route_confidence: float | None = None
    suggested_operation: str | None = None
    feedback_requested: bool = False
    signal_id: str | None = None


class AssistantPreferenceState(BaseModel):
    feedback_enabled: bool = True
    recommendations_enabled: bool = True


class MappingIntent(BaseModel):
    business_goal: str | None = None
    lifecycle: Literal["new", "update", "unknown"] = "unknown"
    target_outcome: str | None = None
    domain_hints: list[str] = Field(default_factory=list)
    source: str = "user"
    confidence: float | None = None
    updated_at: str | None = None


class AssistantSignalType(str, Enum):
    FEEDBACK = "feedback"
    RECOMMENDATION = "recommendation"


class AssistantSignalStatus(str, Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    RESPONDED = "responded"
    DISMISSED = "dismissed"


class AssistantSignal(BaseModel):
    signal_id: str
    signal_type: AssistantSignalType
    layer: Literal["feedback", "inference", "recommendation"]
    status: AssistantSignalStatus
    source: str
    title: str
    message: str
    options: list[str] = Field(default_factory=list)
    allow_free_text: bool = False
    requires_response: bool = False
    confidence: float | None = None
    entity_type: str | None = None
    entity_ids: list[str] = Field(default_factory=list)
    inference_id: str | None = None
    recommendation_id: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None


class AssistantInferenceRecord(BaseModel):
    inference_id: str
    inference_type: str
    summary: str
    confidence: float | None = None
    source: str
    entity_type: str | None = None
    entity_ids: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)


class AssistantSettingsUpdateData(BaseModel):
    feedback_enabled: bool
    recommendations_enabled: bool


class ConversationSettingsResponseData(BaseModel):
    settings: AssistantPreferenceState


class ConversationSignalEvaluationData(BaseModel):
    activity_type: str = "selection_changed"
    page: str | None = None
    session_id: str | None = None
    source_tables: list[TableRef] = Field(default_factory=list)
    target_table: TableRef | None = None
    driving_table: TableRef | None = None
    relationships: list[dict[str, Any]] = Field(default_factory=list)
    selected_columns_by_table: dict[str, list[str]] | None = None
    selected_derived_sources: list[str] = Field(default_factory=list)
    semantic_bundle_id: str | None = None
    semantic_bundle_label: str | None = None
    semantic_view_name: str | None = None
    surface: str | None = None
    mapping_summary: dict[str, Any] | None = None
    mapping_intent: MappingIntent | None = None


class ConversationSignalsResponseData(BaseModel):
    settings: AssistantPreferenceState
    signals: list[AssistantSignal] = Field(default_factory=list)
    inferences: list[AssistantInferenceRecord] = Field(default_factory=list)
    unread_count: int = 0
    mapping_intent: MappingIntent | None = None


class AssistantSignalResponseData(BaseModel):
    signal_id: str
    status: AssistantSignalStatus
    feedback_recorded: bool = False


class AssistantSignalResponseInput(BaseModel):
    signal_id: str
    status: Literal["acknowledged", "responded", "dismissed"] = "responded"
    option_selected: str | None = None
    comment: str | None = None
    rating: int | None = None
    feedback_type: str = "business_context"


class ConversationContext(OperationContext):
    surface: str | None = None
    semantic_level_requested: str | None = None
    session_id: str | None = None
    source_tables: list[TableRef] | None = None
    driving_table: TableRef | None = None
    target_table: TableRef | None = None
    selected_derived_sources: list[str] | None = None
    semantic_bundle_id: str | None = None
    semantic_bundle_label: str | None = None
    semantic_view_name: str | None = None
    derived_source_lineage: list[dict[str, Any]] | None = None
    semantic_context: list[dict[str, Any]] | None = None
    relationships: list[dict[str, Any]] | None = None
    selected_columns_by_table: dict[str, list[str]] | None = None
    datahub_context: dict[str, Any] | None = None
    mapping_intent: MappingIntent | None = None


class ConversationRequestData(BaseModel):
    message: str | None = None
    intent_class: ConversationIntentClass | None = None
    requested_sources: list[str] = Field(default_factory=list)
    feedback: FeedbackInput | None = None
    handoff_request: STTMBuilderEnvelopeRequest | None = None


class ConversationRequestEnvelope(BaseModel):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: ConversationOperation
    actor: ApiActor | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)
    data: ConversationRequestData
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_required_fields(self) -> "ConversationRequestEnvelope":
        if self.operation in {ConversationOperation.ASK, ConversationOperation.RECOMMEND} and not self.data.message:
            raise ValueError("conversation ask/recommend requests require a non-empty message")
        if self.operation == ConversationOperation.FEEDBACK and self.data.feedback is None:
            raise ValueError("conversation.feedback requires feedback")
        if self.operation == ConversationOperation.HANDOFF_STTM and self.data.handoff_request is None:
            raise ValueError("conversation.handoff.sttm requires handoff_request")
        return self


class ConversationResponseData(BaseModel):
    status: ConversationStatus
    route: ConversationRoute
    intent_class: ConversationIntentClass
    agent: str | None = None
    message: str | None = None
    approval_required: bool = False
    artifact: ConversationArtifact = Field(default_factory=ConversationArtifact)
    citations: list[EvidenceCitation] = Field(default_factory=list)


class ConversationSearchRequestData(BaseModel):
    query: str
    folders: list[str] = Field(default_factory=list)
    limit: int = Field(default=5, ge=1, le=20)
    semantic_bundle_id: str | None = None
    semantic_view_name: str | None = None


class ConversationSearchRequestEnvelope(BaseModel):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: Literal["conversation.search"]
    actor: ApiActor | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)
    data: ConversationSearchRequestData
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ConversationSearchHit(BaseModel):
    doc_id: str
    doc_folder: str
    doc_type: str
    title: str | None = None
    snippet: str | None = None
    semantic_bundle_id: str | None = None
    semantic_view_name: str | None = None
    score: float | None = None


class ConversationSearchResponseData(BaseModel):
    hits: list[ConversationSearchHit] = Field(default_factory=list)
    search_service: str | None = None
    source_table: str | None = None


class ConversationIndexSyncRequestData(BaseModel):
    rebuild_search_service: bool = False
    include_conversation_docs: bool = True
    include_feedback_docs: bool = True
    include_inference_docs: bool = True
    include_recommendation_docs: bool = True
    include_semantic_docs: bool = True
    include_relationship_docs: bool = True
    include_client_knowledge_docs: bool = True


class ConversationIndexSyncRequestEnvelope(BaseModel):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: Literal["conversation.index.sync"]
    actor: ApiActor | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)
    data: ConversationIndexSyncRequestData = Field(default_factory=ConversationIndexSyncRequestData)
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ConversationIndexSyncResponseData(BaseModel):
    conversation_turn_count: int
    feedback_count: int
    inference_count: int
    recommendation_count: int
    relationship_fact_count: int
    rag_document_count: int
    search_service: str


class ConversationSettingsRequestEnvelope(BaseModel):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: Literal["conversation.settings.get", "conversation.settings.update"]
    actor: ApiActor | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)
    data: AssistantSettingsUpdateData | dict[str, Any] | None = None
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ConversationSignalsListRequestEnvelope(BaseModel):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: Literal["conversation.signals.list"]
    actor: ApiActor | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)
    data: dict[str, Any] = Field(default_factory=dict)
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ConversationSignalsEvaluateRequestEnvelope(BaseModel):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: Literal["conversation.signals.evaluate"]
    actor: ApiActor | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)
    data: ConversationSignalEvaluationData = Field(default_factory=ConversationSignalEvaluationData)
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ConversationSignalsRespondRequestEnvelope(BaseModel):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: Literal["conversation.signals.respond"]
    actor: ApiActor | None = None
    context: ConversationContext = Field(default_factory=ConversationContext)
    data: AssistantSignalResponseInput
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
