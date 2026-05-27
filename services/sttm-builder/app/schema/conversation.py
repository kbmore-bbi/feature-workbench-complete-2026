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


class ConversationContext(OperationContext):
    surface: str | None = None
    semantic_level_requested: str | None = None
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
    include_recommendation_docs: bool = True
    include_semantic_docs: bool = True
    include_relationship_docs: bool = True


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
    recommendation_count: int
    relationship_fact_count: int
    rag_document_count: int
    search_service: str
