"use client";

import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import TableChartIcon from "@mui/icons-material/TableChart";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";
import type { Column } from "@/features/sttm/types/sttm.types";

export interface TableNodeData {
  label: string;
  schema: string;
  database: string;
  tag: string;
  tagBg: string;
  tagFg: string;
  rowCount: string;
  colCount: number;
  columns: Column[];
  onEdit?: () => void;
  [key: string]: unknown;
}

const MAX_VISIBLE_COLS = 5;

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
  const visibleCols = d.columns.slice(0, MAX_VISIBLE_COLS);
  const hiddenCount = d.columns.length - MAX_VISIBLE_COLS;

  return (
    <div 
      className={`tnode ${selected ? "tnode--selected" : ""}`}
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
              <span
                className="tnode__chip"
                style={{ backgroundColor: d.tagBg, color: d.tagFg }}
              >
                {d.tag}
              </span>
            </div>
            <div className="tnode__meta">
              {d.colCount} cols · {d.rowCount} rows
            </div>
          </div>
        </div>
      </div>

      <div className="tnode__divider" />

      <div className="tnode__cols">
        {visibleCols.map((col) => (
          <div key={col.name} className="tnode__col">
            <Handle
              type="target"
              position={Position.Left}
              id={`${col.name}-target`}
              className="tnode__handle tnode__handle--left"
              style={{ top: "50%" }}
            />

            <div className="tnode__col-inner">
              <div className="tnode__col-left">
                <span className="tnode__col-icon-slot">
                  <ColumnLeading col={col} />
                </span>
                <span className="tnode__col-name">{col.name}</span>
              </div>
              <span className="tnode__col-type">{col.type}</span>
            </div>

            <Handle
              type="source"
              position={Position.Right}
              id={`${col.name}-source`}
              className="tnode__handle tnode__handle--right"
              style={{ top: "50%" }}
            />
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <div className="tnode__more">+{hiddenCount} more</div>
      )}
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
