
import type { UserSession } from "@/types/user";
import type {
  AssistantInferenceRecord,
  AssistantPreferenceState,
  AssistantSignal,
  SemanticContextBundleResponse,
  SemanticContextItem,
  TableRef,
} from "@/types/api-contract";

export interface Sttm {
  id?: string;
  name?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

// -----------------
// Table relationship / filter builder types
// -----------------
export interface Column {
  name?: string;
  type?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  tableId?: string;
  tableName?: string;
  selected?: boolean;
}

export interface TableMeta {
  id?: string;
  name?: string;
  schema?: string;
  database?: string;
  rowCount?: string;
  colCount?: number;
  columns?: Column[];
  tag?: string;
  /** Soft chip background / text (UX-aligned) */
  tagBg?: string;
  tagFg?: string;
}

export interface JoinConfig {
  id?: string;
  joinType?: "INNER" | "LEFT" | "RIGHT" | "FULL";
  leftTableId?: string;
  rightTableId?: string;
  constraintName?: string;
  source?: "FOREIGN_KEY" | "USER_DEFINED";
  locked?: boolean;
  conditions?: {
    leftColumn?: string;
    operator?: string;
    rightColumn?: string;
  }[];
}

/** Hierarchical filter / WHERE builder (`FilterConditions`). */
export type RuleLogic = "AND" | "OR" | "NOT";

export type RuleCondition = {
  id: string;
  type: "condition";
  field: string;
  operator: string;
  value: string;
  valueMode?: "literal" | "field";
  valueField?: string;
  secondaryValue?: string;
  secondaryValueMode?: "literal" | "field";
  secondaryValueField?: string;
};

export type RuleGroup = {
  id: string;
  type: "group";
  logic: RuleLogic;
  children: (RuleGroup | RuleCondition)[];
};

export type RuleNode = RuleGroup | RuleCondition;

export interface DerivedSource {
  id: string;
  sourceName: string;
  isSelected?: boolean;
  derivedSourceIds?: string[];
  parentDerivedSourceIds?: string[];
  sqlText?: string;
  semanticBundleId?: string | null;
  semanticBundleLabel?: string | null;
  semanticViewName?: string | null;
  semanticLevel?: string | null;
  upstreamHash?: string | null;
  lineageDepth?: number;
  alias?: string;
  drivingTableId?: string;
  tableIds?: string[];
  baseSourceTables?: TableRef[];
  selectedColumnsByTable?: Record<string, string[]>;
  joins: {
    id: string;
    joinType: "INNER" | "LEFT" | "RIGHT" | "FULL";
    leftTableId: string;
    rightTableId: string;
    conditions: {
      id: string;
      leftColumn: string;
      operator: string;
      rightColumn: string;
    }[];
  }[];
  filters: RuleGroup[];
  columns: Column[];
  previewColumns?: Array<{
    name: string;
    dataType: string;
    isPrimaryKey?: boolean;
  }>;
  previewRows?: Array<Record<string, unknown>>;
}

// -----------------
// Builder node types (hierarchical: DB → Schema → Table)
// -----------------
export type SelectionSide = "source" | "target";

export type TableNode = {
  tableId: string;
  tableName: string;
  qualifiedName: string;
  isSelected: boolean;
  tag: string;
  rows: string;
  columns: number;
  columnItems?: Column[];
};

export type SchemaNode = {
  schemaId: string;
  schemaName: string;
  isSelected: boolean;
  tables: TableNode[];
  tablesLoaded: boolean;
};

export type DatabaseNode = {
  dbId: string;
  dbName: string;
  dbType: string;
  connectionId: string;
  isSelected: boolean;
  schemas: SchemaNode[];
  schemasLoaded: boolean;
};

export type SourceTargetInfo = {
  dbName: string;
  schemaName: string;
};

export type ColumnGroup = {
  table: string;
  qualifiedName: string;
  columns: Column[];
};

export type MappingSuggestion = {
  targetAttribute: string;
  sourceAttributes: string[];
  confidenceScore: number;
  confidenceReason?: string | null;
  candidateSourceAttributes?: string[];
  unmatchedReason?: string | null;
  preprocessingRule?: string | null;
  preprocessingRuleType?: string | null;
  preprocessingNlRule?: string | null;
  processingOrder?: number | null;
  description?: string | null;
};

export type PendingAiMappingReview = {
  mappingId: string;
  targetColumn: string;
  sourceAttributes: string[];
  confidenceScore: number;
  confidenceReason?: string | null;
  candidateSourceAttributes: string[];
  unmatchedReason?: string | null;
  preprocessingRule?: string | null;
  preprocessingRuleType?: string | null;
  preprocessingNlRule?: string | null;
  processingOrder?: number | null;
  description?: string | null;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  status?: "completed" | "needs_input" | "failed";
  options?: string[];
  isStreaming?: boolean;
  traceSteps?: string[];
  requestId?: string | null;
  conversationId?: string | null;
  feedbackStatus?: "idle" | "sent" | "failed";
  feedbackRating?: number | null;
};

export type AssistantSignalDraft = {
  signalId: string;
  optionSelected?: string | null;
  rating?: number | null;
  comment?: string | null;
};

export type PendingDerivedSourceDraft = {
  sqlText: string;
  sourceNameSuggestion?: string | null;
  semanticViewName?: string | null;
  semanticBundleLabel?: string | null;
  previewRows?: Array<Record<string, unknown>>;
  selectedColumnsByTable?: Record<string, string[]> | null;
  selectedTableIds: string[];
  drivingTableId?: string | null;
  requestSummary?: string | null;
};

export type LoadStatus = "idle" | "loading" | "success" | "error";

export type BuilderLoadState = {
  initial: LoadStatus;
  schemasByDb: Record<string, LoadStatus>;
  tablesBySchema: Record<string, LoadStatus>;
  attributes: LoadStatus;
  relationships: LoadStatus;
  autoMap: LoadStatus;
  chat: LoadStatus;
};

export type BuilderErrorState = {
  initial?: string;
  schemasByDb: Record<string, string | undefined>;
  tablesBySchema: Record<string, string | undefined>;
  attributes?: string;
  relationships?: string;
  autoMap?: string;
  chat?: string;
};

export type SttmBuilderData = {
  sources: DatabaseNode[];
  targets: DatabaseNode[];
};

export type SttmBuilderContextValue = {
  // Tree data
  fullData: SttmBuilderData | null;

  // Flat lists (current schema's tables)
  sources: TableNode[];
  targets: TableNode[];
  sourceInfo: SourceTargetInfo;
  targetInfo: SourceTargetInfo;

  // Attributes
  sourceAttributeGroups: ColumnGroup[];
  targetAttributeGroup: ColumnGroup | null;

  // Mapping
  mappingSuggestions: MappingSuggestion[];
  mappingLoading: boolean;
  autoMapStatusMessage: string | null;

  // Chat
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  assistantSignals: AssistantSignal[];
  assistantInferences: AssistantInferenceRecord[];
  assistantPreferences: AssistantPreferenceState;
  assistantUnreadCount: number;
  semanticBundleId: string | null;
  semanticBundleLabel: string | null;
  semanticLevel: string | null;
  semanticStatus: string | null;
  semanticViewName: string | null;
  semanticContextSummary: Record<string, unknown> | null;
  semanticContextItems: SemanticContextItem[] | null;
  semanticLineage: Array<Record<string, unknown>>;
  semanticDatahubContext: Record<string, unknown> | null;
  datahubStatus: string | null;
  pendingDerivedSourceDraft: PendingDerivedSourceDraft | null;
  derivedSourceDraftRequested: boolean;

  // Session
  session: UserSession | null;

  // Loading / error
  loadState: BuilderLoadState;
  errorState: BuilderErrorState;

  // Actions — data loading
  reloadInitialData: () => void;
  loadSchemas: (type: SelectionSide, dbId: string) => void;
  selectSchema: (type: SelectionSide, dbId: string, schemaId: string) => void;

  // Actions — selection
  toggleSource: (tableId: string) => void;
  selectTarget: (tableId: string) => void;
  clearSources: () => void;
  clearTargets: () => void;

  // Actions — AI
  runAutoMap: () => void;
  sendChatMessage: (message: string) => void;
  submitChatFeedback: (payload: { messageId: string; rating: number; comment?: string | null }) => void;
  refreshAssistantSignals: () => void;
  respondToAssistantSignal: (payload: {
    signalId: string;
    status?: "acknowledged" | "responded" | "dismissed";
    optionSelected?: string | null;
    rating?: number | null;
    comment?: string | null;
  }) => void;
  updateAssistantPreferences: (settings: AssistantPreferenceState) => void;
  openPendingDerivedSourceDraft: () => void;
  acknowledgePendingDerivedSourceDraft: () => void;
  dismissPendingDerivedSourceDraft: () => void;
  applyPendingAiMappingReview: () => void;
  skipPendingAiMappingReview: () => void;
  applySemanticRefresh: (payload: SemanticContextBundleResponse) => void;

  // Computed
  selectedSourceCount: number;
  mappingCount: number;

  // Derived source features
  drivingTableId: string | null;
  setDrivingTable: (tableId: string | null) => void;
  relationships: JoinConfig[];
  setRelationships: (joins: JoinConfig[]) => void;
  derivedSources: DerivedSource[];
  addDerivedSource: (source: DerivedSource) => void;
  updateDerivedSource: (source: DerivedSource) => void;
  removeDerivedSource: (id: string) => void;
  toggleDerivedSource: (id: string) => void;

  /** SQL fragment from Step 1 filter conditions (`FilterConditions`). */
  sourceFilterSql: string;
  /** Parsed filter tree (keeps UI + preview when navigating away and back). */
  sourceFilterGroups: RuleGroup[];
  sourceQuerySql: string;
  sourceGroupBySql: string;
  sourceOrderBySql: string;
  setSourceFilterConditions: (payload: {
    sql: string;
    groups: RuleGroup[];
    baseSql?: string;
    groupBySql?: string;
    orderBySql?: string;
  }) => void;

  // UI Mapping state
  mappings: MappingState[];
  selectedMappingIds: string[];
  mappingSql: string;
  isPreProcessModalOpen: boolean;
  activeMappingId: string | null;
  pendingAiMappingReviews: PendingAiMappingReview[];
  
  // Mapping actions
  initializeMappings: (mappings: MappingState[]) => void;
  updateMapping: (id: string, updates: Partial<MappingState>) => void;
  toggleMappingSelection: (id: string) => void;
  selectAllMappings: (ids: string[], select: boolean) => void;
  bulkMarkMapped: (ids: string[]) => void;
  bulkSetDirect: (ids: string[]) => void;
  setPreProcessModalOpen: (open: boolean, mappingId?: string | null) => void;
  setMappingSql: (sql: string) => void;
};

export type MappingStatus = "MAPPED" | "UNMAPPED";
export type MappingRuleType = "Direct" | "Select..." | "Custom" | string;

export interface MappingState {
  id: string;
  targetColumn: string;
  targetType: string;
  sourceColumn: string | null;
  sourceType: string | null;
  sourceColumns?: string[];
  expression: string | null;
  rule: MappingRuleType;
  status: MappingStatus;
  nlRule?: string | null;
  loadOrder?: string | null;
  description?: string | null;
  descriptionEdited?: boolean;
  confidenceScore?: number | null;
  confidenceReason?: string | null;
  candidateSourceColumns?: string[];
  unmatchedReason?: string | null;
  aiSuggestedRule?: string | null;
  aiSuggestedRuleType?: string | null;
}
