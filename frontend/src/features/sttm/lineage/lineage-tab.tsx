"use client";
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
  useEdgesState,
  useNodesState,
} from "@xyflow/react";







import {
  Box,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
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
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.6,
        px: compact ? 0.7 : 0.95,
        py: compact ? 0.3 : 0.48,
        borderRadius: "999px",
        backgroundColor: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        fontSize: compact ? 10.5 : 11.5,
        fontWeight: 800,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <OperationIcon icon={operation.icon} />
      <span>{operation.label}</span>
    </Box>
  );
}

function LineageOperationBadge({ operation }: { operation: LineageEdgeOperation }) {
  const colors = toneColors(operation.tone);

  return (
    <Box
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
    </Box>
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
        <Box
          sx={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            zIndex: 20,
          }}
        >
          <Paper
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
              <Box
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
              </Box>
            ) : null}
          </Paper>
        </Box>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { lineageEdge: LineageEdgeView };

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
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", xl: isDetailsOpen ? "minmax(0, 1fr) 360px" : "1fr" },
        gap: 2,
        p: 2,
        background:
          "radial-gradient(circle at top right, rgba(191, 219, 254, 0.28), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          minWidth: 0,
          minHeight: 0,
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

        <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
          {nodes.length === 0 ? (
            <Box
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
              <Box sx={{ maxWidth: 420 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                  Lineage will appear after table selection
                </Typography>
                <Typography sx={{ fontSize: 13.5, color: "#64748b", mt: 0.75, lineHeight: 1.55 }}>
                  Once source and target tables are selected, this canvas will show table joins
                  and target mappings.
                </Typography>
              </Box>
            </Box>
          ) : null}

          <ReactFlow
            fitView
            minZoom={0.25}
            maxZoom={1.2}
            fitViewOptions={{ padding: 0.26, minZoom: 0.25, maxZoom: 1 }}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => handleInspectNode(node.id)}
            onEdgeClick={(_, edge) => handleInspectEdge(edge.id)}
            onPaneClick={() => setFocus({ kind: "overview" })}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "lineageEdge", animated: false }}
            style={{ width: "100%", height: "100%" }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={26}
              size={1.2}
              color="#dbe2ea"
            />
            <Controls position="bottom-right" style={{ marginBottom: 16, marginRight: 16 }} />
          </ReactFlow>
        </Box>
      </Paper>

      {isDetailsOpen ? (
        <Paper
          elevation={0}
          sx={{
            minWidth: 0,
            minHeight: 0,
            borderRadius: "22px",
            border: "1px solid #e2e8f0",
            backgroundColor: "#fff",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Box
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
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                Lineage Details
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: "#64748b", mt: 0.6 }}>
                Click any card or path badge to inspect joins, filters, and mapping logic.
              </Typography>
            </Box>
            <IconButton
              size="small"
              onClick={() => setIsDetailsOpen(false)}
              sx={{ color: "#64748b", mt: -0.25 }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>
            <Stack spacing={1.5}>
              {selectedTargetColumn ? (
                <Box
                  sx={{
                    p: 1.7,
                    borderRadius: "18px",
                    backgroundColor: "#eef8fc",
                    border: "1px solid #bfd9e5",
                  }}
                >
                  <Stack direction="row" spacing={0.8} useFlexGap sx={{ flexWrap: "wrap", mb: 1 }}>
                    <Chip
                      label="Column focus"
                      size="small"
                      sx={{
                        bgcolor: "#d7eef7",
                        color: "#003D59",
                        fontWeight: 800,
                      }}
                    />
                    <Chip
                      label={`${focusedMappings.length} mapping source${focusedMappings.length === 1 ? "" : "s"}`}
                      size="small"
                      sx={{ fontWeight: 700 }}
                    />
                  </Stack>
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                    {selectedTargetColumn}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: "#475569", mt: 0.7, lineHeight: 1.55 }}>
                    The canvas is currently focused on the upstream lineage that lands in this target column.
                  </Typography>
                </Box>
              ) : null}

              {focusedMappings.length > 0 ? (
                <Box sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                    Column lineage
                  </Typography>
                  <Stack spacing={1.15}>
                    {focusedMappings.map(({ edgeId, sourceLabel, mapping }) => (
                      <LineageMappingCard
                        key={`${edgeId}:${mapping.mappingId}`}
                        mapping={mapping}
                        sourceLabel={sourceLabel}
                      />
                    ))}
                  </Stack>
                </Box>
              ) : null}

              {focusedPrepEdges.length > 0 ? (
                <Box sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                    Upstream prep path
                  </Typography>
                  <Stack spacing={1.1}>
                    {focusedPrepEdges.map((edge) => (
                      <Box
                        key={edge.id}
                        sx={{
                          p: 1.15,
                          borderRadius: "14px",
                          border: "1px solid #edf2f7",
                          backgroundColor: "#fff",
                        }}
                      >
                        <Stack direction="row" spacing={0.7} useFlexGap sx={{ flexWrap: "wrap", mb: 0.8 }}>
                          {edge.operations.map((operation, index) => (
                            <LineageOperationChip
                              key={`${edge.id}-${operation.label}-${index}`}
                              operation={operation}
                              compact
                            />
                          ))}
                        </Stack>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>
                          {edge.sourceLabel} → {edge.targetLabel}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: "#64748b", mt: 0.45 }}>
                          {edge.subtitle}
                        </Typography>
                        {edge.conditions.length > 0 ? (
                          <Stack spacing={0.55} sx={{ mt: 0.9 }}>
                            {edge.conditions.map((condition, index) => (
                              <Typography
                                key={`${edge.id}-condition-${index}`}
                                sx={{
                                  fontSize: 12,
                                  color: "#334155",
                                  lineHeight: 1.5,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                }}
                              >
                                {condition.leftColumn} {condition.operator} {condition.rightColumn}
                              </Typography>
                            ))}
                          </Stack>
                        ) : null}
                        {edge.filters.length > 0 ? (
                          <Stack spacing={0.55} sx={{ mt: 0.9 }}>
                            {edge.filters.flatMap((group) => describeRuleGroup(group)).map((text, index) => (
                              <Typography
                                key={`${edge.id}-filter-${index}`}
                                sx={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}
                              >
                                {text}
                              </Typography>
                            ))}
                          </Stack>
                        ) : null}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              {focusedNode ? (
                <Stack spacing={1.5}>
                  <Box
                    sx={{
                      p: 1.7,
                      borderRadius: "18px",
                      backgroundColor: focusedNode.surfaceTint,
                      border: `1px solid ${focusedNode.accentColor}33`,
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                      <Chip
                        label={focusedNode.tag}
                        size="small"
                        sx={{
                          backgroundColor: `${focusedNode.accentColor}18`,
                          color: focusedNode.accentColor,
                          fontWeight: 800,
                        }}
                      />
                      <Chip label={readableLineageDepth(focusedNode)} size="small" sx={{ fontWeight: 700 }} />
                    </Stack>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                      {focusedNode.label}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: "#64748b", mt: 0.6 }}>
                      {focusedNode.database}.{focusedNode.schema}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: "#334155", mt: 1.1, lineHeight: 1.55 }}>
                      {focusedNode.summary}
                    </Typography>
                  </Box>

                  <Box sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                      Quick stats
                    </Typography>
                    <Stack spacing={0.8}>
                      <Typography sx={{ fontSize: 12.5, color: "#475569" }}>
                        {focusedNode.colCount} visible columns
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: "#475569" }}>
                        {focusedNode.highlightedColumns.length} columns participate in the current lineage focus
                      </Typography>
                    </Stack>
                  </Box>

                  <Box sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                      Active columns
                    </Typography>
                    {focusedNode.highlightedColumns.length > 0 ? (
                      <Stack direction="row" spacing={0.9} useFlexGap sx={{ flexWrap: "wrap" }}>
                        {focusedNode.highlightedColumns.map((column) => (
                          <Chip
                            key={column}
                            label={column}
                            size="small"
                            sx={{
                              bgcolor: "#fff7ed",
                              color: "#9a3412",
                              border: "1px solid #fdba74",
                              fontWeight: 700,
                            }}
                          />
                        ))}
                      </Stack>
                    ) : (
                      <Typography sx={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.55 }}>
                        This table is part of the visible lineage context even though no specific column is in focus yet.
                      </Typography>
                    )}
                  </Box>
                </Stack>
              ) : focusedEdge ? (
                <Stack spacing={1.5}>
                  <Box
                    sx={{
                      p: 1.7,
                      borderRadius: "18px",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "#f8fafc",
                    }}
                  >
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.2 }}>
                      {focusedEdge.operations.map((operation, index) => (
                        <LineageOperationChip
                          key={`${focusedEdge.id}-${operation.label}-${index}`}
                          operation={operation}
                        />
                      ))}
                    </Stack>
                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                      {readableNodeLabel(focusedEdge.source, graph.nodes)} →{" "}
                      {readableNodeLabel(focusedEdge.target, graph.nodes)}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: "#64748b", mt: 0.55 }}>
                      {focusedEdge.subtitle}
                    </Typography>
                  </Box>

                  {focusedEdge.conditions.length > 0 ? (
                    <Box sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                        Join or lineage conditions
                      </Typography>
                      <Stack spacing={0.9}>
                        {focusedEdge.conditions.map((condition, index) => (
                          <Typography
                            key={`${focusedEdge.id}-condition-${index}`}
                            sx={{
                              fontSize: 12.5,
                              color: "#334155",
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              lineHeight: 1.55,
                            }}
                          >
                            {condition.leftColumn} {condition.operator} {condition.rightColumn}
                          </Typography>
                        ))}
                      </Stack>
                    </Box>
                  ) : null}

                  {focusedEdge.filters.length > 0 ? (
                    <Box sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                        Applied filters
                      </Typography>
                      <Stack spacing={0.9}>
                        {focusedEdge.filters.flatMap((group) => describeRuleGroup(group)).map((text, index) => (
                          <Typography
                            key={`${focusedEdge.id}-filter-${index}`}
                            sx={{ fontSize: 12.5, color: "#334155", lineHeight: 1.55 }}
                          >
                            {text}
                          </Typography>
                        ))}
                      </Stack>
                    </Box>
                  ) : null}

                  {focusedEdge.mappings.length > 0 ? (
                    <Box sx={{ p: 1.7, borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#0f172a", mb: 1 }}>
                        Target mappings
                      </Typography>
                      <Stack spacing={1.25}>
                        {focusedEdge.mappings.map((mapping) => (
                          <LineageMappingCard
                            key={mapping.mappingId}
                            mapping={mapping}
                            sourceLabel={readableNodeLabel(focusedEdge.source, graph.nodes)}
                          />
                        ))}
                      </Stack>
                    </Box>
                  ) : null}
                </Stack>
              ) : (
                <Box
                  sx={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    p: 3,
                  }}
                >
                  <Box sx={{ maxWidth: 240 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                      Select a lineage element
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: "#64748b", mt: 0.9, lineHeight: 1.55 }}>
                      Choose a card or path badge in the canvas to inspect how tables join, filter, and map into the target.
                    </Typography>
                  </Box>
                </Box>
              )}
            </Stack>
          </Box>

          <Divider />

          <Box sx={{ px: 2, py: 1.4, backgroundColor: "#f8fafc" }}>
            <Typography sx={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
              The canvas stays in sync with Step 1 joins, selected derived sources, and every mapped column in the grid.
            </Typography>
          </Box>
        </Paper>
      ) : null}
    </Box>
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
    <Box
      sx={{
        p: 1.15,
        borderRadius: "14px",
        border: "1px solid #edf2f7",
        backgroundColor: "#fff",
      }}
    >
      <Stack direction="row" spacing={0.8} useFlexGap sx={{ flexWrap: "wrap", mb: 0.85 }}>
        <Chip
          size="small"
          label={mapping.targetColumn}
          sx={{
            bgcolor: "#dbeafe",
            color: "#003D59",
            fontWeight: 800,
          }}
        />
        <Chip
          size="small"
          label={sourceLabel}
          sx={{
            bgcolor: "#eef2ff",
            color: "#334155",
            fontWeight: 700,
          }}
        />
        <Chip
          size="small"
          label={readableOperationLabel({
            icon: mapping.rule === "Direct" ? "direct" : "transform",
            label: mapping.rule,
            tone: mapping.rule === "Direct" ? "target" : "derived",
          })}
          sx={{ fontWeight: 700 }}
        />
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: "#475569", lineHeight: 1.55 }}>
        Sources: {mapping.sourceColumns.map(formatColumnReference).join(", ")}
      </Typography>
      {mapping.description ? (
        <Typography sx={{ fontSize: 12.5, color: "#334155", mt: 0.75, lineHeight: 1.55 }}>
          {mapping.description}
        </Typography>
      ) : null}
      {mapping.expression ? (
        <Typography
          sx={{
            fontSize: 12,
            color: "#64748b",
            mt: 0.75,
            lineHeight: 1.55,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          SQL: {mapping.expression}
        </Typography>
      ) : null}
    </Box>
  );
}
