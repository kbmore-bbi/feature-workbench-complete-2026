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
  label?: string;
  readOnly?: boolean;
  dashed?: boolean;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  [key: string]: unknown;
}

function joinStrokeColor(joinType?: string) {
  switch ((joinType ?? "INNER").toUpperCase()) {
    case "LEFT":
      return "#1d4ed8";
    case "RIGHT":
      return "#0f766e";
    case "FULL":
      return "#7c3aed";
    default:
      return "#111827";
  }
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
  const label = edgeData?.label ?? `${joinType} · ${edgeData?.conditionCount ?? 1}`;
  const count = edgeData?.conditionCount ?? 1;
  const stroke = joinStrokeColor(joinType);
  const readOnly = edgeData?.readOnly ?? false;
  const dashed = edgeData?.dashed ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "#4f46e5" : stroke,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: dashed ? "6 4" : undefined,
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
            {!readOnly ? (
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
            ) : null}
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: selected ? "#4338ca" : stroke,
                padding: "0 4px",
                minWidth: 56,
                textAlign: "center",
              }}
              title={label}
            >
              {label}
            </div>
            {!readOnly ? (
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
            ) : null}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
