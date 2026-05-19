
import type { UserSession } from "@/types/user";

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
  filters: any[];
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
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  status?: "completed" | "needs_input" | "failed";
  options?: string[];
  isStreaming?: boolean;
  traceSteps?: string[];
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

  // Chat
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  semanticBundleId: string | null;
  semanticBundleLabel: string | null;
  semanticLevel: string | null;
  semanticStatus: string | null;
  semanticViewName: string | null;
  semanticContextSummary: Record<string, unknown> | null;
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
  openPendingDerivedSourceDraft: () => void;
  acknowledgePendingDerivedSourceDraft: () => void;
  dismissPendingDerivedSourceDraft: () => void;

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
  setSourceFilterConditions: (payload: { sql: string; groups: RuleGroup[] }) => void;
};
