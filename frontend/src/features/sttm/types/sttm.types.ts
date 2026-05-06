
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
  conditions?: {
    leftColumn?: string;
    operator?: string;
    rightColumn?: string;
  }[];
}

export interface DerivedSource {
  id: string;
  sourceName: string;
  alias?: string;
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
  columns: Array<{
    name: string;
    type: string;
  }>;
};

export type MappingSuggestion = {
  targetAttribute: string;
  sourceAttributes: string[];
  confidenceScore: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LoadStatus = "idle" | "loading" | "success" | "error";

export type BuilderLoadState = {
  initial: LoadStatus;
  schemasByDb: Record<string, LoadStatus>;
  tablesBySchema: Record<string, LoadStatus>;
  attributes: LoadStatus;
  autoMap: LoadStatus;
  chat: LoadStatus;
};

export type BuilderErrorState = {
  initial?: string;
  schemasByDb: Record<string, string | undefined>;
  tablesBySchema: Record<string, string | undefined>;
  attributes?: string;
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

  // Computed
  selectedSourceCount: number;
  mappingCount: number;

  // Derived source features
  drivingTableId: string | null;
  setDrivingTable: (tableId: string | null) => void;
  derivedSources: DerivedSource[];
  addDerivedSource: (source: DerivedSource) => void;
  updateDerivedSource: (source: DerivedSource) => void;
  removeDerivedSource: (id: string) => void;
};
