'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { authService } from '@/services/authService';
import { dbService } from '@/services/dbService';
import { workbenchService, type TableRef } from '@/services/workbenchService';
import type { UserSession } from '@/types/user';

type TableNode = {
  tableId: string;
  tableName: string;
  qualifiedName: string;
  isSelected: boolean;
  tag: string;
  rows: string;
  columns: number;
};

type SchemaNode = {
  schemaId: string;
  schemaName: string;
  isSelected: boolean;
  tables: TableNode[];
};

type DatabaseNode = {
  dbId: string;
  dbName: string;
  dbType: 'SNOWFLAKE';
  connectionId: string;
  isSelected: boolean;
  schemas: SchemaNode[];
};

type SourceTargetInfo = {
  dbName: string;
  schemaName: string;
};

type ColumnGroup = {
  table: string;
  qualifiedName: string;
  columns: Array<{
    name: string;
    type: string;
  }>;
};

type MappingSuggestion = {
  targetAttribute: string;
  sourceAttributes: string[];
  confidenceScore: number;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ContextValue = {
  fullData: { sources: DatabaseNode[]; targets: DatabaseNode[] } | null;
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
  session: UserSession | null;
  selectSchema: (type: 'source' | 'target', dbId: string, schemaId: string) => Promise<void>;
  toggleSource: (tableId: string) => void;
  selectTarget: (tableId: string) => void;
  clearSources: () => void;
  clearTargets: () => void;
  runAutoMap: () => Promise<void>;
  sendChatMessage: (message: string) => Promise<void>;
  selectedSourceCount: number;
  mappingCount: number;
};

const SttmBuilderContext = createContext<ContextValue | null>(null);

function makeTableRef(qualifiedName: string): TableRef {
  const [database, schema, table] = qualifiedName.split('.', 3);
  return { database, schema, table };
}

function toBranch(items: Array<{ database_name: string; schemas: Array<{ schema_name: string }> }>): DatabaseNode[] {
  return items.map((database) => ({
    dbId: database.database_name,
    dbName: database.database_name,
    dbType: 'SNOWFLAKE',
    connectionId: database.database_name,
    isSelected: false,
    schemas: database.schemas.map((schema) => ({
      schemaId: `${database.database_name}:${schema.schema_name}`,
      schemaName: schema.schema_name,
      isSelected: false,
      tables: [],
    })),
  }));
}

function cloneBranch(branch: DatabaseNode[]) {
  return branch.map((database) => ({
    ...database,
    schemas: database.schemas.map((schema) => ({
      ...schema,
      tables: schema.tables.map((table) => ({ ...table })),
    })),
  }));
}

export function SttmBuilderProvider({ children }: { children: React.ReactNode }) {
  const [fullData, setFullData] = useState<{ sources: DatabaseNode[]; targets: DatabaseNode[] } | null>(null);
  const [sources, setSources] = useState<TableNode[]>([]);
  const [targets, setTargets] = useState<TableNode[]>([]);
  const [sourceInfo, setSourceInfo] = useState<SourceTargetInfo>({ dbName: '', schemaName: '' });
  const [targetInfo, setTargetInfo] = useState<SourceTargetInfo>({ dbName: '', schemaName: '' });
  const [sourceAttributeGroups, setSourceAttributeGroups] = useState<ColumnGroup[]>([]);
  const [targetAttributeGroup, setTargetAttributeGroup] = useState<ColumnGroup | null>(null);
  const [mappingSuggestions, setMappingSuggestions] = useState<MappingSuggestion[]>([]);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! I'm your STTM AI Assistant. Ask me about mapping, tables, or next steps." },
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [agentThreadId, setAgentThreadId] = useState<string | null>(null);
  const [session, setSession] = useState<UserSession | null>(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [databases, userSession] = await Promise.all([
          dbService.getExplorerData(),
          authService.getSession().catch(() => null),
        ]);
        const branch = toBranch(databases);
        setFullData({
          sources: branch,
          targets: cloneBranch(branch),
        });
        setSession(userSession);
      } catch (error) {
        console.error('Failed to initialize STTM builder context', error);
        setFullData({ sources: [], targets: [] });
      }
    }

    void bootstrap();
  }, []);

  async function selectSchema(type: 'source' | 'target', dbId: string, schemaId: string) {
    if (!fullData) {
      return;
    }

    const [databaseName, schemaName] = schemaId.split(':', 2);
    const tableResponse = await dbService.getSchemaTables(databaseName, schemaName);
    const tables: TableNode[] = tableResponse.map((table: { table_name: string }) => ({
      tableId: `${databaseName}.${schemaName}.${table.table_name}`,
      tableName: table.table_name,
      qualifiedName: `${databaseName}.${schemaName}.${table.table_name}`,
      isSelected: false,
      tag: type === 'source' ? 'Source' : 'Target',
      rows: '--',
      columns: 0,
    }));

    const next = {
      sources: cloneBranch(fullData.sources),
      targets: cloneBranch(fullData.targets),
    };
    const branch = type === 'source' ? next.sources : next.targets;

    branch.forEach((database) => {
      const isActiveDb = database.dbId === dbId;
      database.isSelected = isActiveDb;
      database.schemas.forEach((schema) => {
        schema.isSelected = isActiveDb && schema.schemaId === schemaId;
        if (schema.schemaId === schemaId) {
          schema.tables = tables.map((table) => ({ ...table }));
        }
      });
    });

    setFullData(next);

    if (type === 'source') {
      setSources(tables);
      setSourceInfo({ dbName: databaseName, schemaName });
      setSourceAttributeGroups([]);
      setMappingSuggestions([]);
    } else {
      setTargets(tables);
      setTargetInfo({ dbName: databaseName, schemaName });
      setTargetAttributeGroup(null);
      setMappingSuggestions([]);
    }
  }

  async function refreshSourceAttributes(nextSources: TableNode[]) {
    const selected = nextSources.filter((table) => table.isSelected).map((table) => table.qualifiedName);
    if (!selected.length) {
      setSourceAttributeGroups([]);
      return;
    }

    const attributes = await dbService.getTableAttributes(selected);
    setSourceAttributeGroups(
      attributes.map((item: { table: TableRef; columns: Array<{ column_name: string; data_type: string }> }) => ({
        table: item.table.table,
        qualifiedName: `${item.table.database}.${item.table.schema}.${item.table.table}`,
        columns: item.columns.map((column) => ({
          name: column.column_name,
          type: column.data_type,
        })),
      }))
    );
  }

  async function refreshTargetAttributes(nextTargets: TableNode[]) {
    const selected = nextTargets.find((table) => table.isSelected);
    if (!selected) {
      setTargetAttributeGroup(null);
      return;
    }

    const [attributes] = await dbService.getTableAttributes([selected.qualifiedName]);
    if (!attributes) {
      setTargetAttributeGroup(null);
      return;
    }

    setTargetAttributeGroup({
      table: attributes.table.table,
      qualifiedName: `${attributes.table.database}.${attributes.table.schema}.${attributes.table.table}`,
      columns: attributes.columns.map((column: { column_name: string; data_type: string }) => ({
        name: column.column_name,
        type: column.data_type,
      })),
    });
  }

  function toggleSource(tableId: string) {
    const nextSources = sources.map((table) =>
      table.tableId === tableId ? { ...table, isSelected: !table.isSelected } : table
    );
    setSources(nextSources);
    setMappingSuggestions([]);
    void refreshSourceAttributes(nextSources);
  }

  function selectTarget(tableId: string) {
    const nextTargets = targets.map((table) => ({
      ...table,
      isSelected: table.tableId === tableId,
    }));
    setTargets(nextTargets);
    setMappingSuggestions([]);
    void refreshTargetAttributes(nextTargets);
  }

  function clearSources() {
    const nextSources = sources.map((table) => ({ ...table, isSelected: false }));
    setSources(nextSources);
    setSourceAttributeGroups([]);
    setMappingSuggestions([]);
  }

  function clearTargets() {
    const nextTargets = targets.map((table) => ({ ...table, isSelected: false }));
    setTargets(nextTargets);
    setTargetAttributeGroup(null);
    setMappingSuggestions([]);
  }

  async function runAutoMap() {
    const selectedSourceTables = sources.filter((table) => table.isSelected);
    if (!selectedSourceTables.length || !targetAttributeGroup) {
      return;
    }

    setMappingLoading(true);
    try {
      const response = await workbenchService.invoke({
        interface: 'AUTO_MAP',
        thread_id: agentThreadId,
        source_tables: selectedSourceTables.map((table) => makeTableRef(table.qualifiedName)),
        attributes: targetAttributeGroup.columns.map((column) => ({
          target_table: makeTableRef(targetAttributeGroup.qualifiedName),
          target_attribute: column.name,
          source_mappings: null,
        })),
      });

      setAgentThreadId(response.thread_id);
      const mappingEntries = Object.entries(
        (response.result?.mappings ?? {}) as Record<
          string,
          { source_attributes?: string[]; confidence_score?: number }
        >
      );
      const mappings = mappingEntries.map(([targetAttribute, value]) => ({
          targetAttribute,
          sourceAttributes: value?.source_attributes ?? [],
          confidenceScore: value?.confidence_score ?? 0,
        }));
      setMappingSuggestions(mappings);
      if (response.message) {
        setChatMessages((current) => [...current, { role: 'assistant', content: response.message }]);
      }
    } catch (error) {
      console.error('Failed to run auto-map', error);
    } finally {
      setMappingLoading(false);
    }
  }

  async function sendChatMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    setChatMessages((current) => [...current, { role: 'user', content: trimmed }]);
    setChatLoading(true);
    try {
      const response = await workbenchService.invoke({
        interface: 'CHAT',
        thread_id: agentThreadId,
        message: trimmed,
      });
      setAgentThreadId(response.thread_id);
      setChatMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: response.message ?? 'The agent completed the request without a message.',
        },
      ]);
    } catch (error) {
      console.error('Failed to send STTM chat message', error);
      setChatMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: 'I could not reach the STTM agent just now. Please try again.',
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  const value = useMemo<ContextValue>(
    () => ({
      fullData,
      sources,
      targets,
      sourceInfo,
      targetInfo,
      sourceAttributeGroups,
      targetAttributeGroup,
      mappingSuggestions,
      mappingLoading,
      chatMessages,
      chatLoading,
      session,
      selectSchema,
      toggleSource,
      selectTarget,
      clearSources,
      clearTargets,
      runAutoMap,
      sendChatMessage,
      selectedSourceCount: sources.filter((table) => table.isSelected).length,
      mappingCount: mappingSuggestions.filter((item) => item.sourceAttributes.length > 0).length,
    }),
    [
      fullData,
      sources,
      targets,
      sourceInfo,
      targetInfo,
      sourceAttributeGroups,
      targetAttributeGroup,
      mappingSuggestions,
      mappingLoading,
      chatMessages,
      chatLoading,
      session,
    ]
  );

  return <SttmBuilderContext.Provider value={value}>{children}</SttmBuilderContext.Provider>;
}

export const useSttmBuilderContext = () => {
  const context = useContext(SttmBuilderContext);
  if (!context) {
    throw new Error('useSttmBuilderContext must be used within SttmBuilderProvider');
  }
  return context;
};
