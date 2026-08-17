"use client";
import { AiaBox, AiaCheckbox, AiaCircularProgress, AiaDialog, AiaIconButton, AiaInput, AiaMenu, AiaMenuItem, AiaResizeHandle } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddCircleIcon from '@mui/icons-material/AddCircle';
import { AIA_RESIZE_HANDLE_THICKNESS } from '@/components/ui/aia-resize-handle';
import { AddIcon, AllInclusiveIcon, CheckIcon, KeyIcon, LinkIcon, MoreVertIcon } from '@/utils/icons';
import { BODY_SX, CAPTION_SX, SECONDARY_TEXT_SX, TYPOGRAPHY_TOKENS, textStyleCssVars } from '@/config/typography-tokens';
import {
  MarkerType,
  type Connection,
  type Edge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";

import { dbService } from "@/services/dbService";
import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { resolveSelectedSourceTables } from "@/features/sttm/shared/sttm-selection-utils";
import { useAiChatLayout } from "@/features/ai-agent/ai-chat-layout-context";
import { AiaButton } from "@/components/ui/aia-button";
import { AiaChip } from "@/components/ui/aia-chip";
import { AiaTable } from "@/components/ui/aia-table/aia-table";
import { SqlEditor, SQL_EDITOR_DERIVED_HEIGHT } from "@/components/sql";
import { FilterConditions, type RuleGroup } from "./filter-conditions";
import { JoinModal } from "./join-modal";
import {
  hydrateBuilderFromSql,
  suggestBusinessName,
  type ComputedColumn,
  type DetectedFunction,
} from "./sql-hydration";
import { TableNode, type TableNodeData } from "./table-node";
import { RelationshipFlowView } from "./relationship-flow-view";
import { useTour } from "@/features/tour/engine/tour-context";
import { TOUR_TARGETS } from "@/features/tour/constants/tour-targets";
import {
  isTableHeaderHandle,
  resolveTableHeaderHandleId,
} from "./relationship-handles";
import {
  buildRelationshipLayout,
  mergeRelationshipNodePositions,
  RELATIONSHIP_LAYOUT_FULL,
} from "./relationship-layout";
import type {
  Column,
  DerivedSource,
  JoinConfig,
  PendingDerivedSourceDraft,
  TableMeta,
} from "@/features/sttm/types/sttm.types";

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

const DERIVED_SIDEBAR_SECTION_LABEL_SX = {
  ...SECONDARY_TEXT_SX,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  display: "block",
} as const;

const DERIVED_MODAL_CANVAS_AREA_MIN_HEIGHT = 420;
const DERIVED_MODAL_FLOW_HOST_DEFAULT_HEIGHT = 320;

const JOIN_LEGEND = [
  { label: "INNER JOIN", bg: "#111827" },
  { label: "LEFT JOIN", bg: "#1e40af" },
  { label: "RIGHT JOIN", bg: "#0d9488" },
  { label: "FULL JOIN", bg: "#9333ea" },
] as const;

interface AvailableTableRowProps {
  table: TableMeta;
  isActive: boolean;
  isDriving: boolean;
  selectedCount: number;
  onToggle: () => void;
  onSetDriving: () => void;
}

function AvailableTableRow({
  table,
  isActive,
  isDriving,
  selectedCount,
  onToggle,
  onSetDriving,
}: AvailableTableRowProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const totalCols = table.colCount ?? table.columns?.length ?? 0;

  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleMakeDrivingTable = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!isActive) return;
    onSetDriving();
    setAnchorEl(null);
  };

  return (
    <AiaBox
      sx={{
        borderBottom: "1px solid #e2e8f0",
        py: 0.75,
      }}
    >
      <AiaBox
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
        }}
      >
        <AiaCheckbox
          checked={isActive}
          checkHandler={onToggle}
          uncheckedColor="var(--aia-primary-bg-color)"
          checkedColor="var(--aia-primary-bg-color)"
        />
        <AiaBox sx={{ flex: 1, minWidth: 0 }}>
          <AiaBox
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <AiaBox
              sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <AiaText
                component="span"
                sx={{
                  ...BODY_SX,
                  color: TYPOGRAPHY_TOKENS.body.color,
                  display: "inline-flex",
                  alignItems: "center",
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  minWidth: 0,
                }}
              >
                {table.name}
              </AiaText>
              {isDriving ? (
                <AiaChip
                  label="Driving"
                  size="small"
                  color="warning"
                  customBackgroundColor="#fef08a"
                  customColor="#854d0e"
                  customBorderColor="#fde047"
                  sx={{
                    height: 22,
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0,
                    alignSelf: "center",
                    "& .MuiChip-label": { px: 0.75, py: 0 },
                  }}
                />
              ) : null}
            </AiaBox>
            {isDerivedTableMeta(table) ? (
              <AiaChip label="Derived" size="small" color="success" sx={{ alignSelf: "center" }} />
            ) : null}
          </AiaBox>
          <AiaText
            sx={{
              ...SECONDARY_TEXT_SX,
              color: TYPOGRAPHY_TOKENS.secondaryText.color,
              mt: 0,
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {table.database} · {table.schema}
          </AiaText>
          <AiaText sx={{ ...CAPTION_SX, mt: 0 }}>
            {selectedCount}/{totalCols} cols selected for sql
          </AiaText>
        </AiaBox>
        <AiaBox sx={{ ml: 0.5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <AiaIconButton size="small" onClick={handleMenuClick} sx={{ color: "text.secondary" }}>
            <MoreVertIcon fontSize="small" />
          </AiaIconButton>
          <AiaMenu
            anchorEl={anchorEl}
            open={open}
            onClose={handleMenuClose}
            onClick={(e) => e.stopPropagation()}
            slotProps={{
              paper: {
                sx: {
                  minWidth: 160,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
                  borderRadius: "8px",
                },
              },
            }}
            transformOrigin={{ horizontal: "right", vertical: "top" }}
            anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
          >
            <AiaMenuItem
              onClick={handleMakeDrivingTable}
              disabled={!isActive}
              sx={{
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                opacity: !isActive ? 0.5 : 1,
                filter: !isActive ? "blur(0.5px)" : "none",
                textTransform: !isActive ? "uppercase" : "none",
              }}
            >
              Mark as driving table
              {isDriving ? <CheckIcon fontSize="small" sx={{ ml: 2, color: "primary.main" }} /> : null}
            </AiaMenuItem>
          </AiaMenu>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
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
  const { fullData, sources, drivingTableId, relationships, sourceAttributeGroups, derivedSources, refreshAssistantSignals } = useSttmBuilderContext();
  const {
    isOpen: isAssistantOpen,
    effectiveSidebarWidth,
    isMobile,
    isTablet,
  } = useAiChatLayout();
  const { registerModalTour, startTour } = useTour();

  useEffect(() => {
    if (!isOpen) {
      registerModalTour(null);
      return;
    }
    registerModalTour("sttm-derived-table");
    return () => registerModalTour(null);
  }, [isOpen, registerModalTour]);

  const availableTables = useMemo<TableMeta[]>(() => {
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
      const columns = normalizeColumns(
        table.columnItems?.length ? table.columnItems : groupsByQualifiedName.get(qualifiedName),
        {
          id: table.tableId,
          name: table.tableName,
          schema,
          database,
        }
      );
      selectedTables.push({
        id: table.tableId,
        name: table.tableName,
        schema,
        database,
        rowCount: table.rows ?? "—",
        colCount: columns.length || table.columns || 0,
        columns,
        tag: "Source",
      });
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
  }, [derivedSources, fullData, sourceAttributeGroups, sources]);

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
  const [flowHostHeight, setFlowHostHeight] = useState(DERIVED_MODAL_FLOW_HOST_DEFAULT_HEIGHT);
  const relationshipHeaderRef = useRef<HTMLDivElement>(null);
  const relationshipLegendRef = useRef<HTMLDivElement>(null);

  const resolveMinFlowHostHeight = useCallback(() => {
    const headerHeight = relationshipHeaderRef.current?.offsetHeight ?? 48;
    const legendHeight = relationshipLegendRef.current?.offsetHeight ?? 58;
    return Math.max(
      160,
      DERIVED_MODAL_CANVAS_AREA_MIN_HEIGHT - headerHeight - legendHeight - AIA_RESIZE_HANDLE_THICKNESS,
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

        const autoJoins: JoinConfig[] = relationships
          .filter((item) => !item.review_required)
          .map(
          (item: {
            id?: string;
            left_table: { database: string; schema: string; table: string };
            right_table: { database: string; schema: string; table: string };
            constraint_name?: string | null;
            join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
            source?: "FOREIGN_KEY" | "USER_DEFINED" | "SEMANTIC_VIEW" | null;
            locked?: boolean;
            review_required?: boolean;
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
        RELATIONSHIP_LAYOUT_FULL,
      ),
    [drivingTable, joins, selectedTables],
  );

  const relationshipNodes = useMemo(() => {
    return selectedTables.map((table) => ({
      id: table.id as string,
      type: "tableNode",
      position: layoutPositions[table.id as string] ?? { x: 48, y: 48 },
      data: {
        label: table.name ?? "—",
        schema: table.schema ?? "—",
        database: table.database ?? "—",
        tag: table.id === drivingTable ? "Driving" : table.tag ?? "Source",
        tagBg: tagChipPalette(table.tag ?? "Source").tagBg,
        tagFg: tagChipPalette(table.tag ?? "Source").tagFg,
        secondaryTag: isDerivedTableMeta(table) ? "Derived" : undefined,
        secondaryTagBg: "#dcfce7",
        secondaryTagFg: "#166534",
        rowCount: table.rowCount ?? "—",
        colCount: table.colCount ?? table.columns?.length ?? 0,
        columns: table.columns ?? [],
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
        RELATIONSHIP_LAYOUT_FULL,
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
    const fromHeader =
      isTableHeaderHandle(params.sourceHandle) || isTableHeaderHandle(params.targetHandle);

    if (!leftTableId || !rightTableId) return;
    if (!fromHeader && (!leftColumn || !rightColumn)) return;

    const existing = joins.find(
      (join) => join.leftTableId === leftTableId && join.rightTableId === rightTableId
    );
    setEditingJoin(
      existing ?? {
        id: `${leftTableId}__${rightTableId}`,
        leftTableId,
        rightTableId,
        joinType: "INNER",
        conditions:
          leftColumn && rightColumn
            ? [{ leftColumn, operator: "=", rightColumn }]
            : [{ leftColumn: "", operator: "=", rightColumn: "" }],
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
          <AiaBox sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <AiaText sx={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
              {column.name}
            </AiaText>
            <AiaBox sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
              {column.isPrimaryKey ? (
                <AiaBox
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
                </AiaBox>
              ) : null}
              <AiaBox
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
              </AiaBox>
            </AiaBox>
          </AiaBox>
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
    purpose:
      draftSource?.purpose ??
      draftSource?.requestSummary ??
      `Reusable source relation for ${sourceName.trim()}`,
    business_description:
      draftSource?.businessDescription ??
      draftSource?.requestSummary ??
      `Derived relation ${sourceName.trim()} generated from the selected source graph.`,
    grain: draftSource?.grain ?? editingSource?.grain ?? null,
    keys: draftSource?.keys ?? editingSource?.keys ?? [],
    output_columns:
      draftSource?.outputColumns?.length
        ? draftSource.outputColumns
        : previewColumnsState.map((column) => ({
            name: column.name,
            data_type: column.dataType,
            is_primary_key: column.isPrimaryKey ?? false,
          })),
    column_semantics: draftSource?.columnSemantics ?? editingSource?.columnSemantics ?? [],
    generated_by_request_id: draftSource?.generatedByRequestId ?? null,
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
      if (result.sql_text?.trim() && result.sql_text.trim() !== effectiveSqlExpression.trim()) {
        setCustomSql(result.sql_text);
      }
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
        sourceDependencyHash: result.source_dependency_hash ?? null,
        physicalViewName: result.physical_view_name ?? null,
        purpose: result.purpose ?? null,
        businessDescription: result.business_description ?? null,
        grain: result.grain ?? null,
        keys: result.keys ?? [],
        outputColumns: result.output_columns ?? [],
        columnSemantics: result.column_semantics ?? [],
        semanticProjection: result.semantic_projection ?? {},
        semanticQuality: result.semantic_quality ?? null,
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
      window.setTimeout(() => refreshAssistantSignals("derived_source_saved"), 0);
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

  const derivedCloseButtonSx = {
    minWidth: 28,
    width: 28,
    height: 28,
    p: 0,
    fontSize: 14,
    lineHeight: 1,
    boxShadow: "none",
    color: "var(--aia-button-color)",
    border: "none",
    backgroundColor: "transparent",
    "&:hover": {
      color: "var(--aia-button-color)",
      border: "none",
      backgroundColor: "color-mix(in srgb, var(--aia-button-color) 6%, transparent)",
    },
  } as const;

  const derivedPrimaryButtonColors = {
    customBackgroundColor: "var(--aia-primary-bg-color)",
    customColor: "var(--aia-primary-bg-text-color)",
    customBorderColor: "var(--aia-primary-bg-color)",
    customHoverBackgroundColor: "var(--aia-primary-bg-hover-color)",
  } as const;
  const assistantDockWidth =
    isAssistantOpen && !isMobile && !isTablet ? effectiveSidebarWidth : 0;

  return (
    <AiaDialog
      open={isOpen}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      sx={{
        right: `${assistantDockWidth}px`,
        transition: "right 220ms ease",
        "& .MuiDialog-paper": {
          height: "90vh",
          maxWidth: assistantDockWidth
            ? `min(1536px, calc(100vw - ${assistantDockWidth + 48}px))`
            : undefined,
          borderRadius: "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <AiaBox sx={{ p: 3, borderBottom: "1px solid #f1f5f9" }}>
        <AiaBox sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0, flex: 1 }}>
            <AddCircleIcon
              sx={{
                fontSize: "calc(var(--aia-card-title-font-size) + 8px)",
                color: "var(--aia-card-title-color)",
                flexShrink: 0,
              }}
              aria-hidden
            />
            <AiaBox sx={{ minWidth: 0 }}>
              <AiaText
                sx={{
                  ...textStyleCssVars("cardTitle"),
                  textTransform: "capitalize",
                  letterSpacing: "-0.01em",
                }}
              >
                Add Derived Table
              </AiaText>
              <AiaText
                sx={{
                  ...textStyleCssVars("secondaryText"),
                  mt: 0.25,
                  display: "block",
                }}
              >
                Build a derived source from selected tables, joins, and chosen columns.
              </AiaText>
            </AiaBox>
            <AiaBox sx={{ display: "flex", gap: 1, ml: 3, flexWrap: "wrap", flexShrink: 0 }}>
              {statusItems.map((item) => (
                <AiaChip
                  key={item.label}
                  label={item.label}
                  size="small"
                  color={item.active ? "success" : "secondary"}
                  customBackgroundColor={item.active ? "#ecfdf5" : "#f1f5f9"}
                  customColor={item.active ? "#059669" : "#64748b"}
                  customBorderColor={item.active ? "#bbf7d0" : "#e2e8f0"}
                />
              ))}
            </AiaBox>
          </AiaBox>
          <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <AiaButton
              variant="contained"
              size="small"
              onClick={() => startTour("sttm-derived-table")}
              aria-label="Start Add Derived Table tour guide"
              sx={{
                textTransform: "none",
                fontWeight: 700,
                fontSize: 13,
                borderRadius: "10px",
                px: 1.5,
                py: 0.6,
                minHeight: 34,
                backgroundColor: "var(--aia-primary-bg-color)",
                color: "var(--aia-primary-bg-text-color)",
                boxShadow: "none",
                "&:hover": {
                  backgroundColor: "var(--aia-primary-bg-hover-color)",
                },
              }}
            >
              Tour Guide
            </AiaButton>
            <AiaButton
              variant="text"
              size="small"
              onClick={onClose}
              sx={derivedCloseButtonSx}
              aria-label="Close"
            >
              ✕
            </AiaButton>
          </AiaBox>
        </AiaBox>
      </AiaBox>

      <AiaBox sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        <AiaBox
          sx={{
            width: 300,
            borderRight: "1px solid #e2e8f0",
            display: "flex",
            flexDirection: "column",
            bgcolor: "#ffffff",
            overflowX: "hidden",
          }}
        >
          <AiaBox
            sx={{ p: 2, borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}
            data-tour={TOUR_TARGETS.derivedSourceName}
          >
            <AiaText sx={{ ...DERIVED_SIDEBAR_SECTION_LABEL_SX, mb: 0.75 }}>Derived Source Name</AiaText>
            <AiaInput
              fullWidth
              value={sourceName}
              onChange={setSourceName}
              placeholder="e.g. vw_customer_orders"
            />
          </AiaBox>

          <AiaBox
            sx={{ p: 2, flex: 1, overflowY: "auto", overflowX: "hidden", minWidth: 0 }}
            data-tour={TOUR_TARGETS.derivedAvailableTables}
          >
            <AiaText sx={{ ...DERIVED_SIDEBAR_SECTION_LABEL_SX, mb: 0.75 }}>Available Tables</AiaText>
            <AiaBox>
              {availableTables.map((table) => {
                const isActive = selectedTableIds.includes(table.id as string);
                const isDriving = drivingTable === table.id;
                const selectedCount = selectedColumnsByTable[table.id as string]?.length ?? 0;
                return (
                  <AvailableTableRow
                    key={table.id}
                    table={table}
                    isActive={isActive}
                    isDriving={isDriving}
                    selectedCount={selectedCount}
                    onToggle={() => toggleTableSelection(table.id as string)}
                    onSetDriving={() => setDrivingTable(table.id as string)}
                  />
                );
              })}
            </AiaBox>
          </AiaBox>
        </AiaBox>

        <AiaBox sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <AiaBox sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <AiaBox sx={{ display: "flex", flexDirection: "column", bgcolor: "#ffffff", borderBottom: "1px solid #e2e8f0" }}>
            <AiaBox sx={{ display: "flex", borderBottom: "1px solid #e2e8f0", px: 3, pt: 2, gap: 3, bgcolor: "#ffffff" }}>
              <AiaBox
                onClick={() => setActiveTab("SQL")}
                data-tour={TOUR_TARGETS.derivedSqlViewTab}
                sx={{
                  pb: 1.5,
                  borderBottom: activeTab === "SQL" ? "2px solid #22c55e" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                <AiaText sx={{ fontSize: 13, fontWeight: 700, color: activeTab === "SQL" ? "#0f172a" : "#64748b" }}>
                  SQL View
                </AiaText>
              </AiaBox>
              <AiaBox
                onClick={() => setActiveTab("Preview")}
                data-tour={TOUR_TARGETS.derivedColumnsPreviewTab}
                sx={{
                  pb: 1.5,
                  borderBottom: activeTab === "Preview" ? "2px solid #22c55e" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                <AiaText sx={{ fontSize: 13, fontWeight: 700, color: activeTab === "Preview" ? "#0f172a" : "#64748b" }}>
                  Resulting Columns Preview
                </AiaText>
              </AiaBox>
            </AiaBox>

            <AiaBox sx={{ flex: 1, minHeight: 0, p: 3, width: "100%" }}>
              {activeTab === "SQL" ? (
                <AiaBox sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                  {validationState ? (
                    <AiaBox
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
                    </AiaBox>
                  ) : null}
                  <AiaBox sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
                    <AiaButton
                      variant="outlined"
                      size="small"
                      color="primary"
                      onClick={handleApplySqlToBuilder}
                      customBorderColor="var(--aia-primary-bg-color)"
                      customColor="var(--aia-primary-bg-color)"
                    >
                      Apply To Builder
                    </AiaButton>
                  </AiaBox>
                  <AiaBox sx={{ width: '100%', flexShrink: 0 }}>
                    <SqlEditor
                      value={effectiveSqlExpression}
                      onChange={setCustomSql}
                      title="SQL View"
                      placeholder="-- Paste, upload, or build SQL here"
                      showCopy
                      showUpload
                      showFunctionLibrary
                      functionLibraryTourTargets={{
                        library: TOUR_TARGETS.derivedFunctionLibrary,
                        panel: TOUR_TARGETS.derivedFunctionPanel,
                      }}
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
                  </AiaBox>
                  <AiaBox sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {detectedFunctions.length > 0 ? (
                      <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <AiaText sx={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>
                          FUNCTIONS
                        </AiaText>
                        {detectedFunctions.map((fn) => (
                          <AiaBox
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
                          </AiaBox>
                        ))}
                      </AiaBox>
                    ) : null}
                    {(queryClauses.groupBy.length > 0 || queryClauses.orderBy.length > 0 || queryClauses.having) ? (
                      <AiaBox sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                        {queryClauses.groupBy.length > 0 ? (
                          <AiaText sx={{ fontSize: 11, color: "#cbd5e1" }}>
                            <strong>GROUP BY:</strong> {queryClauses.groupBy.join(", ")}
                          </AiaText>
                        ) : null}
                        {queryClauses.having ? (
                          <AiaText sx={{ fontSize: 11, color: "#cbd5e1" }}>
                            <strong>HAVING:</strong> {queryClauses.having}
                          </AiaText>
                        ) : null}
                        {queryClauses.orderBy.length > 0 ? (
                          <AiaText sx={{ fontSize: 11, color: "#cbd5e1" }}>
                            <strong>ORDER BY:</strong> {queryClauses.orderBy.join(", ")}
                          </AiaText>
                        ) : null}
                      </AiaBox>
                    ) : null}
                    {computedColumns.length > 0 ? (
                      <AiaBox sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        {computedColumns.map((column) => (
                          <AiaBox
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
                          </AiaBox>
                        ))}
                      </AiaBox>
                    ) : null}
                  </AiaBox>
                </AiaBox>
              ) : (
                <AiaBox
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
                    <AiaBox sx={{ p: 2.5 }}>
                      <AiaText sx={{ fontSize: 13, color: "#94a3b8" }}>
                        Validate the SQL to preview the resulting schema and sample rows from Snowflake.
                      </AiaText>
                    </AiaBox>
                  ) : (
                    <>
                      <AiaBox
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
                        <AiaBox sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                          <AiaText
                            sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#94a3b8",
                              letterSpacing: "0.05em",
                            }}
                          >
                            SOURCES:
                          </AiaText>
                          {selectedTables.map((table) => (
                            <AiaBox
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
                            </AiaBox>
                          ))}
                        </AiaBox>
                        <AiaText sx={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                          {previewColumnsState.length} columns · {previewRowsState.length} sample rows
                        </AiaText>
                      </AiaBox>

                      <AiaBox sx={{ flex: 1, overflow: "auto" }}>
                          <AiaTable columns={previewColumns}>
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
                        </AiaTable>
                      </AiaBox>
                    </>
                  )}
                </AiaBox>
              )}
            </AiaBox>
          </AiaBox>

          <AiaBox sx={{ px: 3, py: 3, borderBottom: "1px solid #e2e8f0" }}>
            <div className="canvas-area">
              <div ref={relationshipHeaderRef} className="canvas-area__header">
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
                  <AiaChip
                    size="small"
                    color="primary"
                    label={joins.length === 1 ? "1 join" : `${joins.length} joins`}
                  />
                </div>
                <AiaButton
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon sx={{ fontSize: 18 }} />}
                  onClick={() => {
                    setEditingJoin(null);
                    setIsJoinModalOpen(true);
                  }}
                  disabled={selectedTables.length === 0}
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
                    <div className="canvas-area__empty-inner">
                      Select one or more source tables from the left. They will appear here for join design and column selection.
                    </div>
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

              <div ref={relationshipLegendRef} className="canvas-legend">
                <div className="canvas-legend__row">
                  <span className="canvas-legend__label">LEGEND:</span>
                  {JOIN_LEGEND.map((item) => (
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
          </AiaBox>

          <AiaBox sx={{ p: 3, borderBottom: "1px solid #e2e8f0" }}>
            <FilterConditions
              tables={selectedTables}
              initialGroups={filterGroups}
              previewSql={effectiveSqlExpression}
              previewLabel="DERIVED SOURCE SQL PREVIEW"
              showPreview={false}
              onQueryChange={({ groups, whereSql }) => {
                setFilterGroups(groups);
                setFilterSql(whereSql);
                if (!whereSql) {
                  setValidationState((prev) =>
                    prev?.type === "success" ? { type: "success", message: "Query builder updated." } : prev
                  );
                }
              }}
            />
          </AiaBox>
          </AiaBox>
        </AiaBox>
      </AiaBox>

      <AiaBox
        sx={{
          px: 3,
          py: 2.25,
          borderTop: "1px solid #f1f5f9",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <AiaText sx={{ fontSize: 12, color: "#64748b" }}>
          {selectedColumnEntries.length} columns selected · {joins.length} joins configured
        </AiaText>
        <AiaBox sx={{ display: "flex", gap: 1.5 }}>
          <AiaButton
            variant="outlined"
            size="large"
            onClick={onClose}
            customBorderColor="var(--aia-primary-bg-color)"
            customColor="var(--aia-primary-bg-color)"
          >
            Cancel
          </AiaButton>
          <AiaButton
            variant="contained"
            size="large"
            color="primary"
            onClick={handleValidateSql}
            disabled={!selectedTableIds.length || isValidating}
            startIcon={isValidating ? <AiaCircularProgress size={16} color="inherit" /> : undefined}
            data-tour={TOUR_TARGETS.derivedValidateSql}
            {...derivedPrimaryButtonColors}
          >
            {isValidating ? "Validating..." : "Validate SQL"}
          </AiaButton>
          <AiaButton
            variant="contained"
            size="large"
            color="primary"
            onClick={handleConfirm}
            data-tour={TOUR_TARGETS.derivedAddTable}
            disabled={
              !sourceName.trim() ||
              selectedTableIds.length === 0 ||
              (selectedColumnEntries.length === 0 &&
                computedColumns.length === 0 &&
                previewColumnsState.length === 0) ||
              isSaving
            }
            {...derivedPrimaryButtonColors}
          >
            {isSaving ? "Saving..." : "Add Derived Table"}
          </AiaButton>
        </AiaBox>
      </AiaBox>

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
    </AiaDialog>
  );
}
