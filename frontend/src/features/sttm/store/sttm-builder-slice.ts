import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
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
  RuleGroup,
  SchemaNode,
  SourceTargetInfo,
  TableNode,
} from "@/features/sttm/types/sttm.types";

// ─── helpers ───────────────────────────────────────────────────────
function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
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

  session: any;

  loadState: BuilderLoadState;
  errorState: BuilderErrorState;

  drivingTableId: string | null;
  relationships: JoinConfig[];
  derivedSources: DerivedSource[];

  sourceFilterSql: string;
  sourceFilterGroups: RuleGroup[];
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

  session: null,

  loadState: initialLoadState,
  errorState: initialErrorState,

  drivingTableId: null,
  relationships: [],
  derivedSources: [],

  sourceFilterSql: "",
  sourceFilterGroups: [],
};

// ─── async thunks ──────────────────────────────────────────────────

const useMockDb = process.env.NEXT_PUBLIC_USE_MOCK_DB === "true";

/** Fetch database list (+ session). Cached: won't refetch if already loaded. */
export const fetchDatabases = createAsyncThunk(
  "sttmBuilder/fetchDatabases",
  async (_, { rejectWithValue }) => {
    try {
      const [databases, userSession] = await Promise.all([
        dbService.getExplorerData(),
        useMockDb ? Promise.resolve(null) : authService.getSession().catch(() => null),
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
            ),
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
    if (!selectedSourceTables.length || !state.targetAttributeGroup) return null;

    try {
      const response = await workbenchService.invoke({
        interface: "AUTO_MAP",
        thread_id: state.agentThreadId,
        source_tables: selectedSourceTables.map((t) => makeTableRef(t.qualifiedName)),
        driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
        relationships: buildRelationshipPayload(state.relationships),
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
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
  async (message: string, { getState, rejectWithValue }) => {
    const trimmed = message.trim();
    if (!trimmed) return null;
    const state = (getState() as { sttmBuilder: SttmBuilderState }).sttmBuilder;
    try {
      const response = await workbenchService.invoke({
        interface: "CHAT",
        thread_id: state.agentThreadId,
        message: trimmed,
        source_tables: state.sources
          .filter((table) => table.isSelected)
          .map((table) => makeTableRef(table.qualifiedName)),
        driving_table: state.drivingTableId ? makeTableRef(state.drivingTableId) : null,
        relationships: buildRelationshipPayload(state.relationships),
        selected_columns_by_table: buildSelectedColumnsByTable(state.sourceAttributeGroups),
      });
      return { userMessage: trimmed, response };
    } catch (err) {
      return rejectWithValue(trimmed);
    }
  }
);

// ─── slice ─────────────────────────────────────────────────────────
export const sttmBuilderSlice = createSlice({
  name: "sttmBuilder",
  initialState,
  reducers: {
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
      state.drivingTableId = null;
      state.relationships = [];
      state.sourceAttributeGroups = [];
      state.mappingSuggestions = [];
      state.sourceFilterSql = "";
      state.sourceFilterGroups = [];
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
      state.targetAttributeGroup = null;
      state.mappingSuggestions = [];
    },

    setDrivingTable: (state, action: PayloadAction<{ tableId: string | null }>) => {
      state.drivingTableId = action.payload.tableId;
    },

    setRelationships: (state, action: PayloadAction<{ joins: JoinConfig[] }>) => {
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
          state.sourceFilterSql = "";
          state.sourceFilterGroups = [];
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

        const entries = Object.entries(
          (response.result?.mappings ?? {}) as Record<
            string,
            { source_attributes?: string[]; confidence_score?: number }
          >
        );
        state.mappingSuggestions = entries.map(([target, val]) => ({
          targetAttribute: target,
          sourceAttributes: val?.source_attributes ?? [],
          confidenceScore: val?.confidence_score ?? 0,
        }));

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
          state.chatMessages.push({ role: "user", content: msg });
        }
      })
      .addCase(sendChatMessage.fulfilled, (state, action) => {
        state.chatLoading = false;
        if (!action.payload) return;
        state.agentThreadId = action.payload.response.thread_id;
        state.chatMessages.push({
          role: "assistant",
          content: action.payload.response.message ?? "Done.",
        });
      })
      .addCase(sendChatMessage.rejected, (state) => {
        state.chatLoading = false;
        state.chatMessages.push({
          role: "assistant",
          content: "I could not reach the STTM agent just now. Please try again.",
        });
      });
  },
});

export const {
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
} = sttmBuilderSlice.actions;

export default sttmBuilderSlice.reducer;
