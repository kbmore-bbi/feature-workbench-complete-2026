"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddIcon, AllInclusiveIcon, KeyIcon, LinkIcon } from '@/utils/icons';
import { AiaResizeHandle } from '@/components/ui';
import { AIA_RESIZE_HANDLE_THICKNESS } from '@/components/ui/aia-resize-handle';
import { AiaButton } from '@/components/ui/aia-button';
import { AiaChip } from '@/components/ui/aia-chip';
import { AiaText } from '@/components/ui/aia-text';
import { textStyleCssVars } from '@/config/typography-tokens';
import {
  MarkerType,
  type Connection,
  type Edge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";




import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { resolveSelectedSourceTables } from "@/features/sttm/shared/sttm-selection-utils";
import type { Column, DerivedSource, JoinConfig, TableMeta } from "@/features/sttm/types/sttm.types";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";

import { FilterConditions } from "./filter-conditions";
import { JoinModal } from "./join-modal";
import { TableNode, type TableNodeData } from "./table-node";
import { AddDerivedModal } from "./add-derived-modal";
import { RelationshipFlowView } from "./relationship-flow-view";
import {
  isTableHeaderHandle,
  resolveTableHeaderHandleId,
} from "./relationship-handles";
import {
  buildRelationshipLayout,
  mergeRelationshipNodePositions,
  RELATIONSHIP_LAYOUT_FULL,
} from "./relationship-layout";
const EMPTY_SELECTED_COLUMNS: Record<string, string[]> = {};
const CANVAS_AREA_MIN_HEIGHT = 660;
const CANVAS_FLOW_HOST_DEFAULT_HEIGHT = 560;

function renderSqlTableReference(table: TableMeta) {
  return `${table.database ?? ""}.${table.schema ?? ""}.${table.name ?? ""}`.replace(/\.+/g, ".");
}

function buildRelationshipQuery(
  tables: TableMeta[],
  joins: JoinConfig[],
  drivingTableId: string | null | undefined,
  tableReference: (table: TableMeta) => string = renderSqlTableReference,
) {
  if (!tables.length) return "";
  const tableById = new Map(tables.map((table) => [table.id as string, table]));
  const seedTable =
    (drivingTableId ? tableById.get(drivingTableId) : undefined) ??
    (joins[0]?.leftTableId ? tableById.get(joins[0].leftTableId) : undefined) ??
    tables[0];
  if (!seedTable) return "";
  const columnReference = (table: TableMeta, column: string) => `${tableReference(table)}.${column}`;
  const lines = ["SELECT", "  *", `FROM ${tableReference(seedTable)}`];
  const visited = new Set<string>([seedTable.id as string]);
  const remaining = [...joins];
  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((join) => {
      const leftVisited = !!join.leftTableId && visited.has(join.leftTableId);
      const rightVisited = !!join.rightTableId && visited.has(join.rightTableId);
      return leftVisited !== rightVisited;
    });
    if (nextIndex === -1) break;
    const [join] = remaining.splice(nextIndex, 1);
    const leftTable = join.leftTableId ? tableById.get(join.leftTableId) : undefined;
    const rightTable = join.rightTableId ? tableById.get(join.rightTableId) : undefined;
    if (!leftTable || !rightTable) continue;
    const attachRight = visited.has(join.leftTableId as string) && !visited.has(join.rightTableId as string);
    const attachingTable = attachRight ? rightTable : leftTable;
    const validConditions = (join.conditions ?? []).filter(
      (condition) => condition.leftColumn && condition.rightColumn,
    );
    if (!validConditions.length) continue;
    lines.push(`${join.joinType ?? "INNER"} JOIN ${tableReference(attachingTable)}`);
    lines.push(
      `  ON ${validConditions.map((condition) =>
        `${columnReference(leftTable, condition.leftColumn as string)} ${condition.operator ?? "="} ${columnReference(rightTable, condition.rightColumn as string)}`,
      ).join("\n  AND ")}`,
    );
    visited.add(attachingTable.id as string);
  }
  return lines.join("\n");
}

function orientJoinToDrivingLeft(join: JoinConfig, drivingTableId: string): JoinConfig {
  if (join.rightTableId !== drivingTableId || join.leftTableId === drivingTableId) return join;
  return {
    ...join,
    leftTableId: join.rightTableId,
    rightTableId: join.leftTableId,
    joinType: join.joinType === "LEFT" ? "RIGHT" : join.joinType === "RIGHT" ? "LEFT" : join.joinType,
    conditions: (join.conditions ?? []).map((condition) => ({
      ...condition,
      leftColumn: condition.rightColumn,
      rightColumn: condition.leftColumn,
    })),
  };
}

function parseHandleId(
  handleId: string | null | undefined,
  kind: "source" | "target"
) {
  if (!handleId) return null;
  const suffix = `-${kind}`;
  if (!handleId.endsWith(suffix)) return null;
  const withoutKind = handleId.slice(0, -suffix.length);
  const columnPart = withoutKind.slice(withoutKind.lastIndexOf(".") + 1);
  return columnPart.replace(/-\d+$/, "");
}

function tagChipPalette(tag?: string) {
  const t = (tag || "").toLowerCase();
  if (t.includes("driving")) return { tagBg: "#fef3c7", tagFg: "#854d0e" };
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
  const uniqueColumns = new Map<string, Column>();
  (columns ?? []).forEach((column, index) => {
    const normalized = {
      ...column,
      tableId: column.tableId ?? tableId,
      tableName: column.tableName ?? tableName,
    };
    const columnName = String(column.name ?? "").trim();
    const key = columnName ? columnName.toUpperCase() : `__UNNAMED_${index}`;
    const existing = uniqueColumns.get(key);
    uniqueColumns.set(
      key,
      existing
        ? {
            ...existing,
            ...normalized,
            isPrimaryKey: Boolean(existing.isPrimaryKey || normalized.isPrimaryKey),
            isForeignKey: Boolean(existing.isForeignKey || normalized.isForeignKey),
            selected: Boolean(existing.selected || normalized.selected),
          }
        : normalized,
    );
  });
  return [...uniqueColumns.values()];
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
    sources,
    drivingTableId,
    relationships,
    setRelationships,
    relationshipCandidates,
    approveRelationshipCandidate,
    rejectRelationshipCandidate,
    derivedSources,
    sourceAttributeGroups,
    updateDerivedSource,
    setSourceFilterConditions,
    sourceFilterGroups,
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
    sourceQuerySql,
    refreshAssistantSignals,
  } = useSttmBuilderContext();

  const [editingDerivedSource, setEditingDerivedSource] = useState<DerivedSource | null>(null);
  const [isDerivedModalOpen, setIsDerivedModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [flowHostHeight, setFlowHostHeight] = useState(CANVAS_FLOW_HOST_DEFAULT_HEIGHT);
  const headerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);

  const resolveMinFlowHostHeight = useCallback(() => {
    const headerHeight = headerRef.current?.offsetHeight ?? 48;
    const legendHeight = legendRef.current?.offsetHeight ?? 58;
    return Math.max(
      160,
      CANVAS_AREA_MIN_HEIGHT - headerHeight - legendHeight - AIA_RESIZE_HANDLE_THICKNESS,
    );
  }, []);

  const handleCanvasResizeMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = flowHostHeight;
      const minHeight = resolveMinFlowHostHeight();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const nextHeight = startHeight + (moveEvent.clientY - startY);
        setFlowHostHeight(Math.max(minHeight, nextHeight));
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [flowHostHeight, resolveMinFlowHostHeight],
  );
  const [editingJoin, setEditingJoin] = useState<JoinConfig | null>(null);
  const effectiveDrivingTableId = controlledDrivingTableId ?? drivingTableId;

  const contextTables: TableMeta[] = useMemo(() => {
    const groupsByQualifiedName = new Map(
      sourceAttributeGroups.map((group) => [group.qualifiedName, group.columns])
    );
    const selectedTables: TableMeta[] = [];

    for (const table of resolveSelectedSourceTables({
      sourceDatabases: fullData?.sources ?? [],
      sources,
    })) {
      const qualifiedName = table.qualifiedName;
      const [database = "", schema = ""] = qualifiedName.split(".");
      const columnItems = normalizeColumns(
        table.columnItems?.length ? table.columnItems : groupsByQualifiedName.get(qualifiedName),
        table.tableId,
        table.tableName
      );
      const chip = tagChipPalette(table.tag);

      selectedTables.push({
        id: table.tableId,
        name: table.tableName,
        schema,
        database,
        rowCount: table.rows ?? "—",
        colCount: columnItems.length || table.columns || 0,
        columns: columnItems,
        tag: table.tag ?? "Source",
        tagBg: chip.tagBg,
        tagFg: chip.tagFg,
      });
    }

    const derived: TableMeta[] = (derivedSources || [])
      .filter((source) => source.isSelected)
      .map((source) => {
        const chip = tagChipPalette("Derived");
        const columns = normalizeColumns(source.columns, source.id, source.sourceName);
        return {
          id: source.id,
          name: source.sourceName,
          schema: "DERIVED",
          database: "DERIVED",
          rowCount: "—",
          colCount: columns.length,
          columns,
          tag: "Derived",
          tagBg: chip.tagBg,
          tagFg: chip.tagFg,
        };
      });

    return [...selectedTables, ...derived];
  }, [derivedSources, fullData, sourceAttributeGroups, sources]);

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
    if (!effectiveDrivingTableId || !currentJoins.some((join) => join.rightTableId === effectiveDrivingTableId)) {
      return;
    }
    setJoinState(currentJoins.map((join) => orientJoinToDrivingLeft(join, effectiveDrivingTableId)));
  }, [currentJoins, effectiveDrivingTableId, setJoinState]);

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

  const layoutPositions = useMemo(
    () =>
      buildRelationshipLayout(
        activeTables.map((table) => table.id as string),
        effectiveDrivingTableId,
        currentJoins,
        RELATIONSHIP_LAYOUT_FULL,
      ),
    [activeTables, currentJoins, effectiveDrivingTableId],
  );

  const initialNodes = useMemo(() => {
    return activeTables.map((table) => {
      const isDriving = table.id === effectiveDrivingTableId;
      const chip = tagChipPalette(table.tag ?? "Source");

      return {
      id: table.id as string,
      type: "tableNode",
      position: layoutPositions[table.id as string] ?? { x: 48, y: 48 },
      data: {
        label: table.name ?? "—",
        schema: table.schema ?? "—",
        database: table.database ?? "—",
        tag: isDriving ? "Driving" : table.tag ?? "Source",
        tagBg: table.tagBg ?? chip.tagBg,
        tagFg: table.tagFg ?? chip.tagFg,
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
    };
    });
  }, [
    activeTables,
    allowDerivedEditing,
    derivedSources,
    effectiveDrivingTableId,
    layoutPositions,
    onToggleColumn,
    selectableColumns,
    selectedColumnsByTable,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    setNodes((previousNodes) =>
      mergeRelationshipNodePositions(
        initialNodes,
        previousNodes,
        layoutPositions,
        RELATIONSHIP_LAYOUT_FULL,
        {
          joins: currentJoins,
          drivingTableId: effectiveDrivingTableId,
        },
      ),
    );
  }, [currentJoins, effectiveDrivingTableId, initialNodes, layoutPositions, setNodes]);

  const derivedEdges: Edge[] = useMemo(() => {
    const joinEdges = currentJoins
      .map((join) => {
        const first = join.conditions?.[0];
        if (!join.id || !join.leftTableId || !join.rightTableId || !first) return null;
        if (!first.leftColumn || !first.rightColumn) return null;

        const leftTable = activeTables.find((table) => table.id === join.leftTableId);
        const rightTable = activeTables.find((table) => table.id === join.rightTableId);
        const sourceHandle = resolveTableHeaderHandleId(leftTable, "source");
        const targetHandle = resolveTableHeaderHandleId(rightTable, "target");
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
      const fromHeader =
        isTableHeaderHandle(params.sourceHandle) || isTableHeaderHandle(params.targetHandle);

      if (!leftTableId || !rightTableId) return;
      if (!fromHeader && (!leftColumn || !rightColumn)) return;

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
          conditions:
            leftColumn && rightColumn
              ? [{ leftColumn, operator: "=", rightColumn }]
              : [{ leftColumn: "", operator: "=", rightColumn: "" }],
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
  const queryPreviewSql = useMemo(() => {
    return buildRelationshipQuery(activeTables, currentJoins, effectiveDrivingTableId);
  }, [activeTables, currentJoins, effectiveDrivingTableId]);

  const expandedPreview = useMemo(() => {
    const selectedDerived = (derivedSources ?? []).filter(
      (source) => source.isSelected && source.sqlText?.trim() && activeTables.some((table) => table.id === source.id),
    );
    if (!selectedDerived.length) return null;
    const aliases = new Map<string, string>();
    const used = new Set<string>();
    for (const source of selectedDerived) {
      const base = `derived_${(source.sourceName || source.id).replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([^a-zA-Z_])/, "_$1")}`;
      let alias = base;
      let suffix = 2;
      while (used.has(alias.toLowerCase())) alias = `${base}_${suffix++}`;
      used.add(alias.toLowerCase());
      aliases.set(source.id, alias);
    }
    const query = buildRelationshipQuery(
      activeTables,
      currentJoins,
      effectiveDrivingTableId,
      (table) => aliases.get(table.id as string) ?? renderSqlTableReference(table),
    );
    const ctes = selectedDerived.map((source) => {
      const sql = (source.sqlText ?? "").trim().replace(/;\s*$/, "");
      return `${aliases.get(source.id)} AS (\n${sql.split("\n").map((line) => `  ${line}`).join("\n")}\n)`;
    });
    const replacements = Object.fromEntries(
      selectedDerived.map((source) => [`DERIVED.DERIVED.${source.sourceName}`, aliases.get(source.id) as string]),
    );
    return { sql: `WITH\n${ctes.join(",\n")}\n${query}`, replacements };
  }, [activeTables, currentJoins, derivedSources, effectiveDrivingTableId]);

  useEffect(() => {
    if (queryPreviewSql === sourceQuerySql) {
      return;
    }

    setSourceFilterConditions({
      sql: sourceFilterSql,
      groups: sourceFilterGroups,
      baseSql: queryPreviewSql,
      groupBySql: sourceGroupBySql,
      orderBySql: sourceOrderBySql,
    });
  }, [
    queryPreviewSql,
    setSourceFilterConditions,
    sourceFilterGroups,
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
    sourceQuerySql,
  ]);

  return (
    <div className="flex w-full flex-col gap-3">
      {relationshipCandidates.length > 0 ? (
        <section
          aria-label="Relationship candidates needing review"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <AiaText sx={{ fontWeight: 700, color: "#92400e" }}>
              Needs review ({relationshipCandidates.length})
            </AiaText>
            <AiaText sx={{ fontSize: 12, color: "#78350f" }}>
              Semantic candidates are excluded from SQL until approved.
            </AiaText>
          </div>
          <div className="flex flex-col gap-2">
            {relationshipCandidates.map((candidate) => (
              <div
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-semibold text-slate-800">
                    {candidate.leftTableId} → {candidate.rightTableId}
                  </div>
                  <div className="break-words text-xs text-slate-600">
                    {(candidate.conditions ?? [])
                      .map((condition) => `${condition.leftColumn ?? "?"} ${condition.operator ?? "="} ${condition.rightColumn ?? "?"}`)
                      .join(" AND ") || "Columns require review"}
                    {candidate.confidence != null
                      ? ` · ${Math.round(candidate.confidence * 100)}% confidence`
                      : ""}
                    {candidate.reviewReason ? ` · ${candidate.reviewReason}` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <AiaButton size="small" variant="outlined" onClick={() => rejectRelationshipCandidate(String(candidate.id))}>
                    Reject
                  </AiaButton>
                  <AiaButton size="small" variant="contained" onClick={() => approveRelationshipCandidate(String(candidate.id))}>
                    Approve
                  </AiaButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="canvas-area">
        <div ref={headerRef} className="canvas-area__header">
          <div className="canvas-area__title">
            <AllInclusiveIcon
              sx={{
                fontSize: "calc(var(--aia-card-title-font-size) + 2px)",
                color: "var(--aia-card-title-color)",
                flexShrink: 0,
              }}
              aria-hidden
            />
            <AiaText
              sx={{
                ...textStyleCssVars("cardTitle"),
                textTransform: "capitalize",
                letterSpacing: "-0.01em",
              }}
            >
              Table relationships
            </AiaText>
            <AiaChip size="small" color="primary" label={joinBadgeLabel} />
          </div>
          <AiaButton
            data-tour={TOUR_TARGETS.sttmAddJoin}
            size="small"
            variant="outlined"
            startIcon={<AddIcon sx={{ fontSize: 18 }} />}
            onClick={() => {
              setEditingJoin(null);
              setIsJoinModalOpen(true);
            }}
            disabled={activeTables.length === 0}
            sx={{ minWidth: 0, boxShadow: "none" }}
            customBorderColor="var(--aia-state-success-color)"
            customColor="var(--aia-state-success-color)"
            customHoverBackgroundColor="var(--aia-state-success-hover-bg)"
          >
            Add Join
          </AiaButton>
        </div>

        <div className="canvas-area__flow-host" style={{ height: flowHostHeight }}>
          {nodes.length === 0 ? (
            <div className="canvas-area__empty" aria-hidden>
              <div className="canvas-area__empty-inner">{emptyStateText}</div>
            </div>
          ) : null}
          <RelationshipFlowView
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
          />
        </div>

        <AiaResizeHandle
          className="canvas-area__resize-handle"
          direction="vertical"
          onMouseDown={handleCanvasResizeMouseDown}
        />

        <div ref={legendRef} className="canvas-legend">
          <div className="canvas-legend__row">
            <span className="canvas-legend__label">LEGEND:</span>
            {joinLegend.map((item) => (
              <AiaChip
                key={item.label}
                label={item.label}
                size="small"
                customColor={item.bg}
                customBackgroundColor={`color-mix(in srgb, ${item.bg} 12%, #ffffff)`}
                customBorderColor={`color-mix(in srgb, ${item.bg} 30%, #ffffff)`}
              />
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
          previewSql={queryPreviewSql}
          expandedPreviewSql={expandedPreview?.sql}
          expandedReferenceReplacements={expandedPreview?.replacements}
          relationships={currentJoins}
          drivingTableId={effectiveDrivingTableId}
          onChange={(groups, sql) =>
            setSourceFilterConditions({
              groups,
              sql,
              baseSql: queryPreviewSql,
            })
          }
          onQueryChange={(payload) =>
            setSourceFilterConditions({
              groups: payload.groups,
              sql: payload.whereSql,
              baseSql: queryPreviewSql,
              groupBySql: payload.groupBySql,
              orderBySql: payload.orderBySql,
            })
          }
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
            window.setTimeout(() => refreshAssistantSignals("join_completed"), 0);
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
