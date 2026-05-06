"use client";

import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export interface TableEdgeData {
  joinType?: string;
  conditionCount?: number;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  [key: string]: unknown;
}

export function TableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeData = data as TableEdgeData | undefined;
  const joinType = edgeData?.joinType || "INNER";
  const count = edgeData?.conditionCount ?? 1;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "#4f46e5" : "#cbd5e1",
          strokeWidth: selected ? 2.5 : 2,
        }}
      />

      <EdgeLabelRenderer>
        <div
          className={`tedge-label ${selected ? "tedge-label--selected" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          <div className="tedge-label__inner">
            <button
              className="tedge-label__icon-btn tedge-label__icon-btn--edit"
              onClick={(e) => {
                e.stopPropagation();
                edgeData?.onEdit?.(id);
              }}
              title="Edit Join"
            >
              ✎
            </button>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                padding: "0 2px",
              }}
              title={`${joinType} JOIN (${count} condition${count === 1 ? "" : "s"})`}
            >
              {count}
            </div>
            <button
              className="tedge-label__icon-btn tedge-label__icon-btn--delete"
              onClick={(e) => {
                e.stopPropagation();
                edgeData?.onDelete?.(id);
              }}
              title="Delete Join"
            >
              ✕
            </button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

