import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { getApiErrorMessage } from "@/api/axiosInstance";
import { dbService } from "@/services/dbService";
import { workbenchService, type TableRef } from "@/services/workbenchService";
import { authService } from "@/services/authService";
import type {
  BuilderErrorState,
  BuilderLoadState,
  ChatMessage,
  Column,
  ColumnGroup,
  DatabaseNode,
  DerivedSource,
  JoinConfig,
  MappingSuggestion,
  PendingDerivedSourceDraft,
  RuleGroup,
  SchemaNode,
  SourceTargetInfo,
  TableNode,
  MappingState,
} from "@/features/sttm/types/sttm.types";

// ─── helpers ───────────────────────────────────────────────────────
function getErrorMessage(error: unknown, fallback: string): string {
  return getApiErrorMessage(error, fallback);
}

function makeTableRef(qualifiedName: string): TableRef {
  const [database, schema, table] = qualifiedName.split(".", 3);
  return { database, schema, table };
}

function cloneBranch(branch: DatabaseNode[]): DatabaseNode[] {
  return branch.map((db) => ({
    ...db,
    schemas: db.schemas.map((s) => ({
      ...s,
      tables: s.tables.map((t) => ({ ...t })),
    })),
  }));
}

function mergeColumnsIntoTables(
  tables: TableNode[],
  groups: ColumnGroup[]
): TableNode[] {
  return tables.map((table) => {
    const group = groups.find((item) => item.qualifiedName === table.qualifiedName);
    if (!group) return table;
    return {
      ...table,
      columns: group.columns.length,
      columnItems: group.columns,
    };
  });
}

function mergeColumnsIntoBranch(
  branch: DatabaseNode[],
  groups: ColumnGroup[]
): DatabaseNode[] {
  for (const db of branch) {
    for (const schema of db.schemas) {
      schema.tables = mergeColumnsIntoTables(schema.tables, groups);
    }
  }
  return branch;
}

function buildSelectedColumnsByTable(
  groups: ColumnGroup[]
): Record<string, string[]> | null {
  if (!groups.length) return null;

  const out: Record<string, string[]> = {};
  for (const group of groups) {
    const selected = group.columns
      .filter((column) => !!column.name)
      .map((column) => column.name as string);
    if (selected.length) {
      out[group.qualifiedName] = selected;
    }
  }
  return Object.keys(out).length ? out : null;
}

function buildRelationshipPayload(joins: JoinConfig[]) {
  return joins
    .filter(
      (join) =>
        !!join.leftTableId &&
        !!join.rightTableId &&
        !!join.conditions?.length
    )
    .map((join) => ({
      left_table: makeTableRef(join.leftTableId as string),
      right_table: makeTableRef(join.rightTableId as string),
      constraint_name: join.constraintName ?? null,
      join_type: join.joinType ?? "INNER",
      source: join.source ?? "USER_DEFINED",
      locked: join.locked ?? false,
      conditions: (join.conditions ?? [])
        .filter((condition) => !!condition.leftColumn && !!condition.rightColumn)
        .map((condition) => ({
          left_column: condition.leftColumn as string,
          right_column: condition.rightColumn as string,
          operator: condition.operator ?? "=",
        })),
    }))
    .filter((join) => join.conditions.length > 0);
}

function getSelectedDerivedSourceIds(derivedSources: DerivedSource[]): string[] {
  return derivedSources.filter((source) => source.isSelected).map((source) => source.id);
}

type SemanticRefreshResult = Awaited<ReturnType<typeof dbService.refreshSemanticContext>>;

function isAnalystReadyLevel(level?: string | null): boolean {
  return level === "L2_ANALYST_READY" || level === "L3_MAPPING_ENRICHED";
}

function isAnalystSqlText(text: string): boolean {
  return [
    "sql",
    "query",
    "count",
    "sum",
    "average",
    "avg",
    "group by",
    "how many",
    "total ",
    "top ",
    "trend",
    "revenue",
    "show rows",
    "show records",
  ].some((token) => text.includes(token));
}

function isDerivedSourceGenerationText(text: string): boolean {
  const directTokens = [
    "derived source",
    "derived table",
    "generate sql",
    "generate query",
    "write sql",
    "write query",
    "build query",
    "create query",
  ];
  if (directTokens.some((token) => text.includes(token))) {
    return true;
  }
  return (text.includes("create") || text.includes("build") || text.includes("generate")) &&
    text.includes("join");
}

function createChatMessageId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractClarificationOptions(response: {
  data?: { artifact?: Record<string, unknown> | null; status?: string | null } | null;
}) {
  const artifact = response.data?.artifact;
  if (!artifact || typeof artifact !== "object") return [];
  const direct = artifact.clarification_options;
  if (Array.isArray(direct)) {
    return direct.map((item) => String(item)).filter(Boolean);
  }
  const suggestions = artifact.suggestions;
  if (Array.isArray(suggestions)) {
    return suggestions.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

// ─── state shape ───────────────────────────────────────────────────
type SttmBuilderState = {
  sourceDatabases: DatabaseNode[];
  targetDatabases: DatabaseNode[];

  sources: TableNode[];
  targets: TableNode[];
  sourceInfo: SourceTargetInfo;
  targetInfo: SourceTargetInfo;

  sourceAttributeGroups: ColumnGroup[];
  targetAttributeGroup: ColumnGroup | null;

  mappingSuggestions: MappingSuggestion[];
  mappingLoading: boolean;

  chatMessages: ChatMessage[];
  chatLoading: boolean;
  agentThreadId: string | null;
  semanticBundleId: string | null;
  semanticBundleLabel: string | null;
  semanticLevel: string | null;
  semanticStatus: string | null;
  semanticViewName: string | null;
  semanticContextSummary: Record<string, unknown> | null;
  datahubStatus: string | null;
  pendingDerivedSourceDraft: PendingDerivedSourceDraft | null;
  derivedSourceDraftRequested: boolean;

  session: any;

  loadState: BuilderLoadState;
  errorState: BuilderErrorState;

  drivingTableId: string | null;
  relationships: JoinConfig[];
  derivedSources: DerivedSource[];

  sourceFilterSql: string;
  sourceFilterGroups: RuleGroup[];

  mappings: MappingState[];
  selectedMappingIds: string[];
  mappingSql: string;
  isPreProcessModalOpen: boolean;
  activeMappingId: string | null;
};

const initialLoadState: BuilderLoadState = {
  initial: "idle",
  schemasByDb: {},
  tablesBySchema: {},
  attributes: "idle",
  relationships: "idle",
  autoMap: "idle",
  chat: "idle",
};

const initialErrorState: BuilderErrorState = {
  schemasByDb: {},
  tablesBySchema: {},
};

const initialState: SttmBuilderState = {
  sourceDatabases: [],
  targetDatabases: [],

  sources: [],
  targets: [],
  sourceInfo: { dbName: "", schemaName: "" },
  targetInfo: { dbName: "", schemaName: "" },

  sourceAttributeGroups: [],
  targetAttributeGroup: null,

  mappingSuggestions: [],
  mappingLoading: false,

  chatMessages: [
    {
      role: "assistant",
      content: "Hi! I'm your STTM AI Assistant. Ask me about mapping, tables, or next steps.",
    },
  ],
  chatLoading: false,
  agentThreadId: null,
  semanticBundleId: null,
  semanticBundleLabel: null,
  semanticLevel: null,
  semanticStatus: null,
  semanticViewName: null,
  semanticContextSummary: null,
  datahubStatus: null,
  pendingDerivedSourceDraft: null,
  derivedSourceDraftRequested: false,

  session: null,

  loadState: initialLoadState,
  errorState: initialErrorState,

  drivingTableId: null,
  relationships: [],
  derivedSources: [],

  sourceFilterSql: "",
  sourceFilterGroups: [],

  mappings: [],
  selectedMappingIds: [],
  mappingSql: "",
  isPreProcessModalOpen: false,
  activeMappingId: null,
};

// ─── async thunks ──────────────────────────────────────────────────

/** Fetch database list (+ session). Cached: won't refetch if already loaded. */
export const fetchDatabases = createAsyncThunk(
  "sttmBuilder/fetchDatabases",
  async (_, { rejectWithValue }) => {
    try {
      const [databases, userSession] = await Promise.all([
        dbService.getExplorerData(),
        authService.getSession().catch(() => null),
      ]);
      return { databases, session: userSession };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load databases."));
    }
  },
  {
    condition: (_, { getState }) => {
      const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
      // Skip if already loaded or currently loading
      return state.loadState.initial !== "success" && state.loadState.initial !== "loading";
    },
  }
);

/** Fetch schemas for a specific database. Cached per db via schemasLoaded flag. */
export const fetchSchemas = createAsyncThunk(
  "sttmBuilder/fetchSchemas",
  async (
    { type, dbId }: { type: "source" | "target"; dbId: string },
    { rejectWithValue }
  ) => {
    try {
      const schemas = await dbService.getDatabaseSchemas(dbId);
      return { type, dbId, schemas };
    } catch (err) {
      return rejectWithValue({
        type,
        dbId,
        message: getErrorMessage(err, "Unable to load schemas."),
      });
    }
  },
  {
    condition: ({ type, dbId }, { getState }) => {
      const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
      const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
      const db = branch.find((d) => d.dbId === dbId);
      // Skip if already loaded or currently loading
      if (db?.schemasLoaded) return false;
      const key = `${type}:${dbId}`;
      if (state.loadState.schemasByDb[key] === "loading") return false;
      return true;
    },
  }
);

/** Fetch tables for a schema. Populates the flat sources/targets list. Cached per schema. */
export const fetchTables = createAsyncThunk(
  "sttmBuilder/fetchTables",
  async (
    { type, dbId, schemaId }: { type: "source" | "target"; dbId: string; schemaId: string },
    { getState, rejectWithValue }
  ) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
    const db = branch.find((d) => d.dbId === dbId);
    const schema = db?.schemas.find((s) => s.schemaId === schemaId);
    if (schema?.tablesLoaded) {
      // Already cached — just return the existing tables so reducer can set them as sources/targets
      return { type, dbId, schemaId, tables: null, cached: true };
    }

    const [databaseName, schemaName] = schemaId.split(":", 2);
    try {
      const tables = await dbService.getSchemaTables(databaseName, schemaName);
      return { type, dbId, schemaId, tables, cached: false };
    } catch (err) {
      return rejectWithValue({
        type,
        schemaId,
        message: getErrorMessage(err, "Unable to load tables."),
      });
    }
  }
);

/** Fetch attributes/columns for selected source tables. */
export const fetchAttributes = createAsyncThunk(
  "sttmBuilder/fetchAttributes",
  async (
    { qualifiedNames, side }: { qualifiedNames: string[]; side: "source" | "target" },
    { rejectWithValue }
  ) => {
    if (!qualifiedNames.length) return { side, groups: [] };
    try {
      const attrs = await dbService.getTableAttributes(qualifiedNames);
      const groups: ColumnGroup[] = attrs.map(
        (item: {
          table: TableRef;
          columns: Array<{
            column_name: string;
            data_type: string;
            is_primary_key?: boolean;
            is_foreign_key?: boolean;
          }>;
        }) => ({
          table: item.table.table,
          qualifiedName: `${item.table.database}.${item.table.schema}.${item.table.table}`,
          columns: item.columns.map(
            (c): Column => ({
              name: c.column_name,
              type: c.data_type,
              isPrimaryKey: !!c.is_primary_key,
              isForeignKey: !!c.is_foreign_key,
              tableName: item.table.table,
            })
          ),
        })
      );
      return { side, groups };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load attributes."));
    }
  }
);

/** Fetch relationships for currently selected source tables. */
export const fetchRelationships = createAsyncThunk(
  "sttmBuilder/fetchRelationships",
  async (_, { getState, rejectWithValue }) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const selectedSourceTables = state.sources.filter((table) => table.isSelected);

    if (selectedSourceTables.length < 2) {
      return [];
    }

    try {
      const relationships = await dbService.getTableRelationships(
        selectedSourceTables.map((table) => makeTableRef(table.qualifiedName))
      );

      return relationships.map(
        (item: {
          left_table: TableRef;
          right_table: TableRef;
          constraint_name?: string | null;
          join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
          source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
          locked?: boolean;
          conditions?: Array<{
            left_column?: string;
            right_column?: string;
            operator?: string;
          }>;
        }): JoinConfig => {
          const leftTableId = `${item.left_table.database}.${item.left_table.schema}.${item.left_table.table}`;
          const rightTableId = `${item.right_table.database}.${item.right_table.schema}.${item.right_table.table}`;
          const baseId = item.constraint_name?.trim()
            ? item.constraint_name
            : `${leftTableId}__${rightTableId}`;

          return {
            id: baseId,
            leftTableId,
            rightTableId,
            joinType: item.join_type ?? "INNER",
            constraintName: item.constraint_name ?? undefined,
            source: item.source ?? "FOREIGN_KEY",
            locked: item.locked ?? true,
          conditions: (item.conditions ?? [])
              .filter(
                (condition) =>
                  (condition.left_column || (condition as { fk_column?: string }).fk_column) &&
                  (condition.right_column || (condition as { pk_column?: string }).pk_column)
              )
              .map((condition) => ({
                leftColumn:
                  (condition.left_column ??
                    (condition as { fk_column?: string }).fk_column) as string,
                rightColumn:
                  (condition.right_column ??
                    (condition as { pk_column?: string }).pk_column) as string,
                operator: condition.operator ?? "=",
              })),
          };
        }
      );
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load table relationships."));
    }
  }
);

export const fetchDerivedSources = createAsyncThunk(
  "sttmBuilder/fetchDerivedSources",
  async (_, { rejectWithValue }) => {
    try {
      const rows = await dbService.listDerivedSources();
      return rows.map(
        (row: {
          derived_source_id: string;
          derived_source_name: string;
          sql_text?: string;
          source_tables?: Array<{ database: string; schema: string; table: string }>;
          driving_table?: { database: string; schema: string; table: string } | null;
          relationships?: Array<{
            id?: string;
            left_table: { database: string; schema: string; table: string };
            right_table: { database: string; schema: string; table: string };
            join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
            constraint_name?: string | null;
            source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
            locked?: boolean;
            conditions?: Array<{
              left_column: string;
              right_column: string;
              operator?: string;
            }>;
          }>;
          filters?: any[];
          selected_columns_by_table?: Record<string, string[]>;
          preview_columns?: Array<{
            name: string;
            data_type: string;
            is_primary_key?: boolean;
          }>;
          semantic_bundle_id?: string | null;
          semantic_view_name?: string | null;
          semantic_level?: string | null;
          upstream_hash?: string | null;
          lineage_depth?: number;
        }): DerivedSource => {
          const sourceTables = row.source_tables ?? [];
          const selectedColumns = row.selected_columns_by_table ?? {};
          const sourceTableIds = sourceTables.map(
            (table) => `${table.database}.${table.schema}.${table.table}`
          );

          return {
            id: row.derived_source_id,
            sourceName: row.derived_source_name,
            sqlText: row.sql_text,
            semanticBundleId: row.semantic_bundle_id ?? null,
            semanticViewName: row.semantic_view_name ?? null,
            semanticLevel: row.semantic_level ?? null,
            upstreamHash: row.upstream_hash ?? null,
            lineageDepth: row.lineage_depth ?? 0,
            drivingTableId: row.driving_table
              ? `${row.driving_table.database}.${row.driving_table.schema}.${row.driving_table.table}`
              : undefined,
            tableIds: sourceTableIds,
            joins: (row.relationships ?? []).map((relationship, index) => ({
              id:
                relationship.id ??
                relationship.constraint_name ??
                `${relationship.left_table.database}.${relationship.left_table.schema}.${relationship.left_table.table}__${relationship.right_table.database}.${relationship.right_table.schema}.${relationship.right_table.table}__${index}`,
              joinType: relationship.join_type ?? "INNER",
              leftTableId: `${relationship.left_table.database}.${relationship.left_table.schema}.${relationship.left_table.table}`,
              rightTableId: `${relationship.right_table.database}.${relationship.right_table.schema}.${relationship.right_table.table}`,
              conditions: (relationship.conditions ?? []).map((condition, conditionIndex) => ({
                id: `cond-${index + 1}-${conditionIndex + 1}`,
                leftColumn: condition.left_column,
                operator: condition.operator ?? "=",
                rightColumn: condition.right_column,
              })),
            })),
            filters: row.filters ?? [],
            columns: Object.entries(selectedColumns).flatMap(([tableId, columns]) =>
              columns.map((columnName) => ({
                name: columnName,
                tableId,
                tableName: tableId.split(".").pop(),
              }))
            ).length
              ? Object.entries(selectedColumns).flatMap(([tableId, columns]) =>
                  columns.map((columnName) => ({
                    name: columnName,
                    tableId,
                    tableName: tableId.split(".").pop(),
                  }))
                )
              : (row.preview_columns ?? []).map((column) => ({
                  name: column.name,
                  tableId: row.derived_source_id,
                  tableName: row.derived_source_name,
                })),
            previewColumns: (row.preview_columns ?? []).map((column) => ({
              name: column.name,
              dataType: column.data_type,
              isPrimaryKey: column.is_primary_key,
            })),
          };
        }
      );
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load derived sources."));
    }
  }
);

/** Run auto-mapping. */
export const runAutoMap = createAsyncThunk(
  "sttmBuilder/runAutoMap",
  async (_, { getState, rejectWithValue }) => {
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const selectedSourceTables = state.sources.filter((t) => t.isSelected);
    const selectedTargetTable = state.targets.find((table) => table.isSelected);
    if (!selectedSourceTables.length || !state.targetAttributeGroup) return null;

    try {
      const response = await workbenchService.invoke({
        interface: "AUTO_MAP",
        thread_id: state.agentThreadId,
        source_tables: selectedSourceTables.map((t) => makeTableRef(t.qualifiedName)),
        target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
        driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
        relationships: buildRelationshipPayload(state.relationships),
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
        selected_derived_sources: getSelectedDerivedSourceIds(state.derivedSources),
        semantic_bundle_id: state.semanticBundleId,
        semantic_view_name: state.semanticViewName,
        surface: "MAPPING",
        semantic_level_requested: "L3_MAPPING_ENRICHED",
        attributes: state.targetAttributeGroup.columns
          .filter((col) => !!col.name)
          .map((col) => ({
            target_table: makeTableRef(state.targetAttributeGroup!.qualifiedName),
            target_attribute: col.name as string,
            source_mappings: null,
          })),
      });
      return response;
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Auto-map failed."));
    }
  }
);

/** Send chat message to agent. */
export const sendChatMessage = createAsyncThunk(
  "sttmBuilder/sendChatMessage",
  async (message: string, { dispatch, getState, rejectWithValue }) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return rejectWithValue({
        userMessage: "",
        errorMessage: "Please enter a message before sending.",
        semanticRefresh: null,
        messageId: createChatMessageId(),
      });
    }
    const messageId = createChatMessageId();
    dispatch(assistantStreamStarted({ messageId }));
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    const selectedTargetTable = state.targets.find((table) => table.isSelected);
    const selectedSourceTables = state.sources
      .filter((table) => table.isSelected)
      .map((table) => makeTableRef(table.qualifiedName));
    const selectedDerivedSourceIds = getSelectedDerivedSourceIds(state.derivedSources);
    const relationships = buildRelationshipPayload(state.relationships);
    const surface = state.targetAttributeGroup ? "MAPPING" : "SOURCE_SELECTION";
    const loweredMessage = trimmed.toLowerCase();
    const needsAnalystReadyContext =
      surface !== "MAPPING" &&
      (isDerivedSourceGenerationText(loweredMessage) || isAnalystSqlText(loweredMessage));
    const requestedSemanticLevel = state.targetAttributeGroup
      ? "L3_MAPPING_ENRICHED"
      : needsAnalystReadyContext
        ? "L2_ANALYST_READY"
        : "L1_CONTEXT";
    const selectedTableIds = [
      ...state.sources.filter((table) => table.isSelected).map((table) => table.qualifiedName),
      ...selectedDerivedSourceIds,
    ];
    let semanticRefresh: SemanticRefreshResult | null = null;
    let semanticBundleId = state.semanticBundleId;
    let semanticViewName = state.semanticViewName;
    let threadId = isDerivedSourceGenerationText(loweredMessage) ? null : state.agentThreadId;
    try {
      const pushStatus = (text: string) =>
        dispatch(assistantStreamStatus({ messageId, text }));

      if (
        (selectedSourceTables.length > 0 || selectedDerivedSourceIds.length > 0) &&
        needsAnalystReadyContext &&
        (!semanticBundleId || !semanticViewName || !isAnalystReadyLevel(state.semanticLevel))
      ) {
        pushStatus("Preparing analyst-ready semantic context for the current selection.");
        semanticRefresh = await dbService.refreshSemanticContext({
          selected_source_tables: selectedSourceTables,
          selected_derived_sources: selectedDerivedSourceIds,
          target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
          relationships: relationships as Array<Record<string, unknown>>,
          requested_level: "L2_ANALYST_READY",
          force: false,
        });
        const promotedBundleChanged =
          semanticRefresh.bundle_id !== state.semanticBundleId ||
          (semanticRefresh.semantic_view_name ?? null) !== (state.semanticViewName ?? null) ||
          !isAnalystReadyLevel(state.semanticLevel);
        semanticBundleId = semanticRefresh.bundle_id;
        semanticViewName = semanticRefresh.semantic_view_name ?? null;
        if (promotedBundleChanged) {
          threadId = null;
        }
      }

      let response = null as Awaited<ReturnType<typeof workbenchService.invoke>> | null;
      for await (const event of workbenchService.invokeStream({
        interface: "CHAT",
        thread_id: threadId,
        message: trimmed,
        source_tables: selectedSourceTables,
        target_table: selectedTargetTable ? makeTableRef(selectedTargetTable.qualifiedName) : null,
        driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
        relationships,
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
        selected_derived_sources: selectedDerivedSourceIds,
        semantic_bundle_id: semanticBundleId,
        semantic_view_name: semanticViewName,
        surface,
        semantic_level_requested: requestedSemanticLevel,
      })) {
        if (event.event === "status") {
          const statusText =
            typeof event.data.message === "string" ? event.data.message : "";
          if (statusText) pushStatus(statusText);
          continue;
        }
        if (event.event === "delta" && typeof event.data.text === "string") {
          dispatch(assistantStreamDelta({ messageId, text: event.data.text }));
          continue;
        }
        if (event.event === "suggestions" && Array.isArray(event.data.items)) {
          dispatch(
            assistantStreamOptions({
              messageId,
              options: event.data.items.map((item) => String(item)).filter(Boolean),
            })
          );
          continue;
        }
        if (event.event === "error") {
          throw new Error(event.data.message || "Streaming agent request failed.");
        }
        if (event.event === "final") {
          response = event.data;
        }
      }
      if (!response) {
        throw new Error("The STTM agent stream ended without a final response.");
      }
      return {
        userMessage: trimmed,
        response,
        selectedTableIds,
        drivingTableId: state.drivingTableId,
        semanticRefresh,
        messageId,
      };
    } catch (err) {
      const errorMessage = getErrorMessage(
        err,
        "I could not reach the STTM agent just now. Please try again."
      );
      dispatch(
        assistantStreamFailed({
          messageId,
          errorMessage,
        })
      );
      return rejectWithValue({
        userMessage: trimmed,
        errorMessage,
        semanticRefresh,
        messageId,
      });
    }
  }
);

// ─── slice ─────────────────────────────────────────────────────────
export const sttmBuilderSlice = createSlice({
  name: "sttmBuilder",
  initialState,
  reducers: {
    assistantStreamStarted: (state, action: PayloadAction<{ messageId: string }>) => {
      state.chatMessages.push({
        id: action.payload.messageId,
        role: "assistant",
        content: "",
        isStreaming: true,
        status: "completed",
        traceSteps: [],
      });
    },
    assistantStreamDelta: (
      state,
      action: PayloadAction<{ messageId: string; text: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      message.content = `${message.content}${action.payload.text}`;
      message.isStreaming = true;
    },
    assistantStreamStatus: (
      state,
      action: PayloadAction<{ messageId: string; text: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      const text = action.payload.text.trim();
      if (!text) return;
      const existingSteps = message.traceSteps ?? [];
      if (existingSteps.includes(text)) return;
      message.traceSteps = [...existingSteps, text];
      message.isStreaming = true;
    },
    assistantStreamOptions: (
      state,
      action: PayloadAction<{ messageId: string; options: string[] }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      message.options = action.payload.options;
      if (action.payload.options.length) {
        message.status = "needs_input";
      }
    },
    assistantStreamFinished: (
      state,
      action: PayloadAction<{
        messageId: string;
        content: string;
        status?: "completed" | "needs_input" | "failed";
        options?: string[];
      }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      const finalContent = action.payload.content.trim();
      if (finalContent) {
        message.content = finalContent;
      }
      message.status = action.payload.status ?? "completed";
      message.options = action.payload.options ?? message.options;
      message.isStreaming = false;
    },
    assistantStreamFailed: (
      state,
      action: PayloadAction<{ messageId: string; errorMessage: string }>
    ) => {
      const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
      if (message) {
        message.content = action.payload.errorMessage;
        message.status = "failed";
        message.isStreaming = false;
        return;
      }
      state.chatMessages.push({
        id: action.payload.messageId,
        role: "assistant",
        content: action.payload.errorMessage,
        status: "failed",
        isStreaming: false,
      });
    },
    toggleSource: (state, action: PayloadAction<{ tableId: string }>) => {
      const { tableId } = action.payload;
      state.sources = state.sources.map((t) =>
        t.tableId === tableId ? { ...t, isSelected: !t.isSelected } : t
      );

      // Update tree
      for (const db of state.sourceDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            if (t.tableId === tableId) {
              t.isSelected = !t.isSelected;
            }
          }
        }
      }

      // Driving table logic
      const justSelected = state.sources.find((t) => t.tableId === tableId)?.isSelected;
      if (justSelected && !state.drivingTableId) {
        state.drivingTableId = tableId;
      } else if (!justSelected && state.drivingTableId === tableId) {
        state.drivingTableId = state.sources.find((t) => t.isSelected)?.tableId ?? null;
      }
      state.agentThreadId = null;
      state.semanticBundleId = null;
      state.semanticBundleLabel = null;
      state.semanticStatus = null;
      state.semanticViewName = null;
      state.semanticContextSummary = null;
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
    },

    selectTarget: (state, action: PayloadAction<{ tableId: string }>) => {
      const { tableId } = action.payload;
      state.targets = state.targets.map((t) => ({
        ...t,
        isSelected: t.tableId === tableId,
      }));

      for (const db of state.targetDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            t.isSelected = t.tableId === tableId;
          }
        }
      }
    },

    clearSources: (state) => {
      state.sources = state.sources.map((t) => ({ ...t, isSelected: false }));
      for (const db of state.sourceDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            t.isSelected = false;
          }
        }
      }
      state.agentThreadId = null;
      state.drivingTableId = null;
      state.relationships = [];
      state.sourceAttributeGroups = [];
      state.mappingSuggestions = [];
      state.semanticBundleId = null;
      state.semanticBundleLabel = null;
      state.semanticLevel = null;
      state.semanticStatus = null;
      state.semanticViewName = null;
      state.semanticContextSummary = null;
      state.datahubStatus = null;
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
      state.derivedSources = state.derivedSources.map((source) => ({
        ...source,
        isSelected: false,
      }));
    },

    setSourceFilterConditions: (
      state,
      action: PayloadAction<{ sql: string; groups: RuleGroup[] }>
    ) => {
      state.sourceFilterSql = action.payload.sql;
      state.sourceFilterGroups = action.payload.groups;
    },

    clearTargets: (state) => {
      state.targets = state.targets.map((t) => ({ ...t, isSelected: false }));
      for (const db of state.targetDatabases) {
        for (const sch of db.schemas) {
          for (const t of sch.tables) {
            t.isSelected = false;
          }
        }
      }
      state.agentThreadId = null;
      state.targetAttributeGroup = null;
      state.mappingSuggestions = [];
      state.semanticLevel = null;
    },

    setDrivingTable: (state, action: PayloadAction<{ tableId: string | null }>) => {
      state.agentThreadId = null;
      state.drivingTableId = action.payload.tableId;
    },

    setRelationships: (state, action: PayloadAction<{ joins: JoinConfig[] }>) => {
      state.agentThreadId = null;
      state.relationships = action.payload.joins;
    },

    addDerivedSource: (state, action: PayloadAction<DerivedSource>) => {
      state.derivedSources.push({ ...action.payload, isSelected: false });
    },

    updateDerivedSource: (state, action: PayloadAction<DerivedSource>) => {
      const idx = state.derivedSources.findIndex((s) => s.id === action.payload.id);
      if (idx !== -1) {
        state.derivedSources[idx] = {
          ...action.payload,
          isSelected: state.derivedSources[idx].isSelected ?? false,
        };
      }
    },

    removeDerivedSource: (state, action: PayloadAction<{ id: string }>) => {
      state.derivedSources = state.derivedSources.filter((s) => s.id !== action.payload.id);
    },

    toggleDerivedSource: (state, action: PayloadAction<{ id: string }>) => {
      state.derivedSources = state.derivedSources.map((source) =>
        source.id === action.payload.id
          ? { ...source, isSelected: !source.isSelected }
          : source
      );
      state.agentThreadId = null;
      state.semanticBundleId = null;
      state.semanticBundleLabel = null;
      state.semanticStatus = null;
      state.semanticViewName = null;
      state.semanticContextSummary = null;
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
    },
    openPendingDerivedSourceDraft: (state) => {
      if (state.pendingDerivedSourceDraft) {
        state.derivedSourceDraftRequested = true;
      }
    },
    acknowledgePendingDerivedSourceDraft: (state) => {
      state.derivedSourceDraftRequested = false;
    },
    dismissPendingDerivedSourceDraft: (state) => {
      state.pendingDerivedSourceDraft = null;
      state.derivedSourceDraftRequested = false;
    },

    // UI Mapping Reducers
    initializeMappings: (state, action: PayloadAction<MappingState[]>) => {
      state.mappings = action.payload;
      state.selectedMappingIds = [];
    },
    updateMapping: (state, action: PayloadAction<{ id: string; updates: Partial<MappingState> }>) => {
      const mapping = state.mappings.find((m) => m.id === action.payload.id);
      if (mapping) {
        Object.assign(mapping, action.payload.updates);
      }
    },
    toggleMappingSelection: (state, action: PayloadAction<{ id: string }>) => {
      const idx = state.selectedMappingIds.indexOf(action.payload.id);
      if (idx >= 0) {
        state.selectedMappingIds.splice(idx, 1);
      } else {
        state.selectedMappingIds.push(action.payload.id);
      }
    },
    selectAllMappings: (state, action: PayloadAction<{ ids: string[]; select: boolean }>) => {
      if (action.payload.select) {
        state.selectedMappingIds = Array.from(new Set([...state.selectedMappingIds, ...action.payload.ids]));
      } else {
        state.selectedMappingIds = state.selectedMappingIds.filter((id) => !action.payload.ids.includes(id));
      }
    },
    bulkMarkMapped: (state, action: PayloadAction<{ ids: string[] }>) => {
      state.mappings.forEach((mapping) => {
        if (action.payload.ids.includes(mapping.id) && mapping.sourceColumn) {
          mapping.status = "MAPPED";
        }
      });
      state.selectedMappingIds = [];
    },
    bulkSetDirect: (state, action: PayloadAction<{ ids: string[] }>) => {
      state.mappings.forEach((mapping) => {
        if (action.payload.ids.includes(mapping.id)) {
          mapping.rule = "Direct";
          mapping.expression = null;
          if (mapping.sourceColumn) {
            mapping.status = "MAPPED";
          }
        }
      });
      state.selectedMappingIds = [];
    },
    setPreProcessModalOpen: (
      state,
      action: PayloadAction<{ open: boolean; mappingId?: string | null }>
    ) => {
      state.isPreProcessModalOpen = action.payload.open;
      if (action.payload.open && action.payload.mappingId) {
        state.activeMappingId = action.payload.mappingId;
      } else if (!action.payload.open) {
        state.activeMappingId = null;
      }
    },
    setMappingSql: (state, action: PayloadAction<{ sql: string }>) => {
      state.mappingSql = action.payload.sql;
    },
  },

  extraReducers: (builder) => {
    // ── fetchDatabases ──
    builder
      .addCase(fetchDatabases.pending, (state) => {
        state.loadState.initial = "loading";
        state.errorState.initial = undefined;
      })
      .addCase(fetchDatabases.fulfilled, (state, action) => {
        const branch: DatabaseNode[] = action.payload.databases.map(
          (db: { database_name: string }) => ({
            dbId: db.database_name,
            dbName: db.database_name,
            dbType: "SNOWFLAKE",
            connectionId: db.database_name,
            isSelected: false,
            schemas: [],
            schemasLoaded: false,
          })
        );
        state.sourceDatabases = branch;
        state.targetDatabases = cloneBranch(branch);
        state.session = action.payload.session;
        state.loadState.initial = "success";
      })
      .addCase(fetchDatabases.rejected, (state, action) => {
        state.loadState.initial = "error";
        state.errorState.initial = action.payload as string;
        state.sourceDatabases = [];
        state.targetDatabases = [];
      });

    builder.addCase(fetchDerivedSources.fulfilled, (state, action) => {
      state.derivedSources = action.payload.map((source: DerivedSource) => ({
        ...source,
        isSelected: source.isSelected ?? false,
      }));
    });

    // ── fetchSchemas ──
    builder
      .addCase(fetchSchemas.pending, (state, action) => {
        const key = `${action.meta.arg.type}:${action.meta.arg.dbId}`;
        state.loadState.schemasByDb[key] = "loading";
        state.errorState.schemasByDb[key] = undefined;
      })
      .addCase(fetchSchemas.fulfilled, (state, action) => {
        const { type, dbId, schemas } = action.payload;
        const key = `${type}:${dbId}`;
        const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
        const db = branch.find((d) => d.dbId === dbId);
        if (db) {
          db.schemas = schemas.map((s: { schema_name: string }) => ({
            schemaId: `${dbId}:${s.schema_name}`,
            schemaName: s.schema_name,
            isSelected: false,
            tables: [],
            tablesLoaded: false,
          }));
          db.schemasLoaded = true;
        }
        state.loadState.schemasByDb[key] = "success";
      })
      .addCase(fetchSchemas.rejected, (state, action) => {
        const p = action.payload as { type: string; dbId: string; message: string };
        const key = `${p.type}:${p.dbId}`;
        state.loadState.schemasByDb[key] = "error";
        state.errorState.schemasByDb[key] = p.message;
      });

    // ── fetchTables ──
    builder
      .addCase(fetchTables.pending, (state, action) => {
        const key = `${action.meta.arg.type}:${action.meta.arg.schemaId}`;
        state.loadState.tablesBySchema[key] = "loading";
        state.errorState.tablesBySchema[key] = undefined;
      })
      .addCase(fetchTables.fulfilled, (state, action) => {
        if (!action.payload) return;
        const { type, dbId, schemaId, tables: rawTables, cached } = action.payload;
        const key = `${type}:${schemaId}`;
        const [databaseName, schemaName] = schemaId.split(":", 2);

        const branch = type === "source" ? state.sourceDatabases : state.targetDatabases;
        const db = branch.find((d) => d.dbId === dbId);

        if (!cached && rawTables && db) {
          const schema = db.schemas.find((s) => s.schemaId === schemaId);
          if (schema) {
            schema.tables = rawTables.map(
              (t: { table_name: string; row_count?: number | null; column_count?: number }) => ({
              tableId: `${databaseName}.${schemaName}.${t.table_name}`,
              tableName: t.table_name,
              qualifiedName: `${databaseName}.${schemaName}.${t.table_name}`,
              isSelected: false,
              tag: type === "source" ? "Source" : "Target",
              rows:
                t.row_count !== null && t.row_count !== undefined
                  ? String(t.row_count)
                  : "--",
              columns: t.column_count ?? 0,
              columnItems: [],
            })
            );
            schema.tablesLoaded = true;
          }
        }

        // Set active selection + flat list
        branch.forEach((d) => {
          const isActiveDb = d.dbId === dbId;
          d.isSelected = isActiveDb;
          d.schemas.forEach((s) => {
            s.isSelected = isActiveDb && s.schemaId === schemaId;
          });
        });

        const activeSchema = db?.schemas.find((s) => s.schemaId === schemaId);
        const flatTables = activeSchema?.tables.map((t) => ({ ...t })) ?? [];

        if (type === "source") {
          state.sources = flatTables;
          state.sourceInfo = { dbName: databaseName, schemaName };
          state.sourceAttributeGroups = [];
          state.relationships = [];
          state.mappingSuggestions = [];
          state.semanticBundleId = null;
          state.semanticBundleLabel = null;
          state.semanticLevel = null;
          state.semanticStatus = null;
          state.semanticViewName = null;
          state.semanticContextSummary = null;
        } else {
          state.targets = flatTables;
          state.targetInfo = { dbName: databaseName, schemaName };
          state.targetAttributeGroup = null;
          state.mappingSuggestions = [];
        }

        state.loadState.tablesBySchema[key] = "success";
      })
      .addCase(fetchTables.rejected, (state, action) => {
        const p = action.payload as { type: string; schemaId: string; message: string };
        const key = `${p.type}:${p.schemaId}`;
        state.loadState.tablesBySchema[key] = "error";
        state.errorState.tablesBySchema[key] = p.message;
      });

    // ── fetchAttributes ──
    builder
      .addCase(fetchAttributes.pending, (state) => {
        state.loadState.attributes = "loading";
      })
      .addCase(fetchAttributes.fulfilled, (state, action) => {
        if (!action.payload) return;
        const { side, groups } = action.payload;
        if (side === "source") {
          state.sourceAttributeGroups = groups;
          state.sources = mergeColumnsIntoTables(state.sources, groups);
          mergeColumnsIntoBranch(state.sourceDatabases, groups);
        } else {
          state.targetAttributeGroup = groups[0] ?? null;
          state.targets = mergeColumnsIntoTables(state.targets, groups);
          mergeColumnsIntoBranch(state.targetDatabases, groups);
        }
        state.loadState.attributes = "success";
      })
      .addCase(fetchAttributes.rejected, (state, action) => {
        state.loadState.attributes = "error";
        state.errorState.attributes = action.payload as string;
      });

    // ── fetchRelationships ──
    builder
      .addCase(fetchRelationships.pending, (state) => {
        state.loadState.relationships = "loading";
        state.errorState.relationships = undefined;
      })
      .addCase(fetchRelationships.fulfilled, (state, action) => {
        state.loadState.relationships = "success";
        state.relationships = action.payload;
      })
      .addCase(fetchRelationships.rejected, (state, action) => {
        state.loadState.relationships = "error";
        state.errorState.relationships = action.payload as string;
      });

    // ── runAutoMap ──
    builder
      .addCase(runAutoMap.pending, (state) => {
        state.mappingLoading = true;
      })
      .addCase(runAutoMap.fulfilled, (state, action) => {
        state.mappingLoading = false;
        if (!action.payload) return;
        const response = action.payload;
        state.agentThreadId = response.thread_id;
        state.semanticBundleId = response.data?.semantic_refresh_status?.bundle_id ?? state.semanticBundleId;
        state.semanticBundleLabel =
          (response.data?.semantic_refresh_status?.bundle_label as string | undefined) ??
          (typeof response.data?.artifact?.summary === "object" &&
          response.data?.artifact?.summary &&
          "bundle_label" in response.data.artifact.summary
            ? (response.data.artifact.summary.bundle_label as string | null)
            : state.semanticBundleLabel);
        state.semanticLevel = response.data?.semantic_level_achieved ?? state.semanticLevel;
        state.semanticStatus = response.data?.semantic_refresh_status?.status ?? state.semanticStatus;
        state.semanticViewName = response.data?.semantic_refresh_status?.semantic_view_name ?? state.semanticViewName;
        state.semanticContextSummary =
          response.data?.artifact_type === "semantic_context"
            ? (response.data?.artifact as Record<string, unknown> | null) ?? state.semanticContextSummary
            : state.semanticContextSummary;

        const result = response.result;
        const mappings =
          result && "mappings" in result
            ? result.mappings
            : {};
        const entries = Object.entries(mappings as Record<
          string,
          { source_attributes?: string[]; confidence_score?: number }
        >);
        state.mappingSuggestions = entries.map(([target, val]) => ({
          targetAttribute: target,
          sourceAttributes: val?.source_attributes ?? [],
          confidenceScore: val?.confidence_score ?? 0,
        }));

        for (const mapping of state.mappings) {
          const match = entries.find(
            ([target]) => target.toUpperCase() === mapping.targetColumn.toUpperCase(),
          );
          if (!match) continue;
          const [, val] = match;
          const sourceAttribute = val?.source_attributes?.[0];
          if (!sourceAttribute) continue;
          mapping.sourceColumn = sourceAttribute;
          mapping.status = "MAPPED";
          if (mapping.rule === "Select...") {
            mapping.rule = "Direct";
          }
        }

        if (response.message) {
          state.chatMessages.push({ role: "assistant", content: response.message });
        }
      })
      .addCase(runAutoMap.rejected, (state) => {
        state.mappingLoading = false;
      });

    // ── sendChatMessage ──
    builder
      .addCase(sendChatMessage.pending, (state, action) => {
        state.chatLoading = true;
        const msg = action.meta.arg.trim();
        if (msg) {
          state.chatMessages.push({ id: createChatMessageId(), role: "user", content: msg });
        }
      })
      .addCase(sendChatMessage.fulfilled, (state, action) => {
        state.chatLoading = false;
        if (!action.payload) return;
        if (action.payload.semanticRefresh) {
          state.semanticBundleId = action.payload.semanticRefresh.bundle_id;
          state.semanticBundleLabel =
            action.payload.semanticRefresh.bundle_label ?? state.semanticBundleLabel;
          state.semanticLevel =
            action.payload.semanticRefresh.achieved_level ?? state.semanticLevel;
          state.semanticStatus = action.payload.semanticRefresh.status ?? state.semanticStatus;
          state.semanticViewName =
            action.payload.semanticRefresh.semantic_view_name ?? state.semanticViewName;
          state.semanticContextSummary =
            action.payload.semanticRefresh.summary ?? state.semanticContextSummary;
          const preflightDatahubContext = action.payload.semanticRefresh.datahub_context;
          state.datahubStatus =
            typeof preflightDatahubContext?.status === "string"
              ? preflightDatahubContext.status
              : state.datahubStatus;
        }
        state.agentThreadId = action.payload.response.thread_id;
        state.semanticBundleId =
          action.payload.response.data?.semantic_refresh_status?.bundle_id ?? state.semanticBundleId;
        state.semanticBundleLabel =
          (action.payload.response.data?.semantic_refresh_status?.bundle_label as string | undefined) ??
          (typeof action.payload.response.data?.artifact?.summary === "object" &&
          action.payload.response.data?.artifact?.summary &&
          "bundle_label" in action.payload.response.data.artifact.summary
            ? (action.payload.response.data.artifact.summary.bundle_label as string | null)
            : state.semanticBundleLabel);
        state.semanticLevel =
          action.payload.response.data?.semantic_level_achieved ?? state.semanticLevel;
        state.semanticStatus =
          action.payload.response.data?.semantic_refresh_status?.status ?? state.semanticStatus;
        state.semanticViewName =
          action.payload.response.data?.semantic_refresh_status?.semantic_view_name ?? state.semanticViewName;
        if (action.payload.response.data?.artifact_type === "semantic_context") {
          state.semanticContextSummary =
            (action.payload.response.data?.artifact as Record<string, unknown> | null) ??
            state.semanticContextSummary;
        }
        if (
          action.payload.response.data?.artifact_type === "derived_source_draft" &&
          action.payload.response.data?.artifact &&
          typeof action.payload.response.data.artifact.sql_text === "string"
        ) {
          const artifactSelectedColumns =
            typeof action.payload.response.data.artifact.selected_columns_by_table === "object" &&
            action.payload.response.data.artifact.selected_columns_by_table !== null
              ? (action.payload.response.data.artifact.selected_columns_by_table as Record<string, string[]>)
              : null;
          state.pendingDerivedSourceDraft = {
            sqlText: action.payload.response.data.artifact.sql_text as string,
            sourceNameSuggestion:
              (action.payload.response.data.artifact.source_name_suggestion as string | null) ?? null,
            semanticViewName:
              (action.payload.response.data.artifact.semantic_view_name as string | null) ??
              state.semanticViewName,
            semanticBundleLabel: state.semanticBundleLabel,
            previewRows:
              (action.payload.response.data.artifact.preview_rows as Array<Record<string, unknown>> | undefined) ??
              [],
            selectedColumnsByTable: artifactSelectedColumns,
            selectedTableIds: action.payload.selectedTableIds,
            drivingTableId: action.payload.drivingTableId,
            requestSummary: action.payload.userMessage,
          };
          state.derivedSourceDraftRequested = false;
        }
        const clarificationOptions = extractClarificationOptions(action.payload.response);
        const responseStatus = action.payload.response.data?.status as
          | "completed"
          | "needs_input"
          | "failed"
          | undefined;
        if (action.payload.messageId) {
          const finalMessage =
            action.payload.response.message ??
            action.payload.response.data?.message ??
            "Done.";
          const message = state.chatMessages.find((item) => item.id === action.payload.messageId);
          if (message) {
            const hasOverlap =
              finalMessage &&
              message.content.includes(finalMessage.slice(0, Math.min(40, finalMessage.length)));
            if (finalMessage && (!message.content.trim() || !hasOverlap)) {
              message.content = finalMessage;
            }
            message.status = responseStatus ?? "completed";
            message.options = clarificationOptions;
            message.isStreaming = false;
          }
        }
        const datahubContext = action.payload.response.context?.datahub_context as
          | Record<string, unknown>
          | null
          | undefined;
        state.datahubStatus =
          typeof datahubContext?.status === "string" ? datahubContext.status : state.datahubStatus;
      })
      .addCase(sendChatMessage.rejected, (state, action) => {
        state.chatLoading = false;
        const payload = action.payload as
          | {
              errorMessage?: string;
              semanticRefresh?: SemanticRefreshResult | null;
            }
          | undefined;
        if (payload?.semanticRefresh) {
          state.semanticBundleId = payload.semanticRefresh.bundle_id;
          state.semanticBundleLabel =
            payload.semanticRefresh.bundle_label ?? state.semanticBundleLabel;
          state.semanticLevel =
            payload.semanticRefresh.achieved_level ?? state.semanticLevel;
          state.semanticStatus = payload.semanticRefresh.status ?? state.semanticStatus;
          state.semanticViewName =
            payload.semanticRefresh.semantic_view_name ?? state.semanticViewName;
          state.semanticContextSummary =
            payload.semanticRefresh.summary ?? state.semanticContextSummary;
          const preflightDatahubContext = payload.semanticRefresh.datahub_context;
          state.datahubStatus =
            typeof preflightDatahubContext?.status === "string"
              ? preflightDatahubContext.status
              : state.datahubStatus;
        }
      });
  },
});

export const {
  assistantStreamStarted,
  assistantStreamDelta,
  assistantStreamStatus,
  assistantStreamOptions,
  assistantStreamFinished,
  assistantStreamFailed,
  toggleSource,
  selectTarget,
  clearSources,
  clearTargets,
  setDrivingTable,
  setRelationships,
  setSourceFilterConditions,
  addDerivedSource,
  updateDerivedSource,
  removeDerivedSource,
  toggleDerivedSource,
  openPendingDerivedSourceDraft,
  acknowledgePendingDerivedSourceDraft,
  dismissPendingDerivedSourceDraft,
  initializeMappings,
  updateMapping,
  toggleMappingSelection,
  selectAllMappings,
  bulkMarkMapped,
  bulkSetDirect,
  setPreProcessModalOpen,
  setMappingSql,
} = sttmBuilderSlice.actions;

export default sttmBuilderSlice.reducer;
