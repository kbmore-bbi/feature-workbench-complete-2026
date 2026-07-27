"use client";
import { AiaBox, AiaDivider, AiaIconButton, AiaChip, AiaPaper, AiaStack } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { AutoFixHighRoundedIcon, CloseRoundedIcon, FilterAltRoundedIcon, HubRoundedIcon, NorthEastRoundedIcon } from '@/utils/icons';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";

import { useSttmBuilderContext } from "@/features/sttm/context/sttm-builder-context";
import { TableNode, type TableNodeData } from "@/features/sttm/source-target/table-node";
import { LineageWorkspaceHeader } from "./lineage-workspace-header";
import {
  buildLineageGraph,
  buildNodeLevels,
  buildOrderedLevelGroups,
  describeRuleGroup,
  formatColumnReference,
  readableLineageDepth,
  readableNodeLabel,
  readableOperationLabel,
  getLineageCardTheme,
  getNodeMappingProgress,
  summarizeNode,
  type LineageEdgeOperation,
  type LineageGraphEdge,
  type LineageGraphNode,
  type LineageMappingDetail,
} from "./lineage-utils";

const nodeTypes = { tableNode: TableNode };

const SOURCE_LEGEND_COLORS = ["#8b5cf6", "#1d4ed8", "#2563eb", "#0891b2"];

type LineageFocus =
  | { kind: "overview" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

type LineageEdgeData = LineageGraphEdge & {
  onInspect: (id: string) => void;
};

function toneColors(tone: LineageEdgeOperation["tone"]) {
  switch (tone) {
    case "source":
      return { bg: "#dbeafe", fg: "#1d4ed8", border: "#bfdbfe" };
    case "derived":
      return { bg: "#ffedd5", fg: "#b45309", border: "#fed7aa" };
    case "target":
      return { bg: "#dbeafe", fg: "#003D59", border: "#bfd9e5" };
    default:
      return { bg: "#f1f5f9", fg: "#475569", border: "#dbe2ea" };
  }
}

function OperationIcon({
  icon,
  fontSize = 14,
}: {
  icon: LineageEdgeOperation["icon"];
  fontSize?: number;
}) {
  if (icon === "join") {
    return <HubRoundedIcon sx={{ fontSize }} />;
  }
  if (icon === "filter") {
    return <FilterAltRoundedIcon sx={{ fontSize }} />;
  }
  if (icon === "direct") {
    return <NorthEastRoundedIcon sx={{ fontSize }} />;
  }
  return <AutoFixHighRoundedIcon sx={{ fontSize }} />;
}

function LineageOperationChip({
  operation,
  compact = false,
}: {
  operation: LineageEdgeOperation;
  compact?: boolean;
}) {
  const colors = toneColors(operation.tone);

  return (
    <AiaChip
      label={operation.label}
      size="small"
      icon={<OperationIcon icon={operation.icon} fontSize={compact ? 12 : 14} />}
      customBackgroundColor={colors.bg}
      customColor={colors.fg}
      customBorderColor={colors.border}
      sx={{
        height: compact ? 24 : 26,
        fontSize: compact ? 10.5 : 11.5,
        fontWeight: 800,
      }}
    />
  );
}

function LineageOperationBadge({ operation }: { operation: LineageEdgeOperation }) {
  const colors = toneColors(operation.tone);

  return (
    <AiaBox
      sx={{
        width: 30,
        height: 30,
        borderRadius: "12px",
        backgroundColor: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 6px 14px rgba(15, 23, 42, 0.08)",
      }}
      title={operation.label}
    >
      <OperationIcon icon={operation.icon} fontSize={17} />
    </AiaBox>
  );
}

function LineageEdgeView({
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

  const edgeData = data as LineageEdgeData | undefined;
  if (!edgeData) {
    return null;
  }

  const visibleOperations = (edgeData.operations ?? []).slice(0, 2);
  const extraCount = Math.max((edgeData.operations?.length ?? 0) - visibleOperations.length, 0);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "#4f46e5" : edgeData.strokeColor,
          strokeWidth: selected ? 3 : 2.4,
        }}
      />

      <EdgeLabelRenderer>
        <AiaBox
          sx={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            zIndex: 20,
          }}
        >
          <AiaPaper
            elevation={0}
            component="button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              edgeData.onInspect(id);
            }}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.65,
              px: 0.7,
              py: 0.55,
              borderRadius: "16px",
              border: selected
                ? "1px solid rgba(79, 70, 229, 0.45)"
                : "1px solid rgba(148, 163, 184, 0.28)",
              backgroundColor: "rgba(255, 255, 255, 0.98)",
              boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
              cursor: "pointer",
            }}
          >
            {visibleOperations.map((operation, index) => (
              <LineageOperationBadge
                key={`${id}-${operation.label}-${index}`}
                operation={operation}
              />
            ))}
            {extraCount > 0 ? (
              <AiaBox
                sx={{
                  minWidth: 24,
                  height: 24,
                  px: 0.8,
                  borderRadius: "999px",
                  backgroundColor: "#e2e8f0",
                  color: "#334155",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10.5,
                  fontWeight: 900,
                }}
              >
                +{extraCount}
              </AiaBox>
            ) : null}
          </AiaPaper>
        </AiaBox>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { lineageEdge: LineageEdgeView };

const LINEAGE_FIT_VIEW_OPTIONS = {
  padding: 0.26,
  minZoom: 0.25,
  maxZoom: 1,
  duration: 180,
} as const;

type LineageFlowCanvasProps = {
  layoutSignature: string;
  nodes: Node<TableNodeData>[];
  edges: Edge<LineageEdgeData>[];
  onNodesChange: ReturnType<typeof useNodesState<Node<TableNodeData>>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<Edge<LineageEdgeData>>>[2];
  onInspectNode: (nodeId: string) => void;
  onInspectEdge: (edgeId: string) => void;
  onPaneClick: () => void;
};

function LineageFlowCanvas({
  layoutSignature,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onInspectNode,
  onInspectEdge,
  onPaneClick,
}: LineageFlowCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<
    ReactFlowInstance<Node<TableNodeData>, Edge<LineageEdgeData>> | null
  >(null);
  const fitFrameRef = useRef<number | null>(null);

  const scheduleFitView = useCallback(() => {
    const instance = flowInstanceRef.current;
    const host = hostRef.current;
    if (!instance || !host || nodes.length === 0 || host.clientHeight < 80) {
      return;
    }
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      void instance.fitView(LINEAGE_FIT_VIEW_OPTIONS);
    });
  }, [nodes.length]);

  useEffect(() => {
    scheduleFitView();
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(scheduleFitView);
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current);
      }
    };
  }, [layoutSignature, scheduleFitView]);

  return (
    <AiaBox ref={hostRef} sx={{ flex: 1, minHeight: 0, height: "100%", position: "relative" }}>
      <ReactFlow
        minZoom={0.25}
        maxZoom={1.2}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          flowInstanceRef.current = instance;
          scheduleFitView();
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onInspectNode(node.id)}
        onEdgeClick={(_, edge) => onInspectEdge(edge.id)}
        onPaneClick={onPaneClick}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "lineageEdge", animated: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="#dbe2ea" />
        <Controls position="bottom-right" style={{ marginBottom: 16, marginRight: 16 }} />
      </ReactFlow>
    </AiaBox>
  );
}

function estimateNodeWidth(node: LineageGraphNode) {
  const longestColumnLength = node.columns.reduce((longest, column) => {
    return Math.max(longest, `${column.name ?? ""}${column.type ? ` ${column.type}` : ""}`.length);
  }, 0);

  const baseWidth = 340;
  const columnWidth = longestColumnLength * 6.2 + 128;

  return Math.max(baseWidth, Math.min(470, Math.ceil(columnWidth)));
}

function buildNodePositionMap(
  groups: Map<number, LineageGraphNode[]>,
  nodes: LineageGraphNode[],
) {
  const positions = new Map<string, { x: number; y: number }>();
  const orderedLevels = Array.from(groups.keys()).sort((left, right) => left - right);
  const maxRows = Math.max(1, ...orderedLevels.map((level) => groups.get(level)?.length ?? 0));
  const verticalGap = 228;
  const horizontalGap = 460;
  const topPadding = 72;
  const leftPadding = 40;
  const tallestColumnHeight = (maxRows - 1) * verticalGap;

  orderedLevels.forEach((level, levelIndex) => {
    const items = groups.get(level) ?? [];
    const columnHeight = Math.max(0, (items.length - 1) * verticalGap);
    const startY = topPadding + (tallestColumnHeight - columnHeight) / 2;

    items.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x: leftPadding + levelIndex * horizontalGap,
        y: startY + rowIndex * verticalGap,
      });
    });
  });

  nodes.forEach((node) => {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: leftPadding, y: topPadding });
    }
  });

  return positions;
}

function describeFocusedMappings(
  selectedTargetColumn: string | null,
  edges: LineageGraphEdge[],
  nodes: LineageGraphNode[],
) {
  if (!selectedTargetColumn) {
    return [];
  }

  return edges
    .filter((edge) => edge.kind === "mapping")
    .flatMap((edge) =>
      edge.mappings
        .filter((mapping) => mapping.targetColumn === selectedTargetColumn)
        .map((mapping) => ({
          edgeId: edge.id,
          sourceLabel: readableNodeLabel(edge.source, nodes),
          sourceId: edge.source,
          mapping,
        })),
    );
}

function describeUpstreamPath(
  selectedTargetColumn: string | null,
  edges: LineageGraphEdge[],
  nodes: LineageGraphNode[],
) {
  if (!selectedTargetColumn) {
    return [];
  }

  return edges
    .filter((edge) => edge.kind !== "mapping")
    .map((edge) => ({
      ...edge,
      sourceLabel: readableNodeLabel(edge.source, nodes),
      targetLabel: readableNodeLabel(edge.target, nodes),
    }));
}

export default function LineageTab() {
  const {
    sources,
    targets,
    sourceAttributeGroups,
    targetAttributeGroup,
    relationships,
    derivedSources,
    mappings,
    semanticLineage,
  } = useSttmBuilderContext();

  const deferredSearch = "";
  const [focus, setFocus] = useState<LineageFocus>({ kind: "overview" });
  const [selectedTargetColumn, setSelectedTargetColumn] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [expandAllToken, setExpandAllToken] = useState(0);

  const graph = useMemo(
    () =>
      buildLineageGraph({
        sources,
        targets,
        sourceAttributeGroups,
        targetAttributeGroup,
        relationships,
        derivedSources,
        mappings,
        semanticLineage,
        selectedTargetColumn,
      }),
    [
      derivedSources,
      mappings,
      relationships,
      selectedTargetColumn,
      semanticLineage,
      sourceAttributeGroups,
      sources,
      targetAttributeGroup,
      targets,
    ],
  );

  const levels = useMemo(
    () => buildNodeLevels(graph.nodes, graph.edges, graph.targetNodeId),
    [graph.edges, graph.nodes, graph.targetNodeId],
  );

  const orderedGroups = useMemo(
    () => buildOrderedLevelGroups(graph.nodes, graph.edges, levels),
    [graph.edges, graph.nodes, levels],
  );

  const handleTargetColumnSelect = useCallback(
    (columnName: string) => {
      startTransition(() => {
        setSelectedTargetColumn((previous) => (previous === columnName ? null : columnName));
      });
      if (graph.targetNodeId) {
        setFocus({ kind: "node", id: graph.targetNodeId });
      }
      setIsDetailsOpen(true);
    },
    [graph.targetNodeId],
  );

  const positionedNodes = useMemo<Node<TableNodeData>[]>(() => {
    const positions = buildNodePositionMap(orderedGroups, graph.nodes);
    let sourceIndex = 0;

    return graph.nodes.map((node) => {
      const position = positions.get(node.id) ?? { x: 40, y: 40 };
      const summary = summarizeNode(node, graph.edges);
      const mappingProgress = getNodeMappingProgress(node);
      const sourceAccent =
        node.kind === "source"
          ? SOURCE_LEGEND_COLORS[sourceIndex++ % SOURCE_LEGEND_COLORS.length]
          : undefined;
      const cardTheme = getLineageCardTheme(node, sourceAccent);

      return {
        id: node.id,
        type: "tableNode",
        draggable: true,
        position,
        data: {
          label: node.label,
          schema: node.schema,
          database: node.database,
          tag: node.tag.toUpperCase(),
          tagBg: cardTheme.badgeBg,
          tagFg: cardTheme.badgeFg,
          rowCount: node.rowCount,
          colCount: node.colCount,
          columns: node.columns,
          width: estimateNodeWidth(node),
          variant: "lineage",
          mappedCount: mappingProgress.mapped,
          totalColumns: mappingProgress.total,
          showColumnSearch: true,
          globalColumnSearch: deferredSearch,
          highlightedColumns: node.highlightedColumns,
          activeColumnName: node.id === graph.targetNodeId ? selectedTargetColumn : null,
          onColumnSelect: node.id === graph.targetNodeId ? handleTargetColumnSelect : undefined,
          accentColor: cardTheme.accentColor,
          surfaceTint: "#ffffff",
          headerBg: cardTheme.headerBg,
          iconBg: cardTheme.iconBg,
          iconColor: cardTheme.iconColor,
          badgeBg: cardTheme.badgeBg,
          badgeFg: cardTheme.badgeFg,
          pillBg: cardTheme.pillBg,
          pillBorder: cardTheme.pillBorder,
          pillFg: cardTheme.pillFg,
          summary,
          expandAllToken,
        } satisfies TableNodeData,
      } satisfies Node<TableNodeData>;
    });
  }, [
    deferredSearch,
    graph.edges,
    graph.nodes,
    graph.targetNodeId,
    handleTargetColumnSelect,
    orderedGroups,
    selectedTargetColumn,
    expandAllToken,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(positionedNodes);
  const previousLayoutSignature = useRef<string | null>(null);
  const layoutSignature = useMemo(
    () =>
      JSON.stringify({
        nodeIds: graph.nodes.map((node) => node.id),
        edgeIds: graph.edges.map((edge) => edge.id),
        selectedTargetColumn,
      }),
    [graph.edges, graph.nodes, selectedTargetColumn],
  );

  useEffect(() => {
    setNodes((previous) => {
      const shouldPreservePosition = previousLayoutSignature.current === layoutSignature;
      if (!shouldPreservePosition) {
        return positionedNodes;
      }

      const previousById = new Map(previous.map((node) => [node.id, node]));
      return positionedNodes.map((node) => {
        const prior = previousById.get(node.id);
        return prior ? { ...node, position: prior.position } : node;
      });
    });
    previousLayoutSignature.current = layoutSignature;
  }, [layoutSignature, positionedNodes, setNodes]);

  const handleInspectNode = useCallback((nodeId: string) => {
    setFocus({ kind: "node", id: nodeId });
    setIsDetailsOpen(true);
  }, []);

  const handleInspectEdge = useCallback((edgeId: string) => {
    setFocus({ kind: "edge", id: edgeId });
    setIsDetailsOpen(true);
  }, []);

  const lineageEdges = useMemo<Edge<LineageEdgeData>[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "lineageEdge",
        data: {
          ...edge,
          onInspect: handleInspectEdge,
        } satisfies LineageEdgeData,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.strokeColor,
          width: 24,
          height: 24,
        },
      })),
    [graph.edges, handleInspectEdge],
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState(lineageEdges);

  useEffect(() => {
    setEdges(lineageEdges);
  }, [lineageEdges, setEdges]);

  const activeFocus = useMemo<LineageFocus>(() => {
    if (focus.kind === "node" && graph.nodes.some((node) => node.id === focus.id)) {
      return focus;
    }
    if (focus.kind === "edge" && graph.edges.some((edge) => edge.id === focus.id)) {
      return focus;
    }
    if (selectedTargetColumn && graph.targetNodeId) {
      return { kind: "node", id: graph.targetNodeId };
    }
    return { kind: "overview" };
  }, [focus, graph.edges, graph.nodes, graph.targetNodeId, selectedTargetColumn]);

  const focusedNode = useMemo(
    () =>
      activeFocus.kind === "node"
        ? graph.nodes.find((node) => node.id === activeFocus.id) ?? null
        : null,
    [activeFocus, graph.nodes],
  );

  const focusedEdge = useMemo(
    () =>
      activeFocus.kind === "edge"
        ? graph.edges.find((edge) => edge.id === activeFocus.id) ?? null
        : null,
    [activeFocus, graph.edges],
  );

  const lineageStats = useMemo(
    () => ({
      mapped: mappings.filter((mapping) => mapping.status === "MAPPED").length,
      unmapped: mappings.filter((mapping) => mapping.status !== "MAPPED").length,
      transformed: mappings.filter((mapping) => {
        const rule = mapping.rule === "Select..." ? "" : mapping.rule || "";
        return mapping.status === "MAPPED" && !!rule && rule !== "Direct";
      }).length,
    }),
    [mappings],
  );

  const lineageLegend = useMemo(() => {
    let sourceIndex = 0;
    return graph.nodes
      .filter((node) => node.kind === "source" || node.kind === "target")
      .map((node) => ({
        id: node.id,
        label: node.label,
        color:
          node.kind === "target"
            ? node.accentColor
            : SOURCE_LEGEND_COLORS[sourceIndex++ % SOURCE_LEGEND_COLORS.length],
      }));
  }, [graph.nodes]);

  const focusedMappings = useMemo(
    () => describeFocusedMappings(selectedTargetColumn, graph.edges, graph.nodes),
    [graph.edges, graph.nodes, selectedTargetColumn],
  );
  const focusedPrepEdges = useMemo(
    () => describeUpstreamPath(selectedTargetColumn, graph.edges, graph.nodes),
    [graph.edges, graph.nodes, selectedTargetColumn],
  );

  return (
    <AiaBox
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", xl: isDetailsOpen ? "minmax(0, 1fr) 360px" : "1fr" },
        gridTemplateRows: isDetailsOpen
          ? { xs: "minmax(0, 1fr) minmax(280px, 40vh)", xl: "minmax(0, 1fr)" }
          : "minmax(0, 1fr)",
        gap: 2,
        p: 2,
        background:
          "radial-gradient(circle at top right, rgba(191, 219, 254, 0.28), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
      }}
    >
      <AiaPaper
        elevation={0}
        sx={{
          minWidth: 0,
          minHeight: 0,
          height: "100%",
          borderRadius: "22px",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#fff",
        }}
      >
        <LineageWorkspaceHeader
          stats={lineageStats}
          legend={lineageLegend}
          onExpandAll={() => setExpandAllToken((token) => token + 1)}
        />

        <AiaBox sx={{ flex: 1, minHeight: 0, height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
          {nodes.length === 0 ? (
            <AiaBox
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 2,
                p: 3,
                textAlign: "center",
              }}
            >
              <AiaBox sx={{ maxWidth: 420 }}>
                <AiaText sx={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                  Lineage will appear after table selection
                </AiaText>
                <AiaText sx={{ fontSize: 13.5, color: "#64748b", mt: 0.75, lineHeight: 1.55 }}>
                  Once source and target tables are selected, this canvas will show table joins
                  and target mappings.
                </AiaText>
              </AiaBox>
            </AiaBox>
          ) : null}

          {nodes.length > 0 ? (
            <LineageFlowCanvas
              layoutSignature={layoutSignature}
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onInspectNode={handleInspectNode}
              onInspectEdge={handleInspectEdge}
              onPaneClick={() => setFocus({ kind: "overview" })}
            />
          ) : null}
        </AiaBox>
      </AiaPaper>

      {isDetailsOpen ? (
        <AiaPaper
          elevation={0}
          sx={{
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            borderRadius: "22px",
            border: "1px solid #e2e8f0",
            backgroundColor: "#fff",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <AiaBox
            sx={{
              px: 2.25,
              py: 1.85,
              borderBottom: "1px solid #eef2f7",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <AiaBox>
              <AiaText sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                Lineage Details
              </AiaText>
              <AiaText sx={{ fontSize: 12.5, color: "#64748b", mt: 0.6 }}>
                Click any card or path badge to inspect joins, filters, and mapping logic.
              </AiaText>
            </AiaBox>
            <AiaIconButton
              size="small"
              onClick={() => setIsDetailsOpen(false)}
              sx={{ color: "#64748b", mt: -0.25 }}
            >
              <CloseRoundedIcon fontSize="small" />
            </AiaIconButton>
          </AiaBox>

          <AiaBox sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>
            <AiaStack spacing={1.5}>
              {selectedTargetColumn ? (
                <AiaBox
                  sx={{
                    p: 1.7,
                    borderRadius: "18px",
                    backgroundColor: "#eef8fc",
                    border: "1px solid #bfd9e5",
                  }}
                >
                  <AiaStack direction="row" spacing={0.8} useFlexGap sx={{ flexWrap: "wrap", mb: 1 }}>
                    <AiaChip
                      label="Column focus"
                      size="small"
                      color="primary"
                      customBackgroundColor="#d7eef7"
                      customColor="#003D59"
                      customBorderColor="#bfd9e5"
                      sx={{ fontWeight: 800 }}
                    />
                    <AiaChip
                      label={`${focusedMappings.length} mapping source${focusedMappings.length === 1 ? "" : "s"}`}
                      size="small"
                      color="default"
                      sx={{ fontWeight: 700 }}
                    />
                  </AiaStack>
                  <AiaText sx={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                    {selectedTargetColumn}
                  </AiaText>
                  <AiaText sx={{ fontSize: 12.5, color: "#475569", mt: 0.7, lineHeight: 1.55 }}>
                    The canvas is currently focused on the upstream lineage that lands in this target column.
                  </AiaText>
                </AiaBox>
              ) : null}

              {focusedMappings.length > 0 ? (
                <AiaBox sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                  <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                    Column lineage
                  </AiaText>
                  <AiaStack spacing={1.15}>
                    {focusedMappings.map(({ edgeId, sourceLabel, mapping }) => (
                      <LineageMappingCard
                        key={`${edgeId}:${mapping.mappingId}`}
                        mapping={mapping}
                        sourceLabel={sourceLabel}
                      />
                    ))}
                  </AiaStack>
                </AiaBox>
              ) : null}

              {focusedPrepEdges.length > 0 ? (
                <AiaBox sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                  <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                    Upstream prep path
                  </AiaText>
                  <AiaStack spacing={1.1}>
                    {focusedPrepEdges.map((edge) => (
                      <AiaBox
                        key={edge.id}
                        sx={{
                          p: 1.15,
                          borderRadius: "14px",
                          border: "1px solid #edf2f7",
                          backgroundColor: "#fff",
                        }}
                      >
                        <AiaStack direction="row" spacing={0.7} useFlexGap sx={{ flexWrap: "wrap", mb: 0.8 }}>
                          {edge.operations.map((operation, index) => (
                            <LineageOperationChip
                              key={`${edge.id}-${operation.label}-${index}`}
                              operation={operation}
                              compact
                            />
                          ))}
                        </AiaStack>
                        <AiaText sx={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>
                          {edge.sourceLabel} → {edge.targetLabel}
                        </AiaText>
                        <AiaText sx={{ fontSize: 12, color: "#64748b", mt: 0.45 }}>
                          {edge.subtitle}
                        </AiaText>
                        {edge.conditions.length > 0 ? (
                          <AiaStack spacing={0.55} sx={{ mt: 0.9 }}>
                            {edge.conditions.map((condition, index) => (
                              <AiaText
                                key={`${edge.id}-condition-${index}`}
                                sx={{
                                  fontSize: 12,
                                  color: "#334155",
                                  lineHeight: 1.5,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                }}
                              >
                                {condition.leftColumn} {condition.operator} {condition.rightColumn}
                              </AiaText>
                            ))}
                          </AiaStack>
                        ) : null}
                        {edge.filters.length > 0 ? (
                          <AiaStack spacing={0.55} sx={{ mt: 0.9 }}>
                            {edge.filters.flatMap((group) => describeRuleGroup(group)).map((text, index) => (
                              <AiaText
                                key={`${edge.id}-filter-${index}`}
                                sx={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}
                              >
                                {text}
                              </AiaText>
                            ))}
                          </AiaStack>
                        ) : null}
                      </AiaBox>
                    ))}
                  </AiaStack>
                </AiaBox>
              ) : null}

              {focusedNode ? (
                <AiaStack spacing={1.5}>
                  <AiaBox
                    sx={{
                      p: 1.7,
                      borderRadius: "18px",
                      backgroundColor: focusedNode.surfaceTint,
                      border: `1px solid ${focusedNode.accentColor}33`,
                    }}
                  >
                    <AiaStack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                      <AiaChip
                        label={focusedNode.tag}
                        size="small"
                        customBackgroundColor={`${focusedNode.accentColor}18`}
                        customColor={focusedNode.accentColor}
                        customBorderColor={`${focusedNode.accentColor}33`}
                        sx={{ fontWeight: 800 }}
                      />
                      <AiaChip
                        label={readableLineageDepth(focusedNode)}
                        size="small"
                        color="default"
                        sx={{ fontWeight: 700 }}
                      />
                    </AiaStack>
                    <AiaText sx={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                      {focusedNode.label}
                    </AiaText>
                    <AiaText sx={{ fontSize: 12.5, color: "#64748b", mt: 0.6 }}>
                      {focusedNode.database}.{focusedNode.schema}
                    </AiaText>
                    <AiaText sx={{ fontSize: 12.5, color: "#334155", mt: 1.1, lineHeight: 1.55 }}>
                      {focusedNode.summary}
                    </AiaText>
                  </AiaBox>

                  <AiaBox sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                    <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                      Quick stats
                    </AiaText>
                    <AiaStack spacing={0.8}>
                      <AiaText sx={{ fontSize: 12.5, color: "#475569" }}>
                        {focusedNode.colCount} visible columns
                      </AiaText>
                      <AiaText sx={{ fontSize: 12.5, color: "#475569" }}>
                        {focusedNode.highlightedColumns.length} columns participate in the current lineage focus
                      </AiaText>
                    </AiaStack>
                  </AiaBox>

                  <AiaBox sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                    <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                      Active columns
                    </AiaText>
                    {focusedNode.highlightedColumns.length > 0 ? (
                      <AiaStack direction="row" spacing={0.9} useFlexGap sx={{ flexWrap: "wrap" }}>
                        {focusedNode.highlightedColumns.map((column) => (
                          <AiaChip
                            key={column}
                            label={column}
                            size="small"
                            color="warning"
                            sx={{ fontWeight: 700 }}
                          />
                        ))}
                      </AiaStack>
                    ) : (
                      <AiaText sx={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.55 }}>
                        This table is part of the visible lineage context even though no specific column is in focus yet.
                      </AiaText>
                    )}
                  </AiaBox>
                </AiaStack>
              ) : focusedEdge ? (
                <AiaStack spacing={1.5}>
                  <AiaBox
                    sx={{
                      p: 1.7,
                      borderRadius: "18px",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "#f8fafc",
                    }}
                  >
                    <AiaStack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.2 }}>
                      {focusedEdge.operations.map((operation, index) => (
                        <LineageOperationChip
                          key={`${focusedEdge.id}-${operation.label}-${index}`}
                          operation={operation}
                        />
                      ))}
                    </AiaStack>
                    <AiaText sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                      {readableNodeLabel(focusedEdge.source, graph.nodes)} →{" "}
                      {readableNodeLabel(focusedEdge.target, graph.nodes)}
                    </AiaText>
                    <AiaText sx={{ fontSize: 12.5, color: "#64748b", mt: 0.55 }}>
                      {focusedEdge.subtitle}
                    </AiaText>
                  </AiaBox>

                  {focusedEdge.conditions.length > 0 ? (
                    <AiaBox sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                      <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                        Join or lineage conditions
                      </AiaText>
                      <AiaStack spacing={0.9}>
                        {focusedEdge.conditions.map((condition, index) => (
                          <AiaText
                            key={`${focusedEdge.id}-condition-${index}`}
                            sx={{
                              fontSize: 12.5,
                              color: "#334155",
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              lineHeight: 1.55,
                            }}
                          >
                            {condition.leftColumn} {condition.operator} {condition.rightColumn}
                          </AiaText>
                        ))}
                      </AiaStack>
                    </AiaBox>
                  ) : null}

                  {focusedEdge.filters.length > 0 ? (
                    <AiaBox sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                      <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                        Applied filters
                      </AiaText>
                      <AiaStack spacing={0.9}>
                        {focusedEdge.filters.flatMap((group) => describeRuleGroup(group)).map((text, index) => (
                          <AiaText
                            key={`${focusedEdge.id}-filter-${index}`}
                            sx={{ fontSize: 12.5, color: "#334155", lineHeight: 1.55 }}
                          >
                            {text}
                          </AiaText>
                        ))}
                      </AiaStack>
                    </AiaBox>
                  ) : null}

                  {focusedEdge.mappings.length > 0 ? (
                    <AiaBox sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                      <AiaText sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                        Target mappings
                      </AiaText>
                      <AiaStack spacing={1.25}>
                        {focusedEdge.mappings.map((mapping) => (
                          <LineageMappingCard
                            key={mapping.mappingId}
                            mapping={mapping}
                            sourceLabel={readableNodeLabel(focusedEdge.source, graph.nodes)}
                          />
                        ))}
                      </AiaStack>
                    </AiaBox>
                  ) : null}
                </AiaStack>
              ) : (
                <AiaBox
                  sx={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    p: 3,
                  }}
                >
                  <AiaBox sx={{ maxWidth: 240 }}>
                    <AiaText sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                      Select a lineage element
                    </AiaText>
                    <AiaText sx={{ fontSize: 12.5, color: "#64748b", mt: 0.9, lineHeight: 1.55 }}>
                      Choose a card or path badge in the canvas to inspect how tables join, filter, and map into the target.
                    </AiaText>
                  </AiaBox>
                </AiaBox>
              )}
            </AiaStack>
          </AiaBox>

          <AiaDivider />

          <AiaBox sx={{ px: 2, py: 1.4, backgroundColor: "#f8fafc" }}>
            <AiaText sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
              The canvas stays in sync with Step 1 joins, selected derived sources, and every mapped column in the grid.
            </AiaText>
          </AiaBox>
        </AiaPaper>
      ) : null}
    </AiaBox>
  );
}

function LineageMappingCard({
  mapping,
  sourceLabel,
}: {
  mapping: LineageMappingDetail;
  sourceLabel: string;
}) {
  return (
    <AiaBox
      sx={{
        p: 1.15,
        borderRadius: "14px",
        border: "1px solid #edf2f7",
        backgroundColor: "#fff",
      }}
    >
      <AiaStack direction="row" spacing={0.8} useFlexGap sx={{ flexWrap: "wrap", mb: 0.85 }}>
        <AiaChip
          size="small"
          color="primary"
          label={mapping.targetColumn}
          customBackgroundColor="#dbeafe"
          customColor="#003D59"
          customBorderColor="#bfdbfe"
          sx={{ fontWeight: 800 }}
        />
        <AiaChip
          size="small"
          color="default"
          label={sourceLabel}
          customBackgroundColor="#eef2ff"
          customColor="#334155"
          customBorderColor="#e2e8f0"
          sx={{ fontWeight: 700 }}
        />
        <AiaChip
          size="small"
          color={mapping.rule === "Direct" ? "primary" : "warning"}
          label={readableOperationLabel({
            icon: mapping.rule === "Direct" ? "direct" : "transform",
            label: mapping.rule,
            tone: mapping.rule === "Direct" ? "target" : "derived",
          })}
          sx={{ fontWeight: 700 }}
        />
      </AiaStack>
      <AiaText sx={{ fontSize: 12.5, color: "#475569", lineHeight: 1.55 }}>
        Sources: {mapping.sourceColumns.map(formatColumnReference).join(", ")}
      </AiaText>
      {mapping.description ? (
        <AiaText sx={{ fontSize: 12.5, color: "#334155", mt: 0.75, lineHeight: 1.55 }}>
          {mapping.description}
        </AiaText>
      ) : null}
      {mapping.expression ? (
        <AiaText
          sx={{
            fontSize: 12,
            color: "#64748b",
            mt: 0.75,
            lineHeight: 1.55,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          SQL: {mapping.expression}
        </AiaText>
      ) : null}
    </AiaBox>
  );
}
