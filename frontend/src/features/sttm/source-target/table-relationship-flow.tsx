"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type Edge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import AllInclusiveIcon from "@mui/icons-material/AllInclusive";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";

import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import type { Column, DerivedSource, JoinConfig, TableMeta } from "@/features/sttm/types/sttm.types";

import { FilterConditions } from "./filter-conditions";
import { JoinModal } from "./join-modal";
import { TableEdge } from "./table-edge";
import { TableNode, type TableNodeData } from "./table-node";
import { AddDerivedModal } from "./add-derived-modal";

const nodeTypes = { tableNode: TableNode };
const edgeTypes = { tableEdge: TableEdge };
const EMPTY_SELECTED_COLUMNS: Record<string, string[]> = {};

function buildHandleId(
  table: { database?: string; schema?: string; name?: string },
  columnName: string,
  index: number,
  kind: "source" | "target"
) {
  return `${table.database}.${table.schema}.${table.name}.${columnName}-${index}-${kind}`;
}

function resolveHandleId(
  table: TableMeta | undefined,
  columnName: string | undefined,
  kind: "source" | "target"
) {
  if (!table || !columnName) return undefined;
  const index = (table.columns ?? []).findIndex((column) => column.name === columnName);
  if (index === -1) return undefined;
  return buildHandleId(table, columnName, index, kind);
}

function parseHandleId(
  handleId: string | null | undefined,
  kind: "source" | "target"
) {
  if (!handleId) return null;
  const suffix = `-${kind}`;
  if (!handleId.endsWith(suffix)) return null;
  const withoutKind = handleId.slice(0, -suffix.length);
  const lastDash = withoutKind.lastIndexOf("-");
  if (lastDash === -1) return null;
  return withoutKind.slice(withoutKind.lastIndexOf(".") + 1, lastDash);
}

function tagChipPalette(tag?: string) {
  const t = (tag || "").toLowerCase();
  if (t.includes("derived")) return { tagBg: "#dcfce3", tagFg: "#166534" };
  if (t.includes("staging")) return { tagBg: "#f3e8ff", tagFg: "#7c3aed" };
  if (t.includes("sales")) return { tagBg: "#dbeafe", tagFg: "#1d4ed8" };
  if (t.includes("core")) return { tagBg: "#f3f4f6", tagFg: "#4b5563" };
  if (t.includes("transaction")) return { tagBg: "#ffedd5", tagFg: "#c2410c" };
  if (t.includes("master")) return { tagBg: "#e0e7ff", tagFg: "#4338ca" };
  if (t.includes("billing") || t.includes("finance")) {
    return { tagBg: "#ecfdf5", tagFg: "#047857" };
  }
  return { tagBg: "#f1f5f9", tagFg: "#475569" };
}

function normalizeColumns(
  columns: Column[] | undefined,
  tableId: string,
  tableName: string
): Column[] {
  return (columns ?? []).map((column) => ({
    ...column,
    tableId: column.tableId ?? tableId,
    tableName: column.tableName ?? tableName,
  }));
}

type TableRelationshipFlowProps = {
  tables?: TableMeta[];
  joins?: JoinConfig[];
  onJoinsChange?: (joins: JoinConfig[]) => void;
  showFilters?: boolean;
  selectableColumns?: boolean;
  selectedColumnsByTable?: Record<string, string[]>;
  onToggleColumn?: (tableId: string, columnName: string, checked: boolean) => void;
  drivingTableId?: string | null;
  allowDerivedEditing?: boolean;
  emptyStateText?: string;
};

export default function SttmTableRelationshipFlow({
  tables,
  joins,
  onJoinsChange,
  showFilters = true,
  selectableColumns = false,
  selectedColumnsByTable = EMPTY_SELECTED_COLUMNS,
  onToggleColumn,
  drivingTableId: controlledDrivingTableId,
  allowDerivedEditing = true,
  emptyStateText = "Select one or more tables from Source selection. They will appear here so you can define joins and relationships.",
}: TableRelationshipFlowProps) {
  const {
    fullData,
    drivingTableId,
    relationships,
    setRelationships,
    derivedSources,
    sourceAttributeGroups,
    updateDerivedSource,
    setSourceFilterConditions,
    sourceFilterGroups,
  } = useSttmBuilderContext();

  const [editingDerivedSource, setEditingDerivedSource] = useState<DerivedSource | null>(null);
  const [isDerivedModalOpen, setIsDerivedModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [editingJoin, setEditingJoin] = useState<JoinConfig | null>(null);
  const effectiveDrivingTableId = controlledDrivingTableId ?? drivingTableId;

  const contextTables: TableMeta[] = useMemo(() => {
    const groupsByQualifiedName = new Map(
      sourceAttributeGroups.map((group) => [group.qualifiedName, group.columns])
    );
    const selectedTables: TableMeta[] = [];

    for (const db of fullData?.sources ?? []) {
      for (const schema of db.schemas ?? []) {
        for (const table of schema.tables ?? []) {
          if (!table.isSelected) continue;

          const qualifiedName = table.qualifiedName;
          const columnItems = normalizeColumns(
            table.columnItems?.length ? table.columnItems : groupsByQualifiedName.get(qualifiedName),
            table.tableId,
            table.tableName
          );
          const chip = tagChipPalette(table.tag);

          selectedTables.push({
            id: table.tableId,
            name: table.tableName,
            schema: schema.schemaName,
            database: db.dbName,
            rowCount: table.rows ?? "—",
            colCount: columnItems.length || table.columns || 0,
            columns: columnItems,
            tag: table.tag ?? "Source",
            tagBg: chip.tagBg,
            tagFg: chip.tagFg,
          });
        }
      }
    }

    const derived: TableMeta[] = (derivedSources || [])
      .filter((source) => source.isSelected)
      .map((source) => {
      const chip = tagChipPalette("Derived");
      return {
        id: source.id,
        name: source.sourceName,
        schema: "DERIVED",
        database: "DERIVED",
        rowCount: "—",
        colCount: source.columns.length,
        columns: normalizeColumns(source.columns, source.id, source.sourceName),
        tag: "Derived",
        tagBg: chip.tagBg,
        tagFg: chip.tagFg,
      };
    });

    return [...selectedTables, ...derived];
  }, [derivedSources, fullData, sourceAttributeGroups]);

  const activeTables = useMemo(() => {
    const source = tables ?? contextTables;
    return source.map((table, idx) => {
      const tableId =
        table.id ?? `${table.database ?? "db"}:${table.schema ?? "schema"}:${table.name ?? idx}`;
      const tag = table.tag ?? "Source";
      const chip = tagChipPalette(tag);
      const tableName = table.name ?? "—";

      return {
        ...table,
        id: tableId,
        tag,
        tagBg: table.tagBg ?? chip.tagBg,
        tagFg: table.tagFg ?? chip.tagFg,
        rowCount: table.rowCount ?? "—",
        colCount: table.colCount ?? table.columns?.length ?? 0,
        columns: normalizeColumns(table.columns, tableId, tableName),
      };
    });
  }, [contextTables, tables]);

  const currentJoins = joins ?? relationships;
  const setJoinState = useCallback(
    (next: JoinConfig[] | ((prev: JoinConfig[]) => JoinConfig[])) => {
      if (onJoinsChange) {
        const resolved = typeof next === "function" ? next(currentJoins) : next;
        onJoinsChange(resolved);
        return;
      }
      setRelationships(typeof next === "function" ? next(currentJoins) : next);
    },
    [currentJoins, onJoinsChange, setRelationships]
  );

  useEffect(() => {
    const ids = new Set(activeTables.map((table) => table.id));
    const filterJoins = (prev: JoinConfig[]) =>
      prev.filter(
        (join) =>
          !!join.leftTableId &&
          !!join.rightTableId &&
          ids.has(join.leftTableId) &&
          ids.has(join.rightTableId)
      );

    if (onJoinsChange) {
      const filtered = filterJoins(currentJoins);
      if (filtered.length !== currentJoins.length) {
        onJoinsChange(filtered);
      }
      return;
    }

    const filtered = filterJoins(currentJoins);
    if (filtered.length !== currentJoins.length) {
      setRelationships(filtered);
    }
  }, [activeTables, currentJoins, onJoinsChange, setRelationships]);

  const initialNodes = useMemo(() => {
    return activeTables.map((table, idx) => ({
      id: table.id as string,
      type: "tableNode",
      position: { x: 40 + idx * 300, y: 48 },
      data: {
        label: table.name ?? "—",
        schema: table.schema ?? "—",
        database: table.database ?? "—",
        tag: table.tag ?? "Source",
        tagBg: table.tagBg ?? "#f1f5f9",
        tagFg: table.tagFg ?? "#475569",
        rowCount: table.rowCount ?? "—",
        colCount: table.colCount ?? table.columns?.length ?? 0,
        columns: table.columns ?? [],
        selectableColumns,
        selectedColumns: selectedColumnsByTable[table.id as string] ?? [],
        onToggleColumn:
          selectableColumns && onToggleColumn
            ? (columnName: string, checked: boolean) =>
                onToggleColumn(table.id as string, columnName, checked)
            : undefined,
        onEdit:
          allowDerivedEditing && table.schema === "DERIVED"
            ? () => {
                const source = derivedSources.find((item) => item.id === table.id);
                if (source) {
                  setEditingDerivedSource(source);
                  setIsDerivedModalOpen(true);
                }
              }
            : undefined,
      } satisfies TableNodeData,
    }));
  }, [
    activeTables,
    allowDerivedEditing,
    derivedSources,
    onToggleColumn,
    selectableColumns,
    selectedColumnsByTable,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  const derivedEdges: Edge[] = useMemo(() => {
    const joinEdges = currentJoins
      .map((join) => {
        const first = join.conditions?.[0];
        if (!join.id || !join.leftTableId || !join.rightTableId || !first) return null;
        if (!first.leftColumn || !first.rightColumn) return null;

        const leftTable = activeTables.find((table) => table.id === join.leftTableId);
        const rightTable = activeTables.find((table) => table.id === join.rightTableId);
        const sourceHandle = resolveHandleId(leftTable, first.leftColumn, "source");
        const targetHandle = resolveHandleId(rightTable, first.rightColumn, "target");
        if (!sourceHandle || !targetHandle) return null;

        return {
          id: join.id,
          source: join.leftTableId,
          target: join.rightTableId,
          sourceHandle,
          targetHandle,
          type: "tableEdge",
          data: {
            joinType: join.joinType ?? "INNER",
            conditionCount: join.conditions?.length ?? 0,
            locked: join.locked ?? false,
            source: join.source ?? "USER_DEFINED",
            onDelete: (id: string) =>
              setJoinState((prev) => prev.filter((item) => item.id !== id)),
            onEdit: (id: string) => {
              const joinToEdit = currentJoins.find((item) => item.id === id);
              if (joinToEdit) {
                setEditingJoin(joinToEdit);
                setIsJoinModalOpen(true);
              }
            },
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#cbd5e1" },
        } satisfies Edge;
      })
      .filter(Boolean) as Edge[];

    const lineageEdges: Edge[] = (derivedSources || [])
      .filter((source) => source.isSelected)
      .flatMap((source) => {
        const sourceTableIds = source.tableIds ?? [];
        return sourceTableIds
          .filter((tableId) => activeTables.some((table) => table.id === tableId))
          .map((tableId, index) => ({
            id: `derived-lineage:${source.id}:${tableId}:${index}`,
            source: tableId,
            target: source.id,
            type: "tableEdge",
            data: {
              joinType: "INNER",
              label: tableId === source.drivingTableId ? "DRIVING → DERIVED" : "SOURCE → DERIVED",
              readOnly: true,
              dashed: true,
              conditionCount: 1,
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#166534" },
          }));
      });

    return [...joinEdges, ...lineageEdges];
  }, [activeTables, currentJoins, derivedSources, setJoinState]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      const leftTableId = params.source;
      const rightTableId = params.target;
      const leftColumn = parseHandleId(params.sourceHandle, "source");
      const rightColumn = parseHandleId(params.targetHandle, "target");

      if (!leftTableId || !rightTableId || !leftColumn || !rightColumn) return;

      const existing = currentJoins.find(
        (join) => join.leftTableId === leftTableId && join.rightTableId === rightTableId
      );
      setEditingJoin(
        existing ?? {
          id: `${leftTableId}__${rightTableId}`,
          leftTableId,
          rightTableId,
          joinType: "INNER",
          source: "USER_DEFINED",
          locked: false,
          conditions: [{ leftColumn, operator: "=", rightColumn }],
        }
      );
      setIsJoinModalOpen(true);
    },
    [currentJoins]
  );

  const joinLegend = [
    { label: "INNER JOIN", bg: "#111827" },
    { label: "LEFT JOIN", bg: "#1e40af" },
    { label: "RIGHT JOIN", bg: "#0d9488" },
    { label: "FULL JOIN", bg: "#9333ea" },
  ];

  const joinCount = currentJoins.length;
  const joinBadgeLabel = joinCount === 1 ? "1 join" : `${joinCount} joins`;

  return (
    <div className="flex flex-col gap-3">
      <div className="canvas-area">
        <div className="canvas-area__header">
          <div className="canvas-area__title">
            <AllInclusiveIcon sx={{ color: "#2563eb", fontSize: 22, flexShrink: 0 }} />
            <span className="canvas-area__title-main">Table Relationships</span>
            <span className="canvas-area__badge">{joinBadgeLabel}</span>
          </div>
          <button
            type="button"
            className="canvas-area__add-btn"
            onClick={() => {
              setEditingJoin(null);
              setIsJoinModalOpen(true);
            }}
            disabled={activeTables.length === 0}
            style={{
              opacity: activeTables.length === 0 ? 0.5 : 1,
              cursor: activeTables.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            + Add Join
          </button>
        </div>

        <div className="canvas-area__flow-host">
          {nodes.length === 0 ? (
            <div className="canvas-area__empty" aria-hidden>
              <div className="canvas-area__empty-inner">{emptyStateText}</div>
            </div>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: "tableEdge",
              animated: true,
            }}
            style={{ width: "100%", height: "100%" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e2e8f0" />
            <Controls position="bottom-right" style={{ marginBottom: 16, marginRight: 16 }} />
          </ReactFlow>
        </div>

        <div className="canvas-legend">
          <div className="canvas-legend__row">
            <span className="canvas-legend__label">LEGEND:</span>
            {joinLegend.map((item) => (
              <span
                key={item.label}
                className="canvas-legend__chip"
                style={{ backgroundColor: item.bg }}
              >
                {item.label}
              </span>
            ))}
            <span className="canvas-legend__hint">
              <span className="canvas-legend__dash" />
              No join — click + Add Join or connect column handles
            </span>
            <span className="canvas-legend__key">
              <KeyIcon sx={{ fontSize: 18, color: "#ca8a04" }} />
              Primary Key
            </span>
            <span className="canvas-legend__key">
              <LinkIcon sx={{ fontSize: 18, color: "#9ca3af" }} />
              Foreign Key
            </span>
          </div>
        </div>
      </div>

      {showFilters ? (
        <FilterConditions
          tables={activeTables}
          initialGroups={sourceFilterGroups}
          onChange={(groups, sql) => setSourceFilterConditions({ groups, sql })}
        />
      ) : null}

      <JoinModal
        isOpen={isJoinModalOpen}
        onClose={() => {
          setIsJoinModalOpen(false);
          setEditingJoin(null);
        }}
        tables={activeTables}
        drivingTableIdOverride={effectiveDrivingTableId}
        editingJoin={editingJoin}
          onConfirm={(join: JoinConfig) => {
            setJoinState((prev) => {
              const next = prev.filter((item) => item.id !== join.id);
              return [
                ...next,
                {
                  ...join,
                  source: join.source ?? "USER_DEFINED",
                  locked: join.locked ?? false,
                },
              ];
            });
          }}
        />

      {allowDerivedEditing ? (
        <AddDerivedModal
          isOpen={isDerivedModalOpen}
          onClose={() => {
            setIsDerivedModalOpen(false);
            setEditingDerivedSource(null);
          }}
          editingSource={editingDerivedSource}
          onConfirm={(source) => {
            updateDerivedSource(source);
            setIsDerivedModalOpen(false);
            setEditingDerivedSource(null);
          }}
        />
      ) : null}
    </div>
  );
}
