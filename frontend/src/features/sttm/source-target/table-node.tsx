"use client";

import React, { memo, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import TableChartIcon from "@mui/icons-material/TableChart";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import type { Column } from "@/features/sttm/types/sttm.types";

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
  selectableColumns?: boolean;
  selectedColumns?: string[];
  onToggleColumn?: (columnName: string, checked: boolean) => void;
  showColumnSearch?: boolean;
  onEdit?: () => void;
  compact?: boolean;
  [key: string]: unknown;
}

const MAX_VISIBLE_COLS = 5;
const MAX_EXPANDED_VISIBLE_COLS = 10;

function ColumnLeading({ col }: { col: Column }) {
  if (col.isPrimaryKey) {
    return <KeyIcon sx={{ fontSize: 16, color: "#ca8a04", flexShrink: 0 }} />;
  }
  if (col.isForeignKey) {
    return <LinkIcon sx={{ fontSize: 16, color: "#9ca3af", flexShrink: 0 }} />;
  }
  return (
    <span
      className="tnode__hollow"
      aria-hidden
    />
  );
}

function TableNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as TableNodeData;
  const [expanded, setExpanded] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const selectedColumns = useMemo(() => new Set(d.selectedColumns ?? []), [d.selectedColumns]);
  const filteredColumns = useMemo(() => {
    const query = columnSearch.trim().toLowerCase();
    if (!query) return d.columns;
    return d.columns.filter((column) =>
      `${column.name ?? ""} ${column.type ?? ""}`.toLowerCase().includes(query)
    );
  }, [columnSearch, d.columns]);
  const visibleCols = expanded ? filteredColumns : filteredColumns.slice(0, MAX_VISIBLE_COLS);
  const hiddenCount = Math.max(filteredColumns.length - MAX_VISIBLE_COLS, 0);
  const showScrollableList = expanded && filteredColumns.length > MAX_EXPANDED_VISIBLE_COLS;

  return (
    <div 
      className={`tnode ${d.compact ? "tnode--compact" : ""} ${selected ? "tnode--selected" : ""}`}
      style={{ cursor: d.onEdit ? "pointer" : "default" }}
      onClick={d.onEdit ? (e) => {
        // Prevent click from affecting the background / selection if needed
        e.stopPropagation();
        d.onEdit?.();
      } : undefined}
    >
      <div className="tnode__header">
        <div className="tnode__header-main">
          <div className="tnode__icon-wrap">
            <TableChartIcon sx={{ fontSize: 22, color: "#ffffff" }} />
          </div>
          <div className="tnode__header-text">
            <div className="tnode__title-row">
              <span className="tnode__name">
                {d.schema}.{d.label}
              </span>
              <span className="tnode__chip-row">
                <span
                  className="tnode__chip"
                  style={{ backgroundColor: d.tagBg, color: d.tagFg }}
                >
                  {d.tag}
                </span>
                {d.secondaryTag ? (
                  <span
                    className="tnode__chip"
                    style={{
                      backgroundColor: d.secondaryTagBg ?? "#dcfce7",
                      color: d.secondaryTagFg ?? "#166534",
                    }}
                  >
                    {d.secondaryTag}
                  </span>
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

      {d.showColumnSearch ? (
        <div className="tnode__search-wrap" onClick={(event) => event.stopPropagation()}>
          <div className="tnode__search">
            <SearchRoundedIcon sx={{ fontSize: 16, color: "#9ca3af", flexShrink: 0 }} />
            <input
              value={columnSearch}
              onChange={(event) => setColumnSearch(event.target.value)}
              placeholder="Search columns"
              className="tnode__search-input"
            />
          </div>
        </div>
      ) : null}

      <div className={`tnode__cols ${showScrollableList ? "tnode__cols--scrollable" : ""}`}>
        {visibleCols.map((col, index) => {
          const columnKey = `${d.database}.${d.schema}.${d.label}.${col.name ?? "column"}-${index}`;
          return (
          <div key={columnKey} className="tnode__col">
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
                {d.selectableColumns ? (
                  col.isPrimaryKey || col.isForeignKey ? (
                    <span className="tnode__col-key-inline">
                      <ColumnLeading col={col} />
                    </span>
                  ) : null
                ) : (
                  <span className="tnode__col-icon-slot">
                    <ColumnLeading col={col} />
                  </span>
                )}
                <span className="tnode__col-name">{col.name}</span>
              </div>
              <span className="tnode__col-type">{col.type}</span>
            </div>

            <Handle
              type="source"
              position={Position.Right}
              id={`${columnKey}-source`}
              className="tnode__handle tnode__handle--right"
              style={{ top: "50%" }}
            />
          </div>
        )})}
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
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
