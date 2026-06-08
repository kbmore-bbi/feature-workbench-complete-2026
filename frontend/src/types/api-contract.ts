export const API_CONTRACT_VERSION = "1.0" as const;

export type ApiActor = {
  user_id?: string | null;
  role?: string | null;
};

export type ApiWarning = {
  code: string;
  message: string;
  field?: string | null;
};

export type ApiError = {
  type?: string;
  title: string;
  status?: number | null;
  detail?: string | null;
  code?: string | null;
  field?: string | null;
};

export type ApiEnvelope<TContext = Record<string, unknown>, TData = Record<string, unknown>> = {
  contract_version: typeof API_CONTRACT_VERSION;
  request_id?: string | null;
  operation: string;
  actor?: ApiActor | null;
  context: TContext;
  data: TData;
  warnings: ApiWarning[];
  error: ApiError | null;
  meta: Record<string, unknown>;
};

export type TableRef = {
  database: string;
  schema: string;
  table: string;
};

export type AttributeRef = {
  table: TableRef;
  attribute: string;
};

export type RelationshipContextItem = {
  left_table: TableRef;
  right_table: TableRef;
  constraint_name?: string | null;
  join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL" | string;
  source?: "FOREIGN_KEY" | "USER_DEFINED" | string | null;
  locked?: boolean;
  conditions?: Array<{
    left_column: string;
    right_column: string;
    operator?: string;
  }>;
};

export type SemanticContextItem = {
  table: TableRef;
  semantic_model: unknown;
  scope?: string;
};

export type TargetAttributeItem = {
  target_table: TableRef;
  target_attribute: string;
  target_data_type?: string | null;
  target_description?: string | null;
  source_mappings?: AttributeRef[] | null;
};

export type STTMIntent = "AUTO_MAP" | "CHAT" | "TRANSFORM";
export type STTMOperation = "sttm.auto_map" | "sttm.chat" | "sttm.transform";
export type STTMStatus = "completed" | "needs_input" | "failed";
export type STTMAgent = "SOURCE_MAPPING_AGENT" | "TRANSFORMATION_AGENT";
export type SemanticSurface = "SOURCE_SELECTION" | "DERIVED_SOURCE" | "MAPPING";
export type SemanticLevel =
  | "L0_RELATIONSHIP"
  | "L1_CONTEXT"
  | "L2_ANALYST_READY"
  | "L3_MAPPING_ENRICHED";
export type STTMArtifactType =
  | "none"
  | "semantic_context"
  | "analyst_answer"
  | "derived_source_draft"
  | "source_mapping"
  | "transformation_rules";

export type SemanticRefreshStatus = {
  bundle_id: string;
  bundle_hash: string;
  bundle_label?: string | null;
  requested_level: SemanticLevel;
  achieved_level: SemanticLevel;
  status: "ready" | "refreshed" | "promoted" | "partial" | "failed";
  semantic_view_name?: string | null;
  promoted?: boolean;
  cache_hit?: boolean;
  stale_reason?: string | null;
};

export type SemanticContextBundleResponse = {
  bundle_id: string;
  bundle_hash: string;
  bundle_label?: string | null;
  requested_level: SemanticLevel;
  achieved_level: SemanticLevel;
  semantic_view_name?: string | null;
  status: "ready" | "refreshed" | "promoted" | "partial" | "failed";
  promoted?: boolean;
  cache_hit?: boolean;
  summary: Record<string, unknown>;
  lineage?: Array<Record<string, unknown>>;
  semantic_context?: Array<Record<string, unknown>>;
  datahub_context?: Record<string, unknown> | null;
};

export type STTMBuilderContext = {
  thread_id?: string | null;
  parent_message_id?: number | null;
  session_id?: string | null;
  current_role?: string | null;
  current_database?: string | null;
  current_schema?: string | null;
  trace_id?: string | null;
  source_tables?: TableRef[] | null;
  driving_table?: TableRef | null;
  relationships?: RelationshipContextItem[] | null;
  semantic_context?: SemanticContextItem[] | null;
  selected_columns_by_table?: Record<string, string[]> | null;
  surface?: SemanticSurface | null;
  semantic_level_requested?: SemanticLevel | null;
  target_table?: TableRef | null;
  selected_derived_sources?: string[] | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_label?: string | null;
  semantic_view_name?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>> | null;
  datahub_context?: Record<string, unknown> | null;
  mapping_intent?: MappingIntent | null;
};

export type STTMBuilderRequestData = {
  intent: STTMIntent;
  attributes?: TargetAttributeItem[] | null;
  message?: string | null;
};

export type AttributeMapping = {
  source_attributes: string[];
  confidence_score: number;
  confidence_reason?: string | null;
  candidate_source_attributes?: string[];
  unmatched_reason?: string | null;
  preprocessing_rule?: string | null;
  preprocessing_rule_type?: string | null;
  preprocessing_nl_rule?: string | null;
  processing_order?: number | null;
  description?: string | null;
};

export type SourceMappingResult = {
  mappings: Record<string, AttributeMapping>;
};

export type TransformationRule = {
  target_attribute: string;
  rule: string;
  description?: string | null;
};

export type TransformationResult = {
  rules: TransformationRule[];
};

export type STTMBuilderResponseData = {
  intent: STTMIntent;
  status: STTMStatus;
  agent: STTMAgent | null;
  result: SourceMappingResult | TransformationResult | null;
  message?: string | null;
  artifact_type?: STTMArtifactType;
  artifact?: Record<string, unknown> | null;
  semantic_level_achieved?: SemanticLevel | null;
  semantic_refresh_status?: SemanticRefreshStatus | null;
};

export type STTMBuilderEnvelopeRequest = ApiEnvelope<
  STTMBuilderContext,
  STTMBuilderRequestData
> & {
  operation: STTMOperation;
};

export type STTMBuilderEnvelopeResponse = ApiEnvelope<
  STTMBuilderContext,
  STTMBuilderResponseData
> & {
  operation: STTMOperation;
  thread_id: string;
  parent_message_id?: number | null;
  agent: STTMAgent | null;
  result: SourceMappingResult | TransformationResult | null;
  message?: string | null;
};

export type ConversationOperation =
  | "conversation.ask"
  | "conversation.recommend"
  | "conversation.feedback"
  | "conversation.handoff.sttm"
  | "conversation.settings.get"
  | "conversation.settings.update"
  | "conversation.signals.list"
  | "conversation.signals.evaluate"
  | "conversation.signals.respond";

export type ConversationIntentClass =
  | "quick_answer"
  | "recommendation"
  | "rag_lookup"
  | "feedback_capture"
  | "sttm_handoff"
  | "clarification";

export type ConversationRoute =
  | "conversation"
  | "sttm_builder"
  | "direct_refusal"
  | "approval_required";

export type ConversationStatus =
  | "completed"
  | "needs_input"
  | "failed"
  | "approval_required";

export type EvidenceCitation = {
  source_id: string;
  source_type: string;
  snippet?: string | null;
  score?: number | null;
};

export type ConversationArtifact = {
  source_ids?: string[];
  quick_replies?: string[];
  review_recorded?: boolean;
  handoff_operation?: string | null;
  handoff_request_id?: string | null;
  handoff_summary?: string | null;
  raw_feedback?: Record<string, unknown> | null;
  conversation_id?: string | null;
  turn_ids?: string[];
  route_reason?: string | null;
  route_confidence?: number | null;
  suggested_operation?: string | null;
  feedback_requested?: boolean;
  signal_id?: string | null;
};

export type AssistantPreferenceState = {
  feedback_enabled: boolean;
  recommendations_enabled: boolean;
};

export type MappingIntent = {
  business_goal?: string | null;
  lifecycle?: "new" | "update" | "unknown";
  target_outcome?: string | null;
  domain_hints?: string[];
  source?: string;
  confidence?: number | null;
  updated_at?: string | null;
};

export type AssistantSignalType = "feedback" | "recommendation";
export type AssistantSignalStatus = "new" | "acknowledged" | "responded" | "dismissed";

export type AssistantSignal = {
  signal_id: string;
  signal_type: AssistantSignalType;
  layer: "feedback" | "inference" | "recommendation";
  status: AssistantSignalStatus;
  source: string;
  title: string;
  message: string;
  options: string[];
  allow_free_text?: boolean;
  requires_response?: boolean;
  confidence?: number | null;
  entity_type?: string | null;
  entity_ids?: string[];
  inference_id?: string | null;
  recommendation_id?: string | null;
  attributes?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MappingSqlMappingItem = {
  target_column: string;
  target_type?: string | null;
  source_column?: string | null;
  source_columns?: string[];
  expression?: string | null;
  rule?: string | null;
  status?: string | null;
  nl_rule?: string | null;
  description?: string | null;
};

export type MappingSqlReviewRequest = {
  source_tables: TableRef[];
  target_table?: TableRef | null;
  driving_table?: TableRef | null;
  selected_derived_sources?: string[];
  relationships?: RelationshipContextItem[];
  selected_columns_by_table?: Record<string, string[]>;
  semantic_bundle_id?: string | null;
  semantic_bundle_label?: string | null;
  semantic_view_name?: string | null;
  source_query_sql: string;
  preview_sql: string;
  generated_sql: string;
  mappings: MappingSqlMappingItem[];
  preview_limit?: number;
};

export type MappingSqlReviewResponse = {
  valid: boolean;
  review_agent: string;
  syntax_valid: boolean;
  execution_ready: boolean;
  review_summary: string;
  optimized: boolean;
  requires_approval: boolean;
  original_preview_sql: string;
  original_generated_sql: string;
  optimized_preview_sql?: string | null;
  optimized_generated_sql?: string | null;
  semantic_view_name?: string | null;
  warnings: string[];
};

export type MappingSqlPreviewColumn = {
  name: string;
  data_type: string;
};

export type MappingSqlPreviewRow = {
  values: Record<string, unknown>;
};

export type MappingSqlPreviewRequest = MappingSqlReviewRequest & {
  chosen_variant: "original" | "optimized";
  approved_preview_sql?: string | null;
  approved_generated_sql?: string | null;
};

export type MappingSqlPreviewResponse = {
  valid: boolean;
  variant_used: "original" | "optimized";
  executed_preview_sql: string;
  executed_generated_sql: string;
  preview_columns: MappingSqlPreviewColumn[];
  preview_rows: MappingSqlPreviewRow[];
  source_sample_aliases: Record<string, string>;
  source_sample_rows: MappingSqlPreviewRow[];
  semantic_view_name?: string | null;
  warnings: string[];
};

export type WorkbookDerivedSourceItem = {
  derived_source_id: string;
  derived_source_name: string;
  sql_text?: string | null;
  source_tables?: TableRef[];
  base_source_tables?: TableRef[];
  semantic_view_name?: string | null;
  semantic_bundle_label?: string | null;
};

export type WorkbookDbtConversionPayload = {
  status?: string | null;
  action?: string | null;
  message?: string | null;
  materialization?: string | null;
  materialization_reason?: string | null;
  generated_files?: DbtConversionGeneratedFile[];
  schema_files?: DbtConversionGeneratedFile[];
  source_update?: DbtConversionSourceUpdate | null;
};

export type WorkbookExportRequest = {
  project_name?: string | null;
  summary_narrative?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  version_label?: string | null;
  target_table?: TableRef | null;
  source_tables?: TableRef[];
  relationships?: RelationshipContextItem[];
  derived_sources?: WorkbookDerivedSourceItem[];
  filters_sql?: string | null;
  source_query_sql?: string;
  preview_sql?: string;
  generated_sql?: string;
  sql_variant_label?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>>;
  lineage_table_mermaid?: string | null;
  lineage_column_mermaid?: string | null;
  dbt_conversion?: WorkbookDbtConversionPayload | null;
  mappings?: MappingSqlMappingItem[];
};

export type DbtConversionRequest = {
  project_name?: string | null;
  domain_name?: string | null;
  target_layer?: "raw" | "curated" | "mart" | string | null;
  materialization?: "incremental" | "table" | "view" | string | null;
  source_tables: TableRef[];
  target_table: TableRef;
  driving_table?: TableRef | null;
  selected_derived_sources?: string[];
  relationships?: RelationshipContextItem[];
  selected_columns_by_table?: Record<string, string[]>;
  semantic_bundle_id?: string | null;
  semantic_bundle_label?: string | null;
  semantic_view_name?: string | null;
  source_query_sql?: string | null;
  validated_sql: string;
  generated_sql?: string | null;
  mappings: MappingSqlMappingItem[];
  semantic_context?: SemanticContextItem[];
  derived_source_lineage?: Array<Record<string, unknown>>;
  datahub_context?: Record<string, unknown> | null;
  checklist?: string[];
};

export type DbtConversionGeneratedFile = {
  file_name: string;
  file_path: string;
  file_type: string;
  content: string;
  language: "sql" | "yaml" | "text";
};

export type DbtConversionSourceUpdate = {
  file_path: string;
  action: "UPDATE" | "NO_CHANGE" | string;
  content?: string | null;
  language: "yaml" | "text";
};

export type DbtConversionResponse = {
  status: "completed" | "failed" | string;
  action?: "CREATE_NEW" | "UPDATE_EXISTING" | "CREATE_WITH_REFERENCE" | "REUSE_EXISTING" | string | null;
  message?: string | null;
  generated_files: DbtConversionGeneratedFile[];
  source_update?: DbtConversionSourceUpdate | null;
  schema_files: DbtConversionGeneratedFile[];
  macros_used: string[];
  materialization?: string | null;
  materialization_reason?: string | null;
  agent_name: string;
  domain_name?: string | null;
  target_layer?: string | null;
  branch: string;
};

export type AssistantInferenceRecord = {
  inference_id: string;
  inference_type: string;
  summary: string;
  confidence?: number | null;
  source: string;
  entity_type?: string | null;
  entity_ids?: string[];
  attributes?: Record<string, unknown>;
};

export type ConversationRequestData = {
  message?: string | null;
  intent_class?: ConversationIntentClass | null;
  requested_sources?: string[];
  feedback?: {
    category?: string;
    rating?: number | null;
    comment?: string | null;
    target_request_id?: string | null;
  } | null;
};

export type ConversationResponseData = {
  status: ConversationStatus;
  route: ConversationRoute;
  intent_class: ConversationIntentClass;
  agent?: string | null;
  message?: string | null;
  approval_required?: boolean;
  artifact?: ConversationArtifact | null;
  citations?: EvidenceCitation[];
};

export type ConversationSettingsResponseData = {
  settings: AssistantPreferenceState;
};

export type ConversationSignalsResponseData = {
  settings: AssistantPreferenceState;
  signals: AssistantSignal[];
  inferences: AssistantInferenceRecord[];
  unread_count: number;
  mapping_intent?: MappingIntent | null;
};

export type AssistantSignalResponseData = {
  signal_id: string;
  status: AssistantSignalStatus;
  feedback_recorded?: boolean;
};

export type ConversationEnvelopeRequest = ApiEnvelope<
  STTMBuilderContext,
  ConversationRequestData
> & {
  operation: ConversationOperation;
};

export type ConversationEnvelopeResponse = ApiEnvelope<
  STTMBuilderContext,
  ConversationResponseData
> & {
  operation: ConversationOperation;
};
