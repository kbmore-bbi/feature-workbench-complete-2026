"use client";
import React, { memo, useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  KeyIcon,
  KeyboardArrowDownRoundedIcon,
  KeyboardArrowRightRoundedIcon,
  KeyboardArrowUpRoundedIcon,
  LinkIcon,
  TableChartIcon,
} from '@/utils/icons';

import type { Column } from "@/features/sttm/types/sttm.types";
import { AiaChip } from "@/components/ui/aia-chip";
import { AiaSearchbox } from "@/components/ui/aia-searchbox";
import { buildTableHeaderHandleKey } from "./relationship-handles";

export interface TableNodeData {
  label: string;
  schema: string;
  database: string;
  tag: string;
  tagBg: string;
  tagFg: string;
  secondaryTag?: string;
  secondaryTagBg?: string;
  secondaryTagFg?: string;
  rowCount: string;
  colCount: number;
  columns: Column[];
  width?: number | string;
  accentColor?: string;
  surfaceTint?: string;
  headerBg?: string;
  iconBg?: string;
  iconColor?: string;
  selectableColumns?: boolean;
  selectedColumns?: string[];
  highlightedColumns?: string[];
  activeColumnName?: string | null;
  globalColumnSearch?: string;
  onColumnSelect?: (columnName: string) => void;
  onToggleColumn?: (columnName: string, checked: boolean) => void;
  showColumnSearch?: boolean;
  onEdit?: () => void;
  compact?: boolean;
  expandAllToken?: number;
  variant?: "default" | "lineage";
  mappedCount?: number;
  totalColumns?: number;
  badgeBg?: string;
  badgeFg?: string;
  pillBg?: string;
  pillBorder?: string;
  pillFg?: string;
  [key: string]: unknown;
}

const MAX_VISIBLE_COLS = 4;

function ColumnKeyIcon({ col }: { col: Column }) {
  if (col.isPrimaryKey) {
    return <KeyIcon sx={{ fontSize: 16, color: "#ca8a04", flexShrink: 0 }} />;
  }
  if (col.isForeignKey) {
    return <LinkIcon sx={{ fontSize: 16, color: "#9ca3af", flexShrink: 0 }} />;
  }
  return null;
}

function TableTagChip({ tag }: { tag: string }) {
  if (tag.toLowerCase() === "driving") {
    return (
      <AiaChip
        label={tag}
        size="small"
        color="warning"
        customBackgroundColor="rgb(250 204 21 / 35%)"
        customColor="#9f8500"
        customBorderColor="rgba(250,204,21,0.45)"
      />
    );
  }

  return <AiaChip label={tag} size="small" color="default" />;
}

function TableHeaderHandles({
  database,
  schema,
  label,
}: {
  database: string;
  schema: string;
  label: string;
}) {
  const tableRef = { database, schema, label };

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id={buildTableHeaderHandleKey(tableRef, "target")}
        className="tnode__handle tnode__handle--left tnode__handle--header"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={buildTableHeaderHandleKey(tableRef, "source")}
        className="tnode__handle tnode__handle--right tnode__handle--header"
      />
    </>
  );
}

function TableNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as TableNodeData;
  const isLineage = d.variant === "lineage";
  const [expanded, setExpanded] = useState(false);
  const [columnsCollapsed, setColumnsCollapsed] = useState(isLineage);
  const [columnSearch, setColumnSearch] = useState("");
  const selectedColumns = useMemo(() => new Set(d.selectedColumns ?? []), [d.selectedColumns]);
  const highlightedColumns = useMemo(
    () => new Set((d.highlightedColumns ?? []).map((column) => column.toLowerCase())),
    [d.highlightedColumns],
  );
  const filteredColumns = useMemo(() => {
    const query = (columnSearch || d.globalColumnSearch || "").trim().toLowerCase();
    if (!query) return d.columns;
    return d.columns.filter((column) =>
      `${column.name ?? ""} ${column.type ?? ""}`.toLowerCase().includes(query)
    );
  }, [columnSearch, d.columns, d.globalColumnSearch]);
  const visibleCols = expanded ? filteredColumns : filteredColumns.slice(0, MAX_VISIBLE_COLS);
  const hiddenCount = Math.max(filteredColumns.length - MAX_VISIBLE_COLS, 0);
  const accentColor = d.accentColor ?? "#2563eb";
  const mappedCount = d.mappedCount ?? 0;
  const totalColumns = d.totalColumns ?? d.colCount;
  const mappingLabel = `${mappedCount}/${totalColumns}`;

  useEffect(() => {
    if (!d.expandAllToken) {
      return;
    }
    setExpanded(true);
    setColumnsCollapsed(false);
  }, [d.expandAllToken]);

  const columnList = (
    <>
      {d.showColumnSearch ? (
        <div className="tnode__search-wrap" onClick={(event) => event.stopPropagation()}>
          <AiaSearchbox
            value={columnSearch}
            onChange={setColumnSearch}
            placeholder="Search columns"
            className="tnode__search"
            sx={{
              minHeight: 0,
              py: 0.5,
              px: 1,
              backgroundColor: "#f9fafb",
              border: "1px solid #e5e7eb",
              "&:focus-within": {
                backgroundColor: "#ffffff",
                borderColor: "#cbd5e1",
                boxShadow: "none",
              },
            }}
            inputSx={{
              "& .MuiInputBase-input": {
                fontSize: 12,
              },
            }}
          />
        </div>
      ) : null}

      <div className="tnode__cols">
        {visibleCols.map((col) => {
          const columnKey = `${d.database}.${d.schema}.${d.label}.${col.name ?? "column"}`;
          const isHighlighted = highlightedColumns.has(String(col.name ?? "").toLowerCase());
          const isActiveColumn = d.activeColumnName === col.name;
          return (
            <div
              key={columnKey}
              className="tnode__col"
              style={{
                backgroundColor: isActiveColumn
                  ? "rgba(29, 78, 216, 0.12)"
                  : isHighlighted
                    ? "rgba(251, 191, 36, 0.18)"
                    : undefined,
                cursor: d.onColumnSelect ? "pointer" : "default",
              }}
              onClick={(event) => {
                if (!d.onColumnSelect || !col.name) {
                  return;
                }
                event.stopPropagation();
                d.onColumnSelect(col.name);
              }}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${columnKey}-target`}
                className="tnode__handle tnode__handle--left"
                style={{ top: "50%" }}
              />

              <div className="tnode__col-inner">
                <div className="tnode__col-left">
                  {d.selectableColumns ? (
                    <input
                      type="checkbox"
                      checked={selectedColumns.has(col.name ?? "")}
                      onChange={(event) =>
                        d.onToggleColumn?.(col.name ?? "", event.target.checked)
                      }
                      onClick={(event) => event.stopPropagation()}
                      style={{ width: 16, height: 16, margin: 0, accentColor: "#2563eb", flexShrink: 0 }}
                    />
                  ) : null}
                  <span className="tnode__col-name-group">
                    <span
                      className="tnode__col-name"
                      style={{
                        color: isActiveColumn
                          ? "#1d4ed8"
                          : isHighlighted
                            ? "#92400e"
                            : undefined,
                      }}
                    >
                      {col.name}
                    </span>
                    {col.isPrimaryKey || col.isForeignKey ? (
                      <span className="tnode__col-key-inline">
                        <ColumnKeyIcon col={col} />
                      </span>
                    ) : null}
                  </span>
                </div>
                <span className="tnode__col-type">{(col.type ?? "").toLowerCase()}</span>
              </div>

              <Handle
                type="source"
                position={Position.Right}
                id={`${columnKey}-source`}
                className="tnode__handle tnode__handle--right"
                style={{ top: "50%" }}
              />
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="tnode__more"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          style={{ background: "none", border: "none", cursor: "pointer" }}
        >
          {expanded ? "Show less" : `+${hiddenCount} more`}
        </button>
      )}
    </>
  );

  if (isLineage) {
    return (
      <div
        className={`tnode tnode--lineage ${selected ? "tnode--selected" : ""}`}
        style={{
          width: d.width ?? 340,
          cursor: d.onEdit ? "pointer" : "default",
          borderColor: selected ? "#93c5fd" : accentColor,
        }}
        onClick={
          d.onEdit
            ? (event) => {
                event.stopPropagation();
                d.onEdit?.();
              }
            : undefined
        }
      >
        <div className="tnode__lineage-header" style={{ backgroundColor: d.headerBg ?? "#eef6ff" }}>
          <TableHeaderHandles database={d.database} schema={d.schema} label={d.label} />
          <div className="tnode__lineage-header-inner">
            <div
              className="tnode__icon-wrap tnode__icon-wrap--lineage"
              style={{ backgroundColor: d.iconBg ?? "#dbeafe" }}
            >
              <TableChartIcon sx={{ fontSize: 20, color: d.iconColor ?? accentColor }} />
            </div>
            <div className="tnode__lineage-text">
              <div className="tnode__lineage-top-row">
                <span className="tnode__lineage-meta" style={{ color: accentColor }}>
                  {d.database} · {d.tag}
                </span>
                <div className="tnode__lineage-actions">
                  <span
                    className="tnode__lineage-map-badge"
                    style={{
                      backgroundColor: d.badgeBg ?? "#dbeafe",
                      color: d.badgeFg ?? accentColor,
                    }}
                  >
                    {mappingLabel}
                  </span>
                  <button
                    type="button"
                    className="tnode__lineage-expand"
                    style={{
                      borderColor: `${accentColor}33`,
                      backgroundColor: `${accentColor}12`,
                      color: accentColor,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setColumnsCollapsed((previous) => !previous);
                    }}
                    aria-label={columnsCollapsed ? "Expand columns" : "Collapse columns"}
                  >
                    {columnsCollapsed ? (
                      <KeyboardArrowRightRoundedIcon sx={{ fontSize: 18 }} />
                    ) : (
                      <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18 }} />
                    )}
                  </button>
                </div>
              </div>
              <div className="tnode__lineage-name">{d.label}</div>
            </div>
          </div>
        </div>

        <div className="tnode__lineage-body">
          {columnsCollapsed ? (
            <div className="tnode__lineage-footer">
              <span
                className="tnode__lineage-columns-pill"
                style={{
                  backgroundColor: d.pillBg ?? "#f8fbff",
                  borderColor: d.pillBorder ?? "#bfdbfe",
                  color: d.pillFg ?? accentColor,
                }}
              >
                <span
                  className="tnode__lineage-dot"
                  style={{ backgroundColor: accentColor }}
                  aria-hidden
                />
                {d.colCount} column{d.colCount === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            columnList
          )}
        </div>
      </div>
    );
  }

  const visibleColumnNames = useMemo(
    () => new Set(visibleCols.map((column) => column.name ?? "")),
    [visibleCols],
  );
  const hiddenHandleColumns = useMemo(
    () => d.columns.filter((column) => !visibleColumnNames.has(column.name ?? "")),
    [d.columns, visibleColumnNames],
  );

  return (
    <div 
      className={`tnode ${d.compact ? "tnode--compact" : ""} ${selected ? "tnode--selected" : ""}`}
      style={{
        width: d.width ?? (d.compact ? 268 : 360),
        cursor: d.onEdit ? "pointer" : "default",
        backgroundColor: d.surfaceTint ?? "#ffffff",
        borderColor: selected ? "#93c5fd" : d.accentColor ? `${d.accentColor}45` : undefined,
      }}
      onClick={d.onEdit ? (e) => {
        // Prevent click from affecting the background / selection if needed
        e.stopPropagation();
        d.onEdit?.();
      } : undefined}
    >
      {d.accentColor ? (
        <div
          style={{
            height: 4,
            width: "100%",
            background: `linear-gradient(90deg, ${d.accentColor}, ${d.accentColor}cc)`,
          }}
        />
      ) : null}
      <div className="tnode__header" style={{ backgroundColor: d.headerBg ?? "#f9fafb" }}>
        <TableHeaderHandles database={d.database} schema={d.schema} label={d.label} />
        <div className="tnode__header-main">
          <div
            className="tnode__icon-wrap"
            style={{ backgroundColor: d.iconBg ?? "#111827" }}
          >
            <TableChartIcon sx={{ fontSize: 22, color: d.iconColor ?? "#ffffff" }} />
          </div>
          <div className="tnode__header-text">
            <div className="tnode__title-row">
              <span className="tnode__name">
                {d.schema}.{d.label}
              </span>
              <span className="tnode__chip-row">
                <TableTagChip tag={d.tag} />
                {d.secondaryTag ? (
                  <AiaChip label={d.secondaryTag} size="small" color="success" />
                ) : null}
              </span>
            </div>
            <div className="tnode__meta">
              {d.colCount} cols · {d.rowCount} rows
            </div>
          </div>
        </div>
      </div>

      <div className="tnode__divider" />

      <div className="tnode__section-head">
        <button
          type="button"
          className="tnode__section-toggle"
          onClick={(event) => {
            event.stopPropagation();
            setColumnsCollapsed((previous) => !previous);
          }}
        >
          <span>Columns</span>
          <span className="tnode__section-meta">
            {filteredColumns.length}
            {columnsCollapsed ? (
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <KeyboardArrowUpRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </span>
        </button>
      </div>

      {!columnsCollapsed ? (
        <>
          {hiddenHandleColumns.length ? (
            <div
              aria-hidden
              style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
            >
              {hiddenHandleColumns.map((col) => {
                const columnKey = `${d.database}.${d.schema}.${d.label}.${col.name ?? "column"}`;
                return (
                  <React.Fragment key={`${columnKey}-hidden`}>
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={`${columnKey}-target`}
                      className="tnode__handle tnode__handle--left"
                      style={{ top: 0 }}
                    />
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={`${columnKey}-source`}
                      className="tnode__handle tnode__handle--right"
                      style={{ top: 0 }}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          ) : null}
          {columnList}
        </>
      ) : null}
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
