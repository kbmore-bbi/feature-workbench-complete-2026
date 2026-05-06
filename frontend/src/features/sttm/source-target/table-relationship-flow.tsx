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

import { FilterConditions } from "./filter-conditions";
import { JoinModal } from "./join-modal";
import { TableEdge } from "./table-edge";
import { TableNode, type TableNodeData } from "./table-node";
import type { Column, JoinConfig, TableMeta, DerivedSource } from "@/features/sttm/types/sttm.types";
import { AddDerivedModal } from "./add-derived-modal";

const nodeTypes = { tableNode: TableNode };
const edgeTypes = { tableEdge: TableEdge };

function tagChipPalette(tag?: string) {
  const t = (tag || "").toLowerCase();
  if (t.includes("staging")) return { tagBg: "#f3e8ff", tagFg: "#7c3aed" };
  if (t.includes("sales")) return { tagBg: "#dbeafe", tagFg: "#1d4ed8" };
  if (t.includes("core")) return { tagBg: "#f3f4f6", tagFg: "#4b5563" };
  if (t.includes("transaction")) return { tagBg: "#ffedd5", tagFg: "#c2410c" };
  if (t.includes("master")) return { tagBg: "#e0e7ff", tagFg: "#4338ca" };
  if (t.includes("billing") || t.includes("finance"))
    return { tagBg: "#ecfdf5", tagFg: "#047857" };
  return { tagBg: "#f1f5f9", tagFg: "#475569" };
}

function buildColumnsForTable(tableName: string, colCountHint: number): Column[] {
  const t = tableName.toLowerCase();
  if (t.includes("order")) {
    return [
      { name: "ORDER_ID", type: "BIGINT", isPrimaryKey: true },
      { name: "CUST_ID", type: "INT", isForeignKey: true },
      { name: "ORDER_DATE", type: "DATE" },
      { name: "AMOUNT", type: "DECIMAL" },
      { name: "STATUS", type: "VARCHAR" },
      { name: "PRODUCT_ID", type: "INT", isForeignKey: true },
    ];
  }
  if (t.includes("customer")) {
    return [
      { name: "CUST_ID", type: "BIGINT", isPrimaryKey: true },
      { name: "NAME", type: "VARCHAR" },
      { name: "EMAIL", type: "VARCHAR" },
      { name: "REGION", type: "VARCHAR" },
      { name: "CREATED_AT", type: "DATE" },
      { name: "UPDATED_AT", type: "DATE" },
    ];
  }
  const base = tableName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const cols: Column[] = [
    { name: `${base}_ID`, type: "BIGINT", isPrimaryKey: true },
    { name: "REF_ID", type: "INT", isForeignKey: true },
    { name: "CREATED_AT", type: "DATE" },
    { name: "UPDATED_AT", type: "DATE" },
    { name: "STATUS", type: "VARCHAR" },
    { name: "AMOUNT", type: "DECIMAL" },
  ];
  while (cols.length < Math.max(3, colCountHint)) {
    cols.push({ name: `COL_${cols.length + 1}`, type: "VARCHAR" });
  }
  return cols.slice(0, Math.max(6, colCountHint));
}

export default function SttmTableRelationshipFlow() {
  const { fullData, drivingTableId, derivedSources, updateDerivedSource } = useSttmBuilderContext();

  const [editingDerivedSource, setEditingDerivedSource] = useState<DerivedSource | null>(null);
  const [isDerivedModalOpen, setIsDerivedModalOpen] = useState(false);

  const activeSourceTables: TableMeta[] = useMemo(() => {
    const tables: TableMeta[] = [];

    for (const db of fullData?.sources ?? []) {
      for (const sch of db.schemas ?? []) {
        for (const tbl of sch.tables ?? []) {
          if (!tbl.isSelected) continue;

          const chip = tagChipPalette(tbl.tag);
          tables.push({
            id: `${db.dbId}:${sch.schemaId}:${tbl.tableId}`,
            name: tbl.tableName,
            schema: sch.schemaName,
            database: db.dbName,
            rowCount: String(tbl.rows ?? "—"),
            colCount: tbl.columns ?? 6,
            columns: buildColumnsForTable(tbl.tableName, tbl.columns ?? 6),
            tag: tbl.tag ?? "Source",
            tagBg: chip.tagBg,
            tagFg: chip.tagFg,
          });
        }
      }
    }

    const derived: TableMeta[] = (derivedSources || []).map((ds: DerivedSource) => ({
      id: ds.id,
      name: ds.sourceName,
      schema: "DERIVED",
      database: "DERIVED",
      rowCount: "—",
      colCount: ds.columns.length,
      columns: ds.columns,
      tag: "Derived",
      tagBg: "#dcfce3",
      tagFg: "#166534",
    }));

    return [...tables, ...derived];
  }, [fullData, derivedSources]);

  const [joins, setJoins] = useState<JoinConfig[]>([]);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [editingJoin, setEditingJoin] = useState<JoinConfig | null>(null);

  useEffect(() => {
    setJoins([]);
  }, [drivingTableId]);

  useEffect(() => {
    const ids = new Set(activeSourceTables.map((t) => t.id));
    setJoins((prev) =>
      prev.filter(
        (j) =>
          !!j.leftTableId &&
          !!j.rightTableId &&
          ids.has(j.leftTableId) &&
          ids.has(j.rightTableId)
      )
    );
  }, [activeSourceTables]);

  const initialNodes = useMemo(() => {
    return activeSourceTables.map((t, idx) => ({
      id: t.id ?? `${t.database ?? "db"}:${t.schema ?? "schema"}:${t.name ?? idx}`,
      type: "tableNode",
      position: { x: 40 + idx * 300, y: 48 },
      data: {
        label: t.name ?? "—",
        schema: t.schema ?? "—",
        database: t.database ?? "—",
        tag: t.tag ?? "Source",
        tagBg: t.tagBg ?? "#f1f5f9",
        tagFg: t.tagFg ?? "#475569",
        rowCount: t.rowCount ?? "—",
        colCount: t.colCount ?? 0,
        columns: t.columns ?? [],
        onEdit: t.schema === "DERIVED" ? () => {
          const ds = derivedSources.find((s: DerivedSource) => s.id === t.id);
          if (ds) {
            setEditingDerivedSource(ds);
            setIsDerivedModalOpen(true);
          }
        } : undefined,
      } satisfies TableNodeData,
    }));
  }, [activeSourceTables]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  const derivedEdges: Edge[] = useMemo(() => {
    return joins
      .map((j) => {
        const first = j.conditions?.[0];
        if (!j.id || !j.leftTableId || !j.rightTableId || !first) return null;
        if (!first.leftColumn || !first.rightColumn) return null;
        return {
          id: j.id,
          source: j.leftTableId,
          target: j.rightTableId,
          sourceHandle: `${first.leftColumn}-source`,
          targetHandle: `${first.rightColumn}-target`,
          type: "tableEdge",
          data: {
            joinType: j.joinType ?? "INNER",
            conditionCount: j.conditions?.length ?? 0,
            onDelete: (id: string) =>
              setJoins((prev) => prev.filter((x) => x.id !== id)),
            onEdit: (id: string) => {
              const joinToEdit = joins.find((x) => x.id === id);
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
  }, [joins]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  const handleAddJoin = (join: JoinConfig) => {
    setJoins((prev) => {
      const existingIdx = prev.findIndex((j) => j.id === join.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = join;
        return updated;
      }
      return [...prev, join];
    });
  };

  const onConnect = useCallback((params: Connection) => {
    const leftTableId = params.source;
    const rightTableId = params.target;
    const leftColumn = params.sourceHandle?.replace("-source", "");
    const rightColumn = params.targetHandle?.replace("-target", "");

    if (!leftTableId || !rightTableId || !leftColumn || !rightColumn) return;

    const existing = joins.find(
      (j) => j.leftTableId === leftTableId && j.rightTableId === rightTableId
    );
    setEditingJoin(
      existing ?? {
        id: `${leftTableId}__${rightTableId}`,
        leftTableId,
        rightTableId,
        joinType: "INNER",
        conditions: [
          { leftColumn, operator: "=", rightColumn },
        ],
      }
    );
    setIsJoinModalOpen(true);
  }, [joins]);

  const joinCount = joins.length;
  const joinBadgeLabel = joinCount === 1 ? "1 join" : `${joinCount} joins`;

  const joinLegend = [
    { label: "INNER JOIN", bg: "#111827" },
    { label: "LEFT JOIN", bg: "#1e40af" },
    { label: "RIGHT JOIN", bg: "#0d9488" },
    { label: "FULL JOIN", bg: "#9333ea" },
  ];

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
            disabled={activeSourceTables.length === 0}
            style={{
              opacity: activeSourceTables.length === 0 ? 0.5 : 1,
              cursor: activeSourceTables.length === 0 ? "not-allowed" : "pointer"
            }}
          >
            + Add Join
          </button>
        </div>

        <div className="canvas-area__flow-host">
          {nodes.length === 0 ? (
            <div className="canvas-area__empty" aria-hidden>
              <div className="canvas-area__empty-inner">
                Select one or more tables from Source selection. They will appear
                here so you can define joins and relationships.
              </div>
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
            fitView={nodes.length > 0}
            fitViewOptions={{ padding: 0.2 }}
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
            {joinLegend.map((jt) => (
              <span
                key={jt.label}
                className="canvas-legend__chip"
                style={{ backgroundColor: jt.bg }}
              >
                {jt.label}
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

      <FilterConditions tables={activeSourceTables} />

      <JoinModal
        isOpen={isJoinModalOpen}
        onClose={() => {
          setIsJoinModalOpen(false);
          setEditingJoin(null);
        }}
        tables={activeSourceTables}
        editingJoin={editingJoin}
        onConfirm={(join: JoinConfig) => {
          setJoins((prev) => {
            const next = prev.filter((j) => j.id !== join.id);
            return [...next, join];
          });
        }}
      />
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
    </div>
  );
}
