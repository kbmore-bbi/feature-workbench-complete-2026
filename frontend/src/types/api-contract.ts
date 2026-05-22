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
