"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  MarkerType,
  type Connection,
  type Edge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  Box,
  Dialog,
  IconButton,
  InputBase,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import AddCircleOutlineRoundedIcon from "@mui/icons-material/AddCircleOutlineRounded";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";

import { dbService } from "@/services/dbService";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { FocusButton } from "@/components/ui/focus-button";
import { FocusTable } from "@/components/ui/focus-table/focus-table";
import { SqlEditor, SQL_EDITOR_DERIVED_HEIGHT } from "@/components/sql";
import { FilterConditions, type RuleGroup } from "./filter-conditions";
import { JoinModal } from "./join-modal";
import {
  hydrateBuilderFromSql,
  suggestBusinessName,
  type ComputedColumn,
  type DetectedFunction,
} from "./sql-hydration";
import { TableEdge } from "./table-edge";
import { TableNode, type TableNodeData } from "./table-node";
import { RelationshipFlowView } from "./relationship-flow-view";
import {
  buildRelationshipLayout,
  mergeRelationshipNodePositions,
  RELATIONSHIP_LAYOUT_COMPACT,
} from "./relationship-layout";
import type {
  Column,
  DerivedSource,
  JoinConfig,
  PendingDerivedSourceDraft,
  TableMeta,
} from "@/features/sttm/types/sttm.types";

const nodeTypes = { tableNode: TableNode };
const edgeTypes = { tableEdge: TableEdge };

function buildRelationshipHandleId(
  table: { database?: string; schema?: string; name?: string },
  columnName: string,
  _index: number,
  kind: "source" | "target"
) {
  return `${table.database}.${table.schema}.${table.name}.${columnName}-${kind}`;
}

function resolveRelationshipHandleId(
  table: TableMeta | undefined,
  columnName: string | undefined,
  kind: "source" | "target"
) {
  if (!table || !columnName) return undefined;
  const index = (table.columns ?? []).findIndex((column) => column.name === columnName);
  if (index === -1) return undefined;
  return buildRelationshipHandleId(table, columnName, index, kind);
}

function parseRelationshipHandleId(
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

interface AddDerivedModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingSource?: DerivedSource | null;
  draftSource?: PendingDerivedSourceDraft | null;
  onConfirm: (source: DerivedSource) => void;
}

function tagChipPalette(tag?: string) {
  const t = (tag || "").toLowerCase();
  if (t.includes("derived")) return { tagBg: "#dcfce3", tagFg: "#166534" };
  return { tagBg: "#f1f5f9", tagFg: "#475569" };
}

function isDerivedTableMeta(table: TableMeta | undefined) {
  return table?.tag?.toLowerCase().includes("derived") ?? false;
}

function buildAlias(table: TableMeta, index: number) {
  const base = (table.name ?? `t${index + 1}`)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return (base || `t${index + 1}`).slice(0, 18);
}

function normalizeColumns(columns: Column[] | undefined, table: TableMeta): Column[] {
  return (columns ?? []).map((column) => ({
    ...column,
    tableId: column.tableId ?? (table.id as string),
    tableName: column.tableName ?? table.name,
  }));
}

function toTableRef(tableId: string) {
  const [database, schema, table] = tableId.split(".", 3);
  return { database, schema, table };
}

function indentSqlBlock(sqlText: string) {
  return sqlText
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function toRelationshipPayload(join: JoinConfig) {
  return {
    id: join.id,
    left_table: toTableRef(join.leftTableId as string),
    right_table: toTableRef(join.rightTableId as string),
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
  };
}

function orientJoinAroundDrivingTable(
  join: JoinConfig,
  drivingTableId: string | null
): JoinConfig {
  if (!drivingTableId) {
    return join;
  }
  if (join.leftTableId === drivingTableId || join.rightTableId !== drivingTableId) {
    return join;
  }

  return {
    ...join,
    leftTableId: join.rightTableId,
    rightTableId: join.leftTableId,
    conditions: (join.conditions ?? []).map((condition) => ({
      leftColumn: condition.rightColumn,
      operator: condition.operator ?? "=",
      rightColumn: condition.leftColumn,
    })),
  };
}

function joinSignature(join: JoinConfig) {
  const conditions = (join.conditions ?? [])
    .map(
      (condition) =>
        `${condition.leftColumn ?? ""}:${condition.operator ?? "="}:${condition.rightColumn ?? ""}`
    )
    .sort()
    .join("|");
  return `${join.leftTableId ?? ""}->${join.rightTableId ?? ""}:${join.joinType ?? "INNER"}:${conditions}`;
}

export function AddDerivedModal({
  isOpen,
  onClose,
  editingSource,
  draftSource,
  onConfirm,
}: AddDerivedModalProps) {
  const { fullData, drivingTableId, relationships, sourceAttributeGroups, derivedSources } = useSttmBuilderContext();

  const availableTables = useMemo<TableMeta[]>(() => {
    const groupsByQualifiedName = new Map(
      sourceAttributeGroups.map((group) => [group.qualifiedName, group.columns])
    );
    const selectedTables: TableMeta[] = [];

    for (const db of fullData?.sources ?? []) {
      for (const schema of db.schemas ?? []) {
        for (const table of schema.tables ?? []) {
          if (!table.isSelected) continue;
          const qualifiedName = table.qualifiedName;
          const columns = normalizeColumns(
            table.columnItems?.length ? table.columnItems : groupsByQualifiedName.get(qualifiedName),
            {
              id: table.tableId,
              name: table.tableName,
              schema: schema.schemaName,
              database: db.dbName,
            }
          );
          selectedTables.push({
            id: table.tableId,
            name: table.tableName,
            schema: schema.schemaName,
            database: db.dbName,
            rowCount: table.rows ?? "—",
            colCount: columns.length || table.columns || 0,
            columns,
            tag: "Source",
          });
        }
      }
    }

    const derivedTables: TableMeta[] = (derivedSources ?? [])
      .filter((source) => source.isSelected)
      .map((source) => ({
        id: source.id,
        name: source.sourceName,
        schema: "DERIVED",
        database: "DERIVED",
        rowCount: "—",
        colCount: source.columns.length,
        columns: normalizeColumns(source.columns, {
          id: source.id,
          name: source.sourceName,
          schema: "DERIVED",
          database: "DERIVED",
        }),
        tag: "Derived",
      }));

    return [...selectedTables, ...derivedTables];
  }, [derivedSources, fullData, sourceAttributeGroups]);

  const derivedSourceMap = useMemo(
    () => new Map((derivedSources ?? []).map((source) => [source.id, source])),
    [derivedSources]
  );

  const isDerivedSourceId = (tableId: string) => derivedSourceMap.has(tableId);

  const getPhysicalSourceTableIds = (tableIds: string[]) => {
    const visited = new Set<string>();
    const resolved = new Set<string>();

    const visit = (tableId: string) => {
      if (visited.has(tableId)) return;
      visited.add(tableId);

      const derivedSource = derivedSourceMap.get(tableId);
      if (!derivedSource) {
        resolved.add(tableId);
        return;
      }

      for (const nestedTableId of derivedSource.tableIds ?? []) {
        visit(nestedTableId);
      }
    };

    for (const tableId of tableIds) {
      visit(tableId);
    }

    return Array.from(resolved);
  };

  const renderSqlSourceReference = (table: TableMeta, alias: string) => {
    const derivedSource = derivedSourceMap.get(table.id as string);
    if (!derivedSource) {
      return `${table.database}.${table.schema}.${table.name} ${alias}`;
    }

    const sqlText = derivedSource.sqlText?.trim() || `SELECT * FROM ${table.name}`;
    return `(\n${indentSqlBlock(sqlText)}\n) ${alias}`;
  };

  const [sourceName, setSourceName] = useState("");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [selectedColumnsByTable, setSelectedColumnsByTable] = useState<Record<string, string[]>>({});
  const [joins, setJoins] = useState<JoinConfig[]>([]);
  const [drivingTable, setDrivingTable] = useState<string | null>(null);
  const [filterGroups, setFilterGroups] = useState<RuleGroup[]>([]);
  const [filterSql, setFilterSql] = useState("");
  const [customSql, setCustomSql] = useState("");
  const [activeTab, setActiveTab] = useState<"SQL" | "Preview">("SQL");
  const [detectedFunctions, setDetectedFunctions] = useState<DetectedFunction[]>([]);
  const [computedColumns, setComputedColumns] = useState<ComputedColumn[]>([]);
  const [queryClauses, setQueryClauses] = useState<{
    groupBy: string[];
    having: string | null;
    orderBy: string[];
  }>({ groupBy: [], having: null, orderBy: [] });
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [editingJoin, setEditingJoin] = useState<JoinConfig | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewColumnsState, setPreviewColumnsState] = useState<
    Array<{ name: string; dataType: string; isPrimaryKey?: boolean }>
  >([]);
  const [previewRowsState, setPreviewRowsState] = useState<Array<Record<string, unknown>>>([]);
  const [validationState, setValidationState] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const applySqlHydration = (
    sqlText: string,
    options?: { preserveManualName?: boolean; fallbackTableIds?: string[]; fallbackDriving?: string | null }
  ) => {
    const hydrated = hydrateBuilderFromSql(sqlText, availableTables);
    if (!hydrated) {
      setValidationState({
        type: "error",
        message: "We could not fully map this SQL back into the visual builder. You can still edit the SQL directly.",
      });
      return;
    }

    const nextTableIds =
      hydrated.selectedTableIds.length > 0
        ? hydrated.selectedTableIds
        : options?.fallbackTableIds ?? selectedTableIds;
    const nextDriving =
      hydrated.drivingTableId ??
      options?.fallbackDriving ??
      nextTableIds[0] ??
      null;

    setSelectedTableIds(nextTableIds);
    setDrivingTable(nextDriving);
    setSelectedColumnsByTable((prev) =>
      Object.keys(hydrated.selectedColumnsByTable).length > 0
        ? hydrated.selectedColumnsByTable
        : prev
    );
    setJoins(hydrated.joins.length > 0 ? hydrated.joins.map((join) => orientJoinAroundDrivingTable(join, nextDriving)) : []);
    setFilterGroups(hydrated.filterGroups);
    setDetectedFunctions(hydrated.detectedFunctions);
    setComputedColumns(hydrated.computedColumns);
    setQueryClauses(hydrated.clauses);

    if (!options?.preserveManualName) {
      const suggestedName = suggestBusinessName(
        draftSource?.requestSummary ?? sourceName,
        availableTables.filter((table) => nextTableIds.includes(table.id as string)),
      );
      setSourceName((prev) => {
        if (editingSource?.sourceName) return editingSource.sourceName;
        if (draftSource?.sourceNameSuggestion && draftSource.sourceNameSuggestion.trim()) {
          return suggestBusinessName(
            draftSource.requestSummary ?? draftSource.sourceNameSuggestion,
            availableTables.filter((table) => nextTableIds.includes(table.id as string)),
          );
        }
        return prev.trim() ? prev : suggestedName;
      });
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const fallbackDriving =
      (drivingTableId && availableTables.find((table) => table.id === drivingTableId)?.id) ||
      availableTables[0]?.id ||
      null;
    const initialTableIds = editingSource?.tableIds?.length
      ? editingSource.tableIds
      : draftSource?.selectedTableIds?.length
        ? draftSource.selectedTableIds
        : fallbackDriving
          ? [fallbackDriving]
          : [];

    const initialSelectedColumns =
      editingSource?.columns?.length
        ? editingSource.columns.reduce<Record<string, string[]>>((acc, column) => {
            const tableId = column.tableId;
            const columnName = column.name;
            if (!tableId || !columnName) return acc;
            acc[tableId] = [...(acc[tableId] ?? []), columnName];
            return acc;
          }, {})
        : draftSource?.selectedColumnsByTable && Object.keys(draftSource.selectedColumnsByTable).length
          ? draftSource.selectedColumnsByTable
          : Object.fromEntries(initialTableIds.map((tableId) => [tableId, []]));

    setSourceName(
      editingSource?.sourceName ??
        draftSource?.sourceNameSuggestion ??
        suggestBusinessName(draftSource?.requestSummary, availableTables.filter((table) => initialTableIds.includes(table.id as string)))
    );
    setSelectedTableIds(initialTableIds);
    setSelectedColumnsByTable(initialSelectedColumns);
    setJoins(editingSource?.joins ?? []);
    setDrivingTable(editingSource?.drivingTableId ?? draftSource?.drivingTableId ?? fallbackDriving);
    setFilterGroups(editingSource?.filters ?? []);
    setFilterSql("");
    setCustomSql(editingSource?.sqlText ?? draftSource?.sqlText ?? "");
    setDetectedFunctions([]);
    setComputedColumns([]);
    setQueryClauses({ groupBy: [], having: null, orderBy: [] });
    setActiveTab("SQL");
    setEditingJoin(null);
    setIsJoinModalOpen(false);
    setPreviewColumnsState(
      editingSource?.previewColumns?.map((column) => ({
        name: column.name,
        dataType: column.dataType,
        isPrimaryKey: column.isPrimaryKey,
      })) ?? []
    );
    setPreviewRowsState(editingSource?.previewRows ?? []);
    setValidationState(null);

    const sqlSeed = editingSource?.sqlText ?? draftSource?.sqlText ?? "";
    if (sqlSeed.trim()) {
      queueMicrotask(() => {
        applySqlHydration(sqlSeed, {
          fallbackTableIds: initialTableIds,
          fallbackDriving: editingSource?.drivingTableId ?? draftSource?.drivingTableId ?? fallbackDriving,
        });
      });
    }
  }, [availableTables, drivingTableId, draftSource, editingSource, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setPreviewColumnsState((prev) => (prev.length ? [] : prev));
    setPreviewRowsState((prev) => (prev.length ? [] : prev));
    setValidationState((prev) =>
      prev?.type === "success"
        ? { type: "success", message: "SQL changed. Re-run validation to refresh the preview." }
        : prev
    );
  }, [customSql, drivingTable, filterGroups, joins, selectedColumnsByTable, selectedTableIds, isOpen]);

  const selectedTables = useMemo(() => {
    return availableTables.filter((table) => selectedTableIds.includes(table.id as string));
  }, [availableTables, selectedTableIds]);

  const cachedRelationships = useMemo(() => {
    const selectedIdSet = new Set(selectedTableIds);
    return relationships.filter(
      (join) =>
        !!join.leftTableId &&
        !!join.rightTableId &&
        selectedIdSet.has(join.leftTableId) &&
        selectedIdSet.has(join.rightTableId)
    );
  }, [relationships, selectedTableIds]);

  useEffect(() => {
    let cancelled = false;

    const loadRelationships = async () => {
      const physicalSelectedTableIds = selectedTableIds.filter(
        (tableId) => !isDerivedSourceId(tableId)
      );

      if (physicalSelectedTableIds.length < 2) {
        setJoins((prev) => prev.filter((join) => !join.locked));
        return;
      }

      if (cachedRelationships.length > 0) {
        setJoins((prev) => {
          const manual = prev.filter((join) => !join.locked);
          const auto = cachedRelationships.map((join) =>
            orientJoinAroundDrivingTable(
              {
                ...join,
                locked: join.locked ?? true,
                source: join.source ?? "FOREIGN_KEY",
              },
              drivingTable
            )
          );
          const manualSignatures = new Set(manual.map(joinSignature));
          return [...manual, ...auto.filter((join) => !manualSignatures.has(joinSignature(join)))];
        });
        return;
      }

      try {
        const relationships = await dbService.getTableRelationships(
          physicalSelectedTableIds.map((tableId) => toTableRef(tableId))
        );
        if (cancelled) return;

        const autoJoins: JoinConfig[] = relationships.map(
          (item: {
            id?: string;
            left_table: { database: string; schema: string; table: string };
            right_table: { database: string; schema: string; table: string };
            constraint_name?: string | null;
            join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
            source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
            locked?: boolean;
            conditions?: Array<{
              left_column?: string;
              right_column?: string;
              fk_column?: string;
              pk_column?: string;
              operator?: string;
            }>;
          }) => ({
            id:
              item.id ??
              item.constraint_name ??
              `${item.left_table.database}.${item.left_table.schema}.${item.left_table.table}__${item.right_table.database}.${item.right_table.schema}.${item.right_table.table}`,
            leftTableId: `${item.left_table.database}.${item.left_table.schema}.${item.left_table.table}`,
            rightTableId: `${item.right_table.database}.${item.right_table.schema}.${item.right_table.table}`,
            constraintName: item.constraint_name ?? undefined,
            joinType: item.join_type ?? "INNER",
            source: item.source ?? "FOREIGN_KEY",
            locked: item.locked ?? true,
            conditions: (item.conditions ?? [])
              .filter(
                (condition) =>
                  (condition.left_column || condition.fk_column) &&
                  (condition.right_column || condition.pk_column)
              )
              .map((condition) => ({
                leftColumn: (condition.left_column ?? condition.fk_column) as string,
                rightColumn: (condition.right_column ?? condition.pk_column) as string,
                operator: condition.operator ?? "=",
              })),
          })
        ).map((join: JoinConfig) => orientJoinAroundDrivingTable(join, drivingTable));

        setJoins((prev) => {
          const manual = prev.filter((join) => !join.locked);
          const manualSignatures = new Set(manual.map(joinSignature));
          return [...manual, ...autoJoins.filter((join) => !manualSignatures.has(joinSignature(join)))];
        });
      } catch {
        if (!cancelled) {
          setValidationState({
            type: "error",
            message: "Unable to load automatic table relationships right now.",
          });
        }
      }
    };

    void loadRelationships();

    return () => {
      cancelled = true;
    };
  }, [cachedRelationships, drivingTable, selectedTableIds, derivedSourceMap]);

  useEffect(() => {
    if (!drivingTable) return;
    setJoins((prev) => prev.map((join) => orientJoinAroundDrivingTable(join, drivingTable)));
  }, [drivingTable]);

  const tableAliasById = useMemo(() => {
    return Object.fromEntries(
      selectedTables.map((table, index) => [table.id as string, buildAlias(table, index)])
    ) as Record<string, string>;
  }, [selectedTables]);

  const layoutPositions = useMemo(
    () =>
      buildRelationshipLayout(
        selectedTables.map((table) => table.id as string),
        drivingTable,
        joins,
        RELATIONSHIP_LAYOUT_COMPACT,
      ),
    [drivingTable, joins, selectedTables],
  );

  const relationshipNodes = useMemo(() => {
    return selectedTables.map((table) => ({
      id: table.id as string,
      type: "tableNode",
      position: layoutPositions[table.id as string] ?? { x: 32, y: 40 },
      data: {
        label: table.name ?? "—",
        schema: table.schema ?? "—",
        database: table.database ?? "—",
        tag: table.id === drivingTable ? "Driving" : table.tag ?? "Source",
        tagBg: table.id === drivingTable ? "#fef3c7" : tagChipPalette(table.tag).tagBg,
        tagFg: table.id === drivingTable ? "#854d0e" : tagChipPalette(table.tag).tagFg,
        secondaryTag: isDerivedTableMeta(table) ? "Derived" : undefined,
        secondaryTagBg: "#dcfce7",
        secondaryTagFg: "#166534",
        rowCount: table.rowCount ?? "—",
        colCount: table.colCount ?? table.columns?.length ?? 0,
        columns: table.columns ?? [],
        compact: true,
        selectableColumns: true,
        selectedColumns: selectedColumnsByTable[table.id as string] ?? [],
        showColumnSearch: true,
        onToggleColumn: (columnName: string, checked: boolean) => {
          setSelectedColumnsByTable((prev) => {
            const current = new Set(prev[table.id as string] ?? []);
            if (checked) current.add(columnName);
            else current.delete(columnName);
            return { ...prev, [table.id as string]: Array.from(current) };
          });
        },
      } satisfies TableNodeData,
    }));
  }, [drivingTable, layoutPositions, selectedColumnsByTable, selectedTables]);

  const [nodes, setNodes, onNodesChange] = useNodesState(relationshipNodes);

  useEffect(() => {
    setNodes((previousNodes) =>
      mergeRelationshipNodePositions(
        relationshipNodes,
        previousNodes,
        layoutPositions,
        RELATIONSHIP_LAYOUT_COMPACT,
        {
          joins,
          drivingTableId: drivingTable,
        },
      ),
    );
  }, [drivingTable, joins, layoutPositions, relationshipNodes, setNodes]);

  const relationshipEdges = useMemo(() => {
    return joins
      .map((join) => {
        const first = join.conditions?.[0];
        if (!join.id || !join.leftTableId || !join.rightTableId || !first) return null;
        if (!first.leftColumn || !first.rightColumn) return null;
        const leftTable = selectedTables.find((table) => table.id === join.leftTableId);
        const rightTable = selectedTables.find((table) => table.id === join.rightTableId);
        const sourceHandle = resolveRelationshipHandleId(leftTable, first.leftColumn, "source");
        const targetHandle = resolveRelationshipHandleId(rightTable, first.rightColumn, "target");
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
            onDelete: (id: string) => setJoins((prev) => prev.filter((item) => item.id !== id)),
            onEdit: (id: string) => {
              const joinToEdit = joins.find((item) => item.id === id);
              if (joinToEdit) {
                setEditingJoin(joinToEdit);
                setIsJoinModalOpen(true);
              }
            },
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color:
              (join.joinType ?? "INNER") === "LEFT"
                ? "#1d4ed8"
                : (join.joinType ?? "INNER") === "RIGHT"
                  ? "#0f766e"
                  : (join.joinType ?? "INNER") === "FULL"
                    ? "#7c3aed"
                    : "#111827",
          },
        } satisfies Edge;
      })
      .filter(Boolean) as Edge[];
  }, [joins, selectedTables]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setEdges(relationshipEdges);
  }, [relationshipEdges, setEdges]);

  useEffect(() => {
    const ids = new Set(selectedTableIds);
    setJoins((prev) =>
      prev.filter(
        (join) =>
          !!join.leftTableId &&
          !!join.rightTableId &&
          ids.has(join.leftTableId) &&
          ids.has(join.rightTableId)
      )
    );
  }, [selectedTableIds]);

  const onConnect = (params: Connection) => {
    const leftTableId = params.source;
    const rightTableId = params.target;
    const leftColumn = parseRelationshipHandleId(params.sourceHandle, "source");
    const rightColumn = parseRelationshipHandleId(params.targetHandle, "target");

    if (!leftTableId || !rightTableId || !leftColumn || !rightColumn) return;

    const existing = joins.find(
      (join) => join.leftTableId === leftTableId && join.rightTableId === rightTableId
    );
    setEditingJoin(
      existing ?? {
        id: `${leftTableId}__${rightTableId}`,
        leftTableId,
        rightTableId,
        joinType: "INNER",
        conditions: [{ leftColumn, operator: "=", rightColumn }],
      }
    );
    setIsJoinModalOpen(true);
  };

  const toggleTableSelection = (tableId: string) => {
    setSelectedTableIds((prev) => {
      if (prev.includes(tableId)) {
        const next = prev.filter((id) => id !== tableId);
        if (drivingTable === tableId) {
          setDrivingTable(next[0] ?? null);
        }
        setSelectedColumnsByTable((current) => {
          const nextMap = { ...current };
          delete nextMap[tableId];
          return nextMap;
        });
        return next;
      }

      const table = availableTables.find((item) => item.id === tableId);
      setSelectedColumnsByTable((current) => ({
        ...current,
        [tableId]: current[tableId] ?? [],
      }));
      if (!drivingTable) {
        setDrivingTable(tableId);
      }
      return [...prev, tableId];
    });
  };

  const selectedColumnEntries = useMemo(() => {
    return selectedTables.flatMap((table) =>
      (selectedColumnsByTable[table.id as string] ?? [])
        .map((columnName) => {
          const column = (table.columns ?? []).find((item) => item.name === columnName);
          if (!column) return null;
          return {
            table,
            column: {
              ...column,
              tableId: table.id as string,
              tableName: table.name,
            },
          };
        })
        .filter(Boolean) as Array<{ table: TableMeta; column: Column }>
    );
  }, [selectedColumnsByTable, selectedTables]);

  const previewColumns = useMemo(() => {
    return [
      { key: "index", label: "#", align: "left" as const },
      ...previewColumnsState.map((column) => ({
        key: column.name,
        label: (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
              {column.name}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
              {column.isPrimaryKey ? (
                <Box
                  sx={{
                    px: 0.75,
                    py: 0.15,
                    borderRadius: 1,
                    backgroundColor: "#fef3c7",
                    color: "#92400e",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  PK
                </Box>
              ) : null}
              <Box
                sx={{
                  px: 0.75,
                  py: 0.15,
                  borderRadius: 1,
                  backgroundColor: "#f1f5f9",
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {column.dataType}
              </Box>
            </Box>
          </Box>
        ),
      })),
    ];
  }, [previewColumnsState]);

  const previewRows = useMemo(() => {
    return previewRowsState.map((values, index) => ({
      index: index + 1,
      ...values,
    }));
  }, [previewRowsState]);

  const generatedSqlExpression = useMemo(() => {
    const drivingSource =
      selectedTables.find((table) => table.id === drivingTable) ?? selectedTables[0] ?? null;
    const lines = ["SELECT"];

    if (selectedColumnEntries.length > 0) {
      lines.push(
        selectedColumnEntries
          .map(({ table, column }) => {
            const alias = tableAliasById[table.id as string] ?? "t";
            return `  ${alias}.${column.name}`;
          })
          .join(",\n")
      );
    } else {
      lines.push("  -- Select columns from the table cards above");
    }

    if (drivingSource) {
      lines.push(
        `FROM ${renderSqlSourceReference(
          drivingSource,
          tableAliasById[drivingSource.id as string]
        )}`
      );
    } else {
      lines.push("FROM [Select one or more source tables]");
    }

    for (const join of joins) {
      const leftTable = selectedTables.find((table) => table.id === join.leftTableId);
      const rightTable = selectedTables.find((table) => table.id === join.rightTableId);
      if (!leftTable || !rightTable || !join.conditions?.length) continue;

      const rightAlias = tableAliasById[rightTable.id as string];
      const conditions = join.conditions
        .filter((condition) => condition.leftColumn && condition.rightColumn)
        .map((condition) => {
          const leftAlias = tableAliasById[leftTable.id as string];
          return `${leftAlias}.${condition.leftColumn} ${condition.operator ?? "="} ${rightAlias}.${condition.rightColumn}`;
        });

      if (!conditions.length) continue;

      lines.push(
        `${join.joinType ?? "INNER"} JOIN ${renderSqlSourceReference(rightTable, rightAlias)}`
      );
      lines.push(`  ON ${conditions.join("\n  AND ")}`);
    }

    if (filterGroups.length > 0 && filterSql.trim()) {
      lines.push("WHERE");
      lines.push(`  ${filterSql.split("\n").join("\n  ")}`);
    }

    if (queryClauses.groupBy.length > 0) {
      lines.push("GROUP BY");
      lines.push(`  ${queryClauses.groupBy.join(",\n  ")}`);
    }

    if (queryClauses.having?.trim()) {
      lines.push("HAVING");
      lines.push(`  ${queryClauses.having}`);
    }

    if (queryClauses.orderBy.length > 0) {
      lines.push("ORDER BY");
      lines.push(`  ${queryClauses.orderBy.join(",\n  ")}`);
    }

    return lines.join("\n");
  }, [
    derivedSourceMap,
    drivingTable,
    filterGroups.length,
    filterSql,
    joins,
    queryClauses.groupBy,
    queryClauses.having,
    queryClauses.orderBy,
    selectedColumnEntries,
    selectedTables,
    tableAliasById,
  ]);

  const effectiveSqlExpression = customSql || generatedSqlExpression;

  const persistedSourceTables = useMemo(
    () =>
      getPhysicalSourceTableIds(selectedTableIds).map((tableId) => toTableRef(tableId)),
    [selectedTableIds, derivedSourceMap]
  );

  const buildDerivedPayload = () => ({
    derived_source_id: editingSource?.id ?? null,
    derived_source_name: sourceName.trim(),
    sql_text: effectiveSqlExpression,
    source_tables: persistedSourceTables,
    parent_derived_source_ids: selectedTableIds.filter((tableId) => derivedSourceMap.has(tableId)),
    driving_table:
      drivingTable && !isDerivedSourceId(drivingTable) ? toTableRef(drivingTable) : null,
    relationships: joins.map(toRelationshipPayload),
    filters: filterGroups,
    selected_columns_by_table: selectedColumnsByTable,
  });

  const handleValidateSql = async () => {
    if (!sourceName.trim()) {
      setValidationState({ type: "error", message: "Enter a derived table name before validating." });
      return;
    }
    if (!selectedTableIds.length) {
      setValidationState({ type: "error", message: "Select at least one source table to validate the SQL." });
      return;
    }
    if (!customSql.trim() && !selectedColumnEntries.length) {
      setValidationState({ type: "error", message: "Select one or more columns to include in the derived table." });
      return;
    }
    if (!effectiveSqlExpression.includes("SELECT") || !effectiveSqlExpression.includes("FROM")) {
      setValidationState({ type: "error", message: "The SQL view must include both SELECT and FROM clauses." });
      return;
    }

    try {
      setIsValidating(true);
      const result = await dbService.validateDerivedSource(buildDerivedPayload());
      setPreviewColumnsState(
        (result.preview_columns ?? []).map((column: { name: string; data_type: string; is_primary_key?: boolean }) => ({
          name: column.name,
          dataType: column.data_type,
          isPrimaryKey: column.is_primary_key ?? false,
        }))
      );
      setPreviewRowsState(
        (result.preview_rows ?? []).map((row: { values: Record<string, unknown> }) => row.values)
      );
      setValidationState({ type: "success", message: result.message ?? "SQL validated successfully." });
      setActiveTab("Preview");
    } catch (error) {
      const fallback = "Unable to validate the SQL in Snowflake right now.";
      const message =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === "string"
          ? (error as { response?: { data?: { message?: string } } }).response!.data!.message!
          : fallback;
      setValidationState({ type: "error", message });
    } finally {
      setIsValidating(false);
    }
  };

  const handleApplySqlToBuilder = () => {
    if (!effectiveSqlExpression.trim()) {
      setValidationState({ type: "error", message: "Paste, upload, or generate SQL first." });
      return;
    }
    applySqlHydration(effectiveSqlExpression, { preserveManualName: false });
    setValidationState({
      type: "success",
      message: "SQL applied to the relationship canvas, selected columns, and filter builder.",
    });
  };

  const handleConfirm = async () => {
    const normalizedJoins = joins
      .filter(
        (join) =>
          !!join.id &&
          !!join.leftTableId &&
          !!join.rightTableId &&
          !!join.joinType &&
          !!join.conditions?.length
      )
      .map((join) => ({
        id: join.id as string,
        joinType: join.joinType as "INNER" | "LEFT" | "RIGHT" | "FULL",
        leftTableId: join.leftTableId as string,
        rightTableId: join.rightTableId as string,
        conditions: (join.conditions ?? [])
          .filter(
            (condition) =>
              !!condition.leftColumn &&
              !!condition.operator &&
              !!condition.rightColumn
          )
          .map((condition, index) => ({
            id: `${join.id}-cond-${index + 1}`,
            leftColumn: condition.leftColumn as string,
            operator: condition.operator as string,
            rightColumn: condition.rightColumn as string,
          })),
      }))
      .filter((join) => join.conditions.length > 0);

    try {
      setIsSaving(true);
      const result = await dbService.saveDerivedSource(buildDerivedPayload());
      const finalSource: DerivedSource = {
        id: result.derived_source_id,
        sourceName: result.derived_source_name,
        sqlText: result.sql_text,
        semanticBundleId: result.semantic_bundle_id ?? null,
        semanticViewName: result.semantic_view_name ?? null,
        semanticLevel: result.semantic_level ?? null,
        upstreamHash: result.upstream_hash ?? null,
        lineageDepth: result.lineage_depth ?? 0,
        drivingTableId: drivingTable ?? undefined,
        tableIds: selectedTableIds,
        derivedSourceIds: selectedTableIds.filter((tableId) => derivedSourceMap.has(tableId)),
        joins: normalizedJoins,
        filters: filterGroups,
        columns:
          selectedColumnEntries.length > 0
            ? selectedColumnEntries.map(({ column }) => column)
            : previewColumnsState.map((column) => ({
                name: column.name,
                tableId: result.derived_source_id,
                tableName: result.derived_source_name,
              })),
        previewColumns: (result.preview_columns ?? []).map(
          (column: { name: string; data_type: string; is_primary_key?: boolean }) => ({
            name: column.name,
            dataType: column.data_type,
            isPrimaryKey: column.is_primary_key,
          })
        ),
        previewRows: previewRowsState,
      };
      onConfirm(finalSource);
      onClose();
    } catch (error) {
      const fallback = "Unable to save the derived source right now.";
      const message =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === "string"
          ? (error as { response?: { data?: { message?: string } } }).response!.data!.message!
          : fallback;
      setValidationState({ type: "error", message });
    } finally {
      setIsSaving(false);
    }
  };

  const statusItems = [
    { label: "Name", active: sourceName.trim().length > 0 },
    { label: `Tables (${selectedTableIds.length})`, active: selectedTableIds.length > 0 },
    { label: `Joins (${joins.length})`, active: joins.length > 0 },
    { label: "Columns", active: selectedColumnEntries.length > 0 || computedColumns.length > 0 },
  ];

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      sx={{
        "& .MuiDialog-paper": {
          height: "90vh",
          borderRadius: "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              backgroundColor: "#065f46",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AddCircleOutlineRoundedIcon sx={{ color: "white" }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              Add Derived Table
            </Typography>
            <Typography sx={{ fontSize: 13, color: "#64748b" }}>
              Build a derived source from selected tables, joins, and chosen columns.
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, ml: 3, flexWrap: "wrap" }}>
            {statusItems.map((item) => (
              <Box
                key={item.label}
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: "16px",
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: item.active ? "#ecfdf5" : "#f1f5f9",
                  color: item.active ? "#059669" : "#64748b",
                }}
              >
                {item.label}
              </Box>
            ))}
          </Box>
        </Box>
        <IconButton onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Box
          sx={{
            width: 300,
            borderRight: "1px solid #e2e8f0",
            display: "flex",
            flexDirection: "column",
            bgcolor: "#ffffff",
            overflowX: "hidden",
          }}
        >
          <Box sx={{ p: 2, borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", mb: 1 }}>
              DERIVED SOURCE NAME
            </Typography>
            <InputBase
              fullWidth
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder="e.g. vw_customer_orders"
              sx={{
                border: "1px solid #e2e8f0",
                borderRadius: 1,
                px: 1.5,
                py: 0.9,
                fontSize: 14,
                backgroundColor: "#ffffff",
              }}
            />
          </Box>

          <Box sx={{ p: 2, flex: 1, overflowY: "auto", overflowX: "hidden", minWidth: 0 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", mb: 1.5 }}>
              AVAILABLE TABLES
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
              {availableTables.map((table) => {
                const isActive = selectedTableIds.includes(table.id as string);
                const isDriving = drivingTable === table.id;
                return (
                  <Box
                    key={table.id}
                    onClick={() => toggleTableSelection(table.id as string)}
                    sx={{
                      border: "1px solid",
                      borderColor: isActive ? "#2563eb" : "#e2e8f0",
                      borderRadius: 2,
                      px: 1.5,
                      py: 1.25,
                      backgroundColor: isActive ? "#eff6ff" : "#ffffff",
                      cursor: "pointer",
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  >
                    <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start" }}>
                      {isActive ? (
                        <CheckCircleRoundedIcon sx={{ color: "#2563eb", fontSize: 18, mt: 0.2 }} />
                      ) : (
                        <RadioButtonUncheckedRoundedIcon sx={{ color: "#94a3b8", fontSize: 18, mt: 0.2 }} />
                      )}
                      <TableChartOutlinedIcon sx={{ color: "#64748b", fontSize: 18, mt: 0.2 }} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 1,
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: "#1f2937",
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              lineHeight: 1.2,
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            {table.name}
                          </Typography>
                          {isDerivedTableMeta(table) ? (
                            <Box
                              sx={{
                                px: 0.85,
                                py: 0.2,
                                borderRadius: "999px",
                                backgroundColor: "#dcfce7",
                                color: "#166534",
                                fontSize: 10,
                                fontWeight: 800,
                                lineHeight: 1.2,
                                flexShrink: 0,
                              }}
                            >
                              Derived
                            </Box>
                          ) : null}
                        </Box>
                        <Typography
                          sx={{
                            fontSize: 11,
                            color: "#6b7280",
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                            lineHeight: 1.35,
                          }}
                        >
                          {table.schema} · {table.database}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: "#94a3b8", mt: 0.25 }}>
                          {table.colCount} cols
                        </Typography>
                      </Box>
                    </Box>
                    {isActive ? (
                      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1.25 }}>
                        <Typography sx={{ fontSize: 10, color: "#64748b" }}>
                          {selectedColumnsByTable[table.id as string]?.length ?? 0} selected for SQL
                        </Typography>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDrivingTable(table.id as string);
                          }}
                          style={{
                            border: "none",
                            background: "none",
                            color: isDriving ? "#b45309" : "#2563eb",
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {isDriving ? "Driving table" : "Set driving"}
                        </button>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>

        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Box sx={{ display: "flex", flexDirection: "column", bgcolor: "#ffffff", borderBottom: "1px solid #e2e8f0" }}>
            <Box sx={{ display: "flex", borderBottom: "1px solid #e2e8f0", px: 3, pt: 2, gap: 3, bgcolor: "#ffffff" }}>
              <Box
                onClick={() => setActiveTab("SQL")}
                sx={{
                  pb: 1.5,
                  borderBottom: activeTab === "SQL" ? "2px solid #22c55e" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: activeTab === "SQL" ? "#0f172a" : "#64748b" }}>
                  SQL View
                </Typography>
              </Box>
              <Box
                onClick={() => setActiveTab("Preview")}
                sx={{
                  pb: 1.5,
                  borderBottom: activeTab === "Preview" ? "2px solid #22c55e" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: activeTab === "Preview" ? "#0f172a" : "#64748b" }}>
                  Resulting Columns Preview
                </Typography>
              </Box>
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, p: 3, width: "100%" }}>
              {activeTab === "SQL" ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                  {validationState ? (
                    <Box
                      sx={{
                        px: 1.5,
                        py: 1,
                        borderRadius: 1.5,
                        backgroundColor: validationState.type === "success" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                        color: validationState.type === "success" ? "#166534" : "#b91c1c",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {validationState.message}
                    </Box>
                  ) : null}
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
                    <FocusButton
                      variant="contained"
                      size="small"
                      rounded="full"
                      onClick={handleApplySqlToBuilder}
                    >
                      Apply To Builder
                    </FocusButton>
                  </Box>
                  <Box sx={{ width: '100%', flexShrink: 0 }}>
                    <SqlEditor
                      value={effectiveSqlExpression}
                      onChange={setCustomSql}
                      title="SQL View"
                      placeholder="-- Paste, upload, or build SQL here"
                      showCopy
                      showUpload
                      showFunctionLibrary
                      minHeight={SQL_EDITOR_DERIVED_HEIGHT}
                      maxHeight={SQL_EDITOR_DERIVED_HEIGHT}
                      sx={{ width: '100%' }}
                      onUpload={(content, fileName) => {
                        setCustomSql(content);
                        applySqlHydration(content, { preserveManualName: false });
                        setValidationState({
                          type: "success",
                          message: `Loaded SQL from ${fileName} and synced it to the builder.`,
                        });
                      }}
                      onUploadError={() => {
                        setValidationState({
                          type: "error",
                          message: "Unable to read that SQL file.",
                        });
                      }}
                      onCopySuccess={() => {
                        setValidationState({
                          type: "success",
                          message: "SQL copied to clipboard.",
                        });
                      }}
                      onCopyError={() => {
                        setValidationState({
                          type: "error",
                          message: "Unable to copy the SQL right now.",
                        });
                      }}
                    />
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {detectedFunctions.length > 0 ? (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Typography sx={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>
                          FUNCTIONS
                        </Typography>
                        {detectedFunctions.map((fn) => (
                          <Box
                            key={`${fn.category}-${fn.name}`}
                            sx={{
                              px: 1,
                              py: 0.3,
                              borderRadius: "999px",
                              backgroundColor: "rgba(59,130,246,0.18)",
                              color: "#bfdbfe",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {fn.name}
                          </Box>
                        ))}
                      </Box>
                    ) : null}
                    {(queryClauses.groupBy.length > 0 || queryClauses.orderBy.length > 0 || queryClauses.having) ? (
                      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                        {queryClauses.groupBy.length > 0 ? (
                          <Typography sx={{ fontSize: 11, color: "#cbd5e1" }}>
                            <strong>GROUP BY:</strong> {queryClauses.groupBy.join(", ")}
                          </Typography>
                        ) : null}
                        {queryClauses.having ? (
                          <Typography sx={{ fontSize: 11, color: "#cbd5e1" }}>
                            <strong>HAVING:</strong> {queryClauses.having}
                          </Typography>
                        ) : null}
                        {queryClauses.orderBy.length > 0 ? (
                          <Typography sx={{ fontSize: 11, color: "#cbd5e1" }}>
                            <strong>ORDER BY:</strong> {queryClauses.orderBy.join(", ")}
                          </Typography>
                        ) : null}
                      </Box>
                    ) : null}
                    {computedColumns.length > 0 ? (
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        {computedColumns.map((column) => (
                          <Box
                            key={column.alias}
                            sx={{
                              px: 1,
                              py: 0.4,
                              borderRadius: 1,
                              backgroundColor: "rgba(148,163,184,0.16)",
                              color: "#e2e8f0",
                              fontSize: 10,
                              fontWeight: 600,
                            }}
                            title={column.expression}
                          >
                            {column.alias}
                          </Box>
                        ))}
                      </Box>
                    ) : null}
                  </Box>
                </Box>
              ) : (
                <Box
                  sx={{
                    height: "100%",
                    bgcolor: "#ffffff",
                    borderRadius: 2,
                    border: "1px solid #e5e7eb",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  {previewColumnsState.length === 0 ? (
                    <Box sx={{ p: 2.5 }}>
                      <Typography sx={{ fontSize: 13, color: "#94a3b8" }}>
                        Validate the SQL to preview the resulting schema and sample rows from Snowflake.
                      </Typography>
                    </Box>
                  ) : (
                    <>
                      <Box
                        sx={{
                          px: 2,
                          py: 1.5,
                          borderBottom: "1px solid #e5e7eb",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 2,
                          flexWrap: "wrap",
                        }}
                      >
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                          <Typography
                            sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#94a3b8",
                              letterSpacing: "0.05em",
                            }}
                          >
                            SOURCES:
                          </Typography>
                          {selectedTables.map((table) => (
                            <Box
                              key={table.id}
                              sx={{
                                px: 1.5,
                                py: 0.25,
                                borderRadius: "12px",
                                border: "1px solid #bfdbfe",
                                color: "#3b82f6",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              {table.name}
                            </Box>
                          ))}
                        </Box>
                        <Typography sx={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                          {previewColumnsState.length} columns · {previewRowsState.length} sample rows
                        </Typography>
                      </Box>

                      <Box sx={{ flex: 1, overflow: "auto" }}>
                          <FocusTable columns={previewColumns}>
                            {previewRows.map((row) => (
                              <tr key={row.index} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                {previewColumns.map((column) => {
                                const typedRow = row as Record<string, unknown>;
                                const value = typedRow[column.key as string];
                                const renderedValue =
                                  value === null || value === undefined
                                    ? ""
                                    : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                                      ? String(value)
                                      : JSON.stringify(value);
                                return (
                                  <td
                                    key={`${row.index}-${column.key}`}
                                    style={{
                                      padding: "12px 16px",
                                      fontSize: 13,
                                      color: column.key === "index" ? "#94a3b8" : "#0f172a",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {renderedValue}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </FocusTable>
                      </Box>
                    </>
                  )}
                </Box>
              )}
            </Box>
          </Box>

          <Box sx={{ p: 3, borderBottom: "1px solid #e2e8f0" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                  Table Relationships
                </Typography>
                <Typography sx={{ fontSize: 12, color: "#64748b", mt: 0.5 }}>
                  Add tables from the left, connect matching columns, and choose the columns that should appear in the derived source.
                </Typography>
              </Box>
              <FocusButton
                variant="outlined"
                size="small"
                rounded="full"
                onClick={() => {
                  setEditingJoin(null);
                  setIsJoinModalOpen(true);
                }}
                disabled={selectedTables.length < 2}
              >
                + Add Join
              </FocusButton>
            </Box>

            <Box
              sx={{
                height: 400,
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                overflow: "hidden",
                bgcolor: "#ffffff",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {selectedTables.length === 0 ? (
                <Box
                  sx={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    fontSize: 14,
                    px: 4,
                    textAlign: "center",
                  }}
                >
                  Select one or more source tables from the left. They will appear here for join design and column selection.
                </Box>
              ) : (
                <Box sx={{ flex: 1, minHeight: 0 }}>
                <RelationshipFlowView
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  defaultEdgeOptions={{ type: "tableEdge", animated: true }}
                />
                </Box>
              )}
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#111827", letterSpacing: "0.08em" }}>
                LEGEND:
              </Typography>
              {[
                ["INNER JOIN", "#111827"],
                ["LEFT JOIN", "#1d4ed8"],
                ["RIGHT JOIN", "#0f766e"],
                ["FULL JOIN", "#7c3aed"],
              ].map(([label, backgroundColor]) => (
                <Box
                  key={label}
                  sx={{
                    px: 1.25,
                    py: 0.4,
                    borderRadius: 1,
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#ffffff",
                    backgroundColor,
                  }}
                >
                  {label}
                </Box>
              ))}
            </Box>
          </Box>

          <Box sx={{ p: 3, borderBottom: "1px solid #e2e8f0" }}>
            <FilterConditions
              tables={selectedTables}
              initialGroups={filterGroups}
              initialGroupBy={queryClauses.groupBy}
              initialOrderBy={queryClauses.orderBy}
              previewSql={effectiveSqlExpression}
              previewLabel="DERIVED SOURCE SQL PREVIEW"
              showPreview={false}
              onQueryChange={({ groups, whereSql, groupBy, orderBy, groupBySql, orderBySql }) => {
                setFilterGroups(groups);
                setFilterSql(whereSql);
                setQueryClauses({
                  groupBy: groupBy.map((item) => item.field).filter(Boolean),
                  having: queryClauses.having,
                  orderBy: orderBy
                    .filter((item) => item.field)
                    .map((item) => `${item.field} ${item.direction}`),
                });
                if (!whereSql && !groupBySql && !orderBySql) {
                  setValidationState((prev) =>
                    prev?.type === "success" ? { type: "success", message: "Query builder updated." } : prev
                  );
                }
              }}
            />
          </Box>
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          px: 3,
          py: 2,
          borderTop: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography sx={{ fontSize: 12, color: "#64748b" }}>
          {selectedColumnEntries.length} columns selected · {joins.length} joins configured
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <FocusButton variant="text" size="small" rounded="full" onClick={onClose} customColor="#64748b">
            Cancel
          </FocusButton>
          <FocusButton
            variant="outlined"
            size="small"
            rounded="full"
            onClick={handleValidateSql}
            disabled={!selectedTableIds.length || isValidating}
          >
            {isValidating ? "Validating..." : "Validate SQL"}
          </FocusButton>
          <FocusButton
            variant="contained"
            size="small"
            rounded="full"
            onClick={handleConfirm}
            disabled={
              !sourceName.trim() ||
              selectedTableIds.length === 0 ||
              (selectedColumnEntries.length === 0 &&
                computedColumns.length === 0 &&
                previewColumnsState.length === 0) ||
              isSaving
            }
          >
            {isSaving ? "Saving..." : "Add Derived Table"}
          </FocusButton>
        </Box>
      </Box>

      <JoinModal
        isOpen={isJoinModalOpen}
        onClose={() => {
          setIsJoinModalOpen(false);
          setEditingJoin(null);
        }}
        tables={selectedTables}
        drivingTableIdOverride={drivingTable}
        editingJoin={editingJoin}
        onConfirm={(join: JoinConfig) => {
          const normalizedJoin = orientJoinAroundDrivingTable(join, drivingTable);
          setJoins((prev) => {
            const next = prev.filter((item) => item.id !== join.id);
            return [...next, normalizedJoin];
          });
        }}
      />
    </Dialog>
  );
}
