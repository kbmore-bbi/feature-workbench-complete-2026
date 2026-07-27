"use client";

import React, { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

import { AiaTooltip } from "@/components/ui/aia-tooltip";

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
  const [edgeHovered, setEdgeHovered] = useState(false);

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
  const tooltipLabel = edgeData?.label ?? `${joinType} · ${edgeData?.conditionCount ?? 1}`;
  const stroke = joinStrokeColor(joinType);
  const readOnly = edgeData?.readOnly ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "#4f46e5" : stroke,
          strokeWidth: 1,
          strokeDasharray: "3",
          pointerEvents: "none",
        }}
      />

      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ cursor: "pointer", pointerEvents: "stroke" }}
        onMouseEnter={() => setEdgeHovered(true)}
        onMouseLeave={() => setEdgeHovered(false)}
      />

      <EdgeLabelRenderer>
        <AiaTooltip
          title={tooltipLabel}
          open={edgeHovered}
          disableFocusListener
          disableTouchListener
          placement="top"
          arrow
        >
          <span
            className="tedge-tooltip-anchor"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </AiaTooltip>

        {!readOnly ? (
          <div
            className="tedge-actions"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <button
              type="button"
              className="tedge-label__icon-btn tedge-label__icon-btn--edit"
              onClick={(event) => {
                event.stopPropagation();
                edgeData?.onEdit?.(id);
              }}
              aria-label="Edit join"
            >
              ✎
            </button>
            <button
              type="button"
              className="tedge-label__icon-btn tedge-label__icon-btn--delete"
              onClick={(event) => {
                event.stopPropagation();
                edgeData?.onDelete?.(id);
              }}
              aria-label="Delete join"
            >
              ✕
            </button>
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}
