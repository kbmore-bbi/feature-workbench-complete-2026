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

export type RelationNode = {
  relation_id: string;
  kind: "PHYSICAL_TABLE" | "DERIVED_SOURCE" | "CTE";
  alias: string;
  table?: TableRef | null;
  derived_source_id?: string | null;
  physical_view_name?: string | null;
  sql_text?: string | null;
  output_columns?: Array<Record<string, unknown>>;
  column_semantics?: Array<Record<string, unknown>>;
  grain?: string | null;
  keys?: string[];
  dependency_hash?: string | null;
  parent_relation_ids?: string[];
};

export type RelationEdge = {
  edge_id: string;
  left_relation_id: string;
  right_relation_id: string;
  join_type?: string;
  conditions?: RelationshipContextItem["conditions"];
  additional_predicate?: string | null;
  provenance?: string | null;
  validation_status?: string | null;
};

export type RelationGraphContext = {
  nodes: RelationNode[];
  edges: RelationEdge[];
  value_bindings: Array<{
    binding_id: string;
    value: string;
    resolved_value?: string | null;
    data_type?: string | null;
    is_placeholder?: boolean;
    allow_project_specific_value?: boolean;
    resolution_status?: string;
  }>;
};

export type STTMIntent = "AUTO_MAP" | "CHAT" | "TRANSFORM";
export type STTMOperation = "sttm.auto_map" | "sttm.chat" | "sttm.transform";
export type STTMStatus = "completed" | "needs_input" | "failed";
export type STTMAgent = "SOURCE_MAPPING_AGENT" | "TRANSFORMATION_AGENT";
export type SemanticSurface = "SOURCE_SELECTION" | "DERIVED_SOURCE" | "MAPPING";
export type SemanticLevel =
  | "FULL_REGISTRY"  // Recommended default - full semantic views with reading instructions
  | "L0_RELATIONSHIP"  // Deprecated
  | "L1_CONTEXT"  // Deprecated
  | "L2_ANALYST_READY"  // Deprecated
  | "L3_MAPPING_ENRICHED";  // Deprecated
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
  semantic_model_yaml?: string | null;
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
  semantic_model_yaml?: string | null;
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
  logical_conversation_id?: string | null;
  physical_thread_segment?: number | null;
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
  semantic_bundle_hash?: string | null;
  learning_context_id?: string | null;
  learning_context_hash?: string | null;
  artifact_refs?: Array<Record<string, unknown>> | null;
  semantic_bundle_label?: string | null;
  semantic_view_name?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>> | null;
  datahub_context?: Record<string, unknown> | null;
  mapping_intent?: MappingIntent | null;
  project_id?: string | null;
  sttm_id?: string | null;
  workspace_context?: WorkbenchContextSnapshotV2 | null;
  relation_graph?: RelationGraphContext | null;
  prepared_context_hash?: string | null;
};

export type WorkbenchContextSnapshotV2 = {
  context_version: "2.0";
  context_hash: string;
  context_key: string;
  snapshot_id?: string | null;
  captured_at: string;
  page: string;
  surface: string;
  action?: string | null;
  milestone?: string | null;
  checkpoint?: string | null;
  scope_type?: "project" | "schema" | "table" | "table_set" | "target" | "mapping" | "column" | "derived_source" | null;
  scope_key?: string;
  candidate_action?: string | null;
  browsing_context?: {
    side?: "source" | "target" | null;
    database?: string | null;
    schema?: string | null;
    visible_candidate_tables?: string[];
    search_text?: string | null;
  } | null;
  session_id?: string | null;
  thread_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  project_description?: string | null;
  project_domain?: string | null;
  project_outcome?: string | null;
  sttm_id?: string | null;
  sttm_name?: string | null;
  sttm_description?: string | null;
  mapping_lifecycle?: string | null;
  business_goal?: string | null;
  source_tables: TableRef[];
  target_table?: TableRef | null;
  driving_table?: TableRef | null;
  selected_columns_by_table: Record<string, string[]>;
  derived_sources: Array<{
    id: string;
    name?: string | null;
    sql_hash?: string | null;
    sql_text?: string | null;
    physical_view_name?: string | null;
    generated_by_request_id?: string | null;
    semantic_bundle_id?: string | null;
    semantic_bundle_label?: string | null;
    semantic_view_name?: string | null;
    semantic_level?: string | null;
    upstream_hash?: string | null;
    source_dependency_hash?: string | null;
    purpose?: string | null;
    business_description?: string | null;
    grain?: string | null;
    keys?: string[];
    output_columns?: Array<Record<string, unknown>>;
    column_semantics?: Array<Record<string, unknown>>;
    semantic_projection?: Record<string, unknown>;
    semantic_quality?: string | null;
    lineage_depth?: number;
    base_source_tables?: TableRef[];
    table_ids?: string[];
    alias?: string | null;
    columns?: Array<unknown>;
    joins?: Array<Record<string, unknown>>;
    filters?: Array<Record<string, unknown>>;
    selected_columns_by_table?: Record<string, string[]>;
    lineage?: Array<Record<string, unknown>>;
  }>;
  relation_graph?: RelationGraphContext | null;
  relationships: RelationshipContextItem[];
  filters: {
    filter_sql?: string | null;
    base_query_sql?: string | null;
    group_by_sql?: string | null;
    order_by_sql?: string | null;
    groups?: Array<Record<string, unknown>>;
  };
  mapping_sql?: string | null;
  mapping_preview_sql?: string | null;
  compiled_mapping_sql?: string | null;
  compiled_mapping_preview_sql?: string | null;
  compiled_mapping_context_hash?: string | null;
  semantic: {
    bundle_id?: string | null;
    bundle_hash?: string | null;
    bundle_label?: string | null;
    level?: string | null;
    status?: string | null;
    view_name?: string | null;
    composed_model_hash?: string | null;
    asset_versions?: Record<string, string>;
  };
  semantic_bundle?: {
    bundle_id?: string | null;
    bundle_hash?: string | null;
    bundle_label?: string | null;
    semantic_view_name?: string | null;
    level?: string | null;
    status?: string | null;
    source_tables?: TableRef[];
    target_table?: TableRef | null;
    driving_table?: TableRef | null;
    derived_source_ids?: string[];
    relationship_hash?: string | null;
    asset_versions?: Record<string, string>;
    composed_model_hash?: string | null;
  } | null;
  mapping_intent?: MappingIntent | null;
  mapping_rows?: Array<Record<string, unknown>>;
  checked_mapping_row_ids?: string[];
  active_mapping_row_id?: string | null;
  mapping_artifacts?: Array<Record<string, unknown>>;
  validation_history?: Array<Record<string, unknown>>;
  conversation_history?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  source_set_hash?: string;
  derived_set_hash?: string;
};

/** Transitional name retained for call sites and WebSocket clients during the V2 rollout. */
export type WorkbenchContextSnapshotV1 = WorkbenchContextSnapshotV2;

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
  used_inference_ids?: string[];
  used_recommendation_ids?: string[];
  used_learning_ids?: string[];
  mapping_mode?: "source" | "constant" | "attribute";
  constant_value?: string | null;
  attribute_name?: string | null;
  source_dependencies?: string[];
  value_binding_ids?: string[];
  transformation_classification?: "value" | "direct" | "reused" | "simple_multi_source" | "complex" | "unresolved" | null;
  precedent_decision?: "accept_precedent" | "override_precedent" | "unresolved" | null;
  pattern_decision?: "accept_exact_precedent" | "adapt_pattern" | "override_pattern" | "unresolved" | null;
  precedent_mapping_id?: string | null;
  override_evidence?: string[];
};

export type SourceMappingResult = {
  mappings: Record<string, AttributeMapping>;
};

export type AutoMappingReviewRecommendation = {
  target_attribute: string;
  category: "missing_derived_output" | "unresolved_mapping" | "low_confidence" | "precedent_override";
  severity: "action_required" | "review";
  title: string;
  detail: string;
  recommended_action: string;
  candidate_sources: string[];
  evidence_ids: string[];
};

export type AutoMappingReview = {
  headline: string;
  total_count: number;
  mapped_count: number;
  unresolved_count: number;
  low_confidence_count: number;
  precedent_override_count: number;
  missing_derived_output_count: number;
  completed_without_review_count?: number;
  mapped_with_review_count?: number;
  action_required_count?: number;
  recommendations: AutoMappingReviewRecommendation[];
};

export type TransformationRule = {
  target_attribute: string;
  rule: string;
  description?: string | null;
  used_inference_ids?: string[];
  used_recommendation_ids?: string[];
  learning_evidence?: string[];
  pattern_decision?: "accept_exact_precedent" | "adapt_pattern" | "override_pattern" | "unresolved" | null;
  precedent_decision?: "accept_precedent" | "override_precedent" | "unresolved" | null;
  source_dependencies?: string[];
  value_binding_ids?: string[];
  override_evidence?: string[];
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

export type FIRRecommendationAction = {
  id: string;
  label: string;
  action:
    | "select_table"
    | "preview_join"
    | "draft_derived_source"
    | "preview_filter"
    | "open_mapping_precedent"
    | "open_assistant_explanation"
    | "confirm"
    | "correct"
    | "dismiss"
    | string;
  payload?: Record<string, unknown>;
  requires_confirmation?: boolean;
  requires_comment?: boolean;
};

export type FIRRecommendationEvidence = {
  evidence_id: string;
  source_type?: string | null;
  title: string;
  summary: string;
  redacted_excerpt?: string | null;
  document_location?: string | null;
  polarity?: string | null;
  evidence_weight?: number | null;
};

export type FIRRecommendation = {
  recommendation_id: string;
  title?: string | null;
  fir_record_id?: string | null;
  fir_inference_id?: string | null;
  recommendation_type?: string | null;
  recommendation_category?: string | null;
  recommendation_priority?: number | null;
  confidence?: number | null;
  display_message: string;
  current_understanding?: string | null;
  topic?: string | null;
  entity_label?: string | null;
  reason_now?: string | null;
  display_rank?: number | null;
  urgency?: "low" | "normal" | "high" | "critical" | string;
  blocking?: boolean;
  checkpoint?: string | null;
  question_id?: string | null;
  retrieval_mode?: "exact_context" | "exact_scope" | "structured" | "project" | "similar_context" | string;
  scope_type?: string | null;
  scope_key?: string | null;
  group_key?: string | null;
  content_version?: number;
  evidence_summary?: string | null;
  evidence?: FIRRecommendationEvidence[];
  actions: FIRRecommendationAction[];
  agent_payload?: Record<string, unknown>;
};

export type FIRRecommendationEvaluationResponse = {
  checkpoint?: string | null;
  context_key: string;
  scope_key: string;
  primary_question?: FIRRecommendation | null;
  items: FIRRecommendation[];
  total: number;
  retrieval_mode?: string | null;
};

export type MappingSqlMappingItem = {
  target_column: string;
  target_type?: string | null;
  source_column?: string | null;
  source_columns?: string[];
  mapping_mode?: "source" | "constant" | "attribute";
  constant_value?: string | null;
  attribute_name?: string | null;
  expression?: string | null;
  rule?: string | null;
  status?: string | null;
  nl_rule?: string | null;
  description?: string | null;
  source_dependencies?: string[];
  value_binding_ids?: string[];
  precedent_decision?: string | null;
  precedent_mapping_id?: string | null;
};

export type MappingSqlCompileRequest = {
  relation_graph: RelationGraphContext;
  mappings: MappingSqlMappingItem[];
  target_table?: TableRef | null;
  driving_relation_id?: string | null;
  where_predicates?: string[];
  group_by_expressions?: string[];
  qualify_predicates?: string[];
  order_by_expressions?: string[];
  self_contained_derived?: boolean;
  validate_with_explain?: boolean;
  allow_unresolved_placeholders?: boolean;
  accepted_precedent_sttm_id?: string | null;
};

export type MappingSqlCompileResponse = {
  valid: boolean;
  ready: boolean;
  preview_sql: string;
  generated_sql: string;
  relation_aliases: Record<string, string>;
  required_relation_ids: string[];
  unresolved_placeholders: string[];
  warnings: string[];
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
  semantic_model_yaml?: string | null;
  relation_graph?: RelationGraphContext | null;
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
  validation_error?: string | null;
  review_kind?: "none" | "optimization" | "repair";
  optimized: boolean;
  requires_approval: boolean;
  original_preview_sql: string;
  original_generated_sql: string;
  optimized_preview_sql?: string | null;
  optimized_generated_sql?: string | null;
  semantic_view_name?: string | null;
  warnings: string[];
  repair_options?: Array<{
    code: "apply_suggested_sql" | "resolve_value_binding" | "verify_source_contract" | "edit_sql";
    title: string;
    description: string;
    action: "review_suggested_sql" | "open_mapping" | "edit_sql";
    identifier?: string | null;
  }>;
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

export type MappingSqlParseRequest = {
  sql: string;
  current_workspace?: Record<string, unknown>;
  known_tables?: TableRef[];
};

export type MappingSqlParseResponse = {
  valid: boolean;
  parsed_workspace: {
    source_tables?: string[];
    target_table?: string | null;
    mapping_rows?: Array<Record<string, unknown>>;
    relationships?: Array<Record<string, unknown>>;
    filters?: Array<Record<string, unknown>>;
    ctes?: Array<Record<string, unknown>>;
    derived_sources?: Array<Record<string, unknown>>;
    business_rules?: Array<Record<string, unknown>>;
    transformations?: string[];
    sql?: string;
  };
  diff: Record<string, unknown[]>;
  warnings: string[];
  unresolved_references: string[];
  ambiguous_references: Record<string, string[]>;
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

export type TestCaseDerivedBaseSource = {
  table: TableRef;
  attribute_semantic_model?: Array<Record<string, unknown>>;
};

export type TestCaseDerivedSourceItem = {
  derived_source_name: string;
  sql_text?: string | null;
  semantic_view_name?: string | null;
  base_sources?: TestCaseDerivedBaseSource[];
};

export type TestCaseGenerationRequest = {
  project_id?: string | null;
  sttm_id?: string | null;
  project_name?: string | null;
  domain_name?: string | null;
  target_layer?: "raw" | "curated" | "mart" | string | null;
  materialization?: "incremental" | "table" | "view" | string | null;
  source_tables: TableRef[];
  target_table: TableRef;
  relationships?: RelationshipContextItem[];
  validated_sql: string;
  mappings?: MappingSqlMappingItem[];
  semantic_context?: SemanticContextItem[];
  derived_sources?: TestCaseDerivedSourceItem[];
};

export type TestCaseGroup = {
  group: string;
  target_columns: string[];
};

export type TestCaseSeedFile = {
  file_path: string;
  file_type: string;
  content: string;
};

export type TestCaseDocumentItem = {
  test_case_id: string;
  group: string;
  target_attribute: string;
  source_columns: string;
  mapping_rule: string;
  test_case_description: string;
  test_type: string;
  sample_source_input: string;
  expected_target_value: string;
  confidence?: string | null;
};

export type TestCaseGenerationResponse = {
  status: "completed" | "failed" | string;
  domain_name?: string | null;
  target_layer?: string | null;
  materialization?: string | null;
  target_model?: string | null;
  target_table?: string | null;
  test_groups: TestCaseGroup[];
  seed_files: TestCaseSeedFile[];
  test_case_document: TestCaseDocumentItem[];
  agent_name: string;
  retrieved_inference_ids?: string[];
  retrieved_recommendation_ids?: string[];
  used_inference_ids?: string[];
  used_recommendation_ids?: string[];
};

export type WorkbookTestCaseGenerationPayload = Pick<
  TestCaseGenerationResponse,
  | "status"
  | "domain_name"
  | "target_layer"
  | "materialization"
  | "target_model"
  | "target_table"
  | "test_groups"
  | "seed_files"
  | "test_case_document"
>;

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
  test_case_generation?: WorkbookTestCaseGenerationPayload | null;
  mappings?: MappingSqlMappingItem[];
};

export type DbtConversionRequest = {
  project_id?: string | null;
  sttm_id?: string | null;
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
  retrieved_inference_ids?: string[];
  retrieved_recommendation_ids?: string[];
  used_inference_ids?: string[];
  used_recommendation_ids?: string[];
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
