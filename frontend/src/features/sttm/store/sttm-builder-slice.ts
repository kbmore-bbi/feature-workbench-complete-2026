import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { dbService } from "@/services/dbService";
import { workbenchService, type TableRef } from "@/services/workbenchService";
import { authService } from "@/services/authService";
import type {
  BuilderErrorState,
  BuilderLoadState,
  ChatMessage,
  ColumnGroup,
  DatabaseNode,
  DerivedSource,
  MappingSuggestion,
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
  derivedSources: DerivedSource[];
};

const initialLoadState: BuilderLoadState = {
  initial: "idle",
  schemasByDb: {},
  tablesBySchema: {},
  attributes: "idle",
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
  derivedSources: [],
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
        (item: { table: TableRef; columns: Array<{ column_name: string; data_type: string }> }) => ({
          table: item.table.table,
          qualifiedName: `${item.table.database}.${item.table.schema}.${item.table.table}`,
          columns: item.columns.map((c) => ({ name: c.column_name, type: c.data_type })),
        })
      );
      return { side, groups };
    } catch (err) {
      return rejectWithValue(getErrorMessage(err, "Unable to load attributes."));
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
        attributes: state.targetAttributeGroup.columns.map((col) => ({
          target_table: makeTableRef(state.targetAttributeGroup!.qualifiedName),
          target_attribute: col.name,
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
      state.sourceAttributeGroups = [];
      state.mappingSuggestions = [];
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

    addDerivedSource: (state, action: PayloadAction<DerivedSource>) => {
      state.derivedSources.push(action.payload);
    },

    updateDerivedSource: (state, action: PayloadAction<DerivedSource>) => {
      const idx = state.derivedSources.findIndex((s) => s.id === action.payload.id);
      if (idx !== -1) {
        state.derivedSources[idx] = action.payload;
      }
    },

    removeDerivedSource: (state, action: PayloadAction<{ id: string }>) => {
      state.derivedSources = state.derivedSources.filter((s) => s.id !== action.payload.id);
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
            schema.tables = rawTables.map((t: { table_name: string }) => ({
              tableId: `${databaseName}.${schemaName}.${t.table_name}`,
              tableName: t.table_name,
              qualifiedName: `${databaseName}.${schemaName}.${t.table_name}`,
              isSelected: false,
              tag: type === "source" ? "Source" : "Target",
              rows: "--",
              columns: 0,
            }));
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
          state.mappingSuggestions = [];
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
        } else {
          state.targetAttributeGroup = groups[0] ?? null;
        }
        state.loadState.attributes = "success";
      })
      .addCase(fetchAttributes.rejected, (state, action) => {
        state.loadState.attributes = "error";
        state.errorState.attributes = action.payload as string;
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
  addDerivedSource,
  updateDerivedSource,
  removeDerivedSource,
} = sttmBuilderSlice.actions;

export default sttmBuilderSlice.reducer;
