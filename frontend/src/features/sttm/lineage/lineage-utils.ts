import type {
  Column,
  ColumnGroup,
  DerivedSource,
  JoinConfig,
  MappingState,
  RuleGroup,
  TableNode,
} from "@/features/sttm/types/sttm.types";
import type { TableRef } from "@/types/api-contract";
import { getDerivedDisplayColumns, parseSourceColumns, tableAlias } from "@/features/sttm/mapping/mapping-utils";

export type LineageNodeKind = "source" | "derived" | "target";
export type LineageEdgeKind = "join" | "derived" | "mapping";
export type LineageOperationIcon = "join" | "filter" | "direct" | "transform";

export type LineageEdgeOperation = {
  icon: LineageOperationIcon;
  label: string;
  tone: "source" | "derived" | "target" | "neutral";
};

export type LineageJoinCondition = {
  leftColumn: string;
  operator: string;
  rightColumn: string;
};

export type LineageMappingDetail = {
  mappingId: string;
  targetColumn: string;
  sourceColumns: string[];
  rule: string;
  expression?: string | null;
  description?: string | null;
  status: string;
};

export type LineageGraphNode = {
  id: string;
  kind: LineageNodeKind;
  label: string;
  database: string;
  schema: string;
  tag: string;
  rowCount: string;
  colCount: number;
  columns: Column[];
  accentColor: string;
  surfaceTint: string;
  headerBg: string;
  iconBg: string;
  iconColor: string;
  highlightedColumns: string[];
  summary: string;
};

export type LineageGraphEdge = {
  id: string;
  kind: LineageEdgeKind;
  source: string;
  target: string;
  strokeColor: string;
  dashed?: boolean;
  operations: LineageEdgeOperation[];
  label: string;
  subtitle: string;
  joinType?: string;
  conditions: LineageJoinCondition[];
  filters: RuleGroup[];
  mappings: LineageMappingDetail[];
};

export type LineageGraph = {
  nodes: LineageGraphNode[];
  edges: LineageGraphEdge[];
  targetNodeId: string | null;
  mappedCount: number;
  selectedTargetColumn: string | null;
};

const NODE_COLORS = {
  source: {
    accentColor: "#1d4ed8",
    surfaceTint: "#f8fbff",
    headerBg: "#ffffff",
    iconBg: "#dbeafe",
    iconColor: "#1d4ed8",
  },
  derived: {
    accentColor: "#d97706",
    surfaceTint: "#fff9f2",
    headerBg: "#ffffff",
    iconBg: "#ffedd5",
    iconColor: "#b45309",
  },
  target: {
    accentColor: "#003D59",
    surfaceTint: "#f2f9fc",
    headerBg: "#ffffff",
    iconBg: "#003D59",
    iconColor: "#ffffff",
  },
} as const;

function countFilterConditions(groups: RuleGroup[]): number {
  return groups.reduce((count, group) => {
    return (
      count +
      group.children.reduce((childCount, child) => {
        if (child.type === "condition") {
          return childCount + 1;
        }
        return childCount + countFilterConditions([child]);
      }, 0)
    );
  }, 0);
}

function makeTableId(table: TableRef) {
  return `${table.database}.${table.schema}.${table.table}`;
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeRuleLabel(rule: string | null | undefined, expression?: string | null) {
  const trimmed = rule?.trim() || "Direct";
  const upper = trimmed.toUpperCase();
  if ((upper === "CUSTOM" || upper === "SELECT...") && expression?.trim()) {
    if (expression.toUpperCase().includes("CASE")) {
      return "CASE";
    }
    return "Custom SQL";
  }
  if (!trimmed || upper === "SELECT...") {
    return "Direct";
  }
  return trimmed;
}

function mappingOperation(rule: string | null | undefined, expression?: string | null): LineageEdgeOperation {
  const label = normalizeRuleLabel(rule, expression);
  const upper = label.toUpperCase();
  const icon: LineageOperationIcon =
    upper === "DIRECT" ? "direct" : upper.includes("JOIN") ? "join" : "transform";

  return {
    icon,
    label,
    tone: upper === "DIRECT" ? "target" : "derived",
  };
}

function buildSourceNode(table: TableNode, columns: Column[]): LineageGraphNode {
  return {
    id: table.tableId,
    kind: "source",
    label: table.tableName,
    database: table.qualifiedName.split(".")[0] ?? "SOURCE",
    schema: table.qualifiedName.split(".")[1] ?? "SOURCE",
    tag: table.tag || "Source",
    rowCount: table.rows || "—",
    colCount: columns.length || table.columns || 0,
    columns,
    highlightedColumns: [],
    summary: "Selected source table",
    ...NODE_COLORS.source,
  };
}

function buildDerivedNode(source: DerivedSource): LineageGraphNode {
  const displayColumns = getDerivedDisplayColumns(source).map((column) => ({
    name: column.name,
    type: column.type,
    tableId: source.id,
    tableName: source.sourceName,
  }));

  return {
    id: source.id,
    kind: "derived",
    label: source.sourceName,
    database: "DERIVED",
    schema: "DERIVED",
    tag: "Derived",
    rowCount: "—",
    colCount: displayColumns.length,
    columns: displayColumns,
    highlightedColumns: [],
    summary: source.semanticViewName
      ? `Derived source backed by ${source.semanticViewName}`
      : "Reusable derived source",
    ...NODE_COLORS.derived,
  };
}

function buildTargetNode(target: TableNode, columns: Column[]): LineageGraphNode {
  return {
    id: target.tableId,
    kind: "target",
    label: target.tableName,
    database: target.qualifiedName.split(".")[0] ?? "TARGET",
    schema: target.qualifiedName.split(".")[1] ?? "TARGET",
    tag: "Target",
    rowCount: target.rows || "—",
    colCount: columns.length || target.columns || 0,
    columns,
    highlightedColumns: [],
    summary: "Selected target table",
    ...NODE_COLORS.target,
  };
}

function operationToneForJoin(joinType: string | undefined): LineageEdgeOperation["tone"] {
  return joinType?.toUpperCase() === "FULL"
    ? "derived"
    : joinType?.toUpperCase() === "LEFT" || joinType?.toUpperCase() === "RIGHT"
      ? "source"
      : "neutral";
}

function edgeColorForJoin(joinType: string | undefined) {
  switch ((joinType ?? "INNER").toUpperCase()) {
    case "LEFT":
      return "#2563eb";
    case "RIGHT":
      return "#0f766e";
    case "FULL":
      return "#9333ea";
    default:
      return "#334155";
  }
}

function parseLineageRecord(record: Record<string, unknown>) {
  return {
    derivedSourceId: String(record.derived_source_id ?? ""),
    parentDerivedSourceIds: Array.isArray(record.parent_derived_source_ids)
      ? record.parent_derived_source_ids.map((item) => String(item))
      : [],
    baseSourceTableIds: Array.isArray(record.base_source_tables)
      ? record.base_source_tables
          .map((item) => item as TableRef)
          .filter((item) => item?.database && item?.schema && item?.table)
          .map(makeTableId)
      : [],
    lineageDepth: Number(record.lineage_depth ?? 0) || 0,
  };
}

function buildDerivedAliasMap(derivedSources: DerivedSource[]) {
  return new Map(
    derivedSources.map((source) => [tableAlias(source.sourceName.replace(/\s+/g, "_")).toLowerCase(), source.id]),
  );
}

function resolveSourceReference(
  value: string,
  derivedAliasMap: Map<string, string>,
): { nodeId: string | null; columnName: string | null } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { nodeId: null, columnName: null };
  }

  const parts = trimmed.split(".");
  if (parts.length >= 4) {
    return {
      nodeId: parts.slice(0, 3).join("."),
      columnName: parts.slice(3).join("."),
    };
  }

  if (parts.length >= 2) {
    return {
      nodeId: derivedAliasMap.get(parts[0].toLowerCase()) ?? null,
      columnName: parts.slice(1).join("."),
    };
  }

  return { nodeId: null, columnName: null };
}

export function buildLineageGraph(params: {
  sources: TableNode[];
  targets: TableNode[];
  sourceAttributeGroups: ColumnGroup[];
  targetAttributeGroup: ColumnGroup | null;
  relationships: JoinConfig[];
  derivedSources: DerivedSource[];
  mappings: MappingState[];
  semanticLineage: Array<Record<string, unknown>>;
  selectedTargetColumn?: string | null;
}) : LineageGraph {
  const {
    sources,
    targets,
    sourceAttributeGroups,
    targetAttributeGroup,
    relationships,
    derivedSources,
    mappings,
    semanticLineage,
    selectedTargetColumn = null,
  } = params;

  const selectedSources = sources.filter((table) => table.isSelected);
  const selectedDerivedSources = derivedSources.filter((source) => source.isSelected);
  const selectedTarget = targets.find((table) => table.isSelected) ?? null;
  const sourceColumnsByTable = new Map(
    sourceAttributeGroups.map((group) => [group.qualifiedName, group.columns]),
  );

  const nodes: LineageGraphNode[] = [
    ...selectedSources.map((table) =>
      buildSourceNode(table, sourceColumnsByTable.get(table.qualifiedName) ?? []),
    ),
    ...selectedDerivedSources.map((source) => buildDerivedNode(source)),
  ];

  if (selectedTarget && targetAttributeGroup) {
    nodes.push(buildTargetNode(selectedTarget, targetAttributeGroup.columns ?? []));
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: LineageGraphEdge[] = [];
  const derivedAliasMap = buildDerivedAliasMap(selectedDerivedSources);
  const semanticLineageMap = new Map(
    semanticLineage
      .map((record) => parseLineageRecord(record))
      .filter((record) => record.derivedSourceId)
      .map((record) => [record.derivedSourceId, record]),
  );

  for (const join of relationships) {
    if (!join.leftTableId || !join.rightTableId) {
      continue;
    }
    if (!nodeById.has(join.leftTableId) || !nodeById.has(join.rightTableId)) {
      continue;
    }

    const conditions = (join.conditions ?? [])
      .filter((condition) => condition.leftColumn && condition.rightColumn)
      .map((condition) => ({
        leftColumn: String(condition.leftColumn),
        operator: condition.operator ?? "=",
        rightColumn: String(condition.rightColumn),
      }));

    if (!conditions.length) {
      continue;
    }

    const joinType = join.joinType ?? "INNER";
    edges.push({
      id: `join:${join.id ?? `${join.leftTableId}:${join.rightTableId}`}`,
      kind: "join",
      source: join.leftTableId,
      target: join.rightTableId,
      strokeColor: edgeColorForJoin(joinType),
      operations: [
        {
          icon: "join",
          label: `${joinType} JOIN`,
          tone: operationToneForJoin(joinType),
        },
      ],
      label: `${joinType} join`,
      subtitle: `${conditions.length} condition${conditions.length === 1 ? "" : "s"}`,
      joinType,
      conditions,
      filters: [],
      mappings: [],
    });
  }

  for (const source of selectedDerivedSources) {
    const lineageRecord = semanticLineageMap.get(source.id);
    const parentIds = new Set([
      ...(source.parentDerivedSourceIds ?? []),
      ...(lineageRecord?.parentDerivedSourceIds ?? []),
    ]);
    const sourceIds = new Set([
      ...(source.tableIds ?? []),
      ...((source.baseSourceTables ?? []).map(makeTableId)),
      ...(lineageRecord?.baseSourceTableIds ?? []),
    ]);

    const upstreamIds = [...parentIds, ...sourceIds].filter((id) => nodeById.has(id));
    const joinType = source.joins[0]?.joinType ?? "INNER";
    const conditionList = source.joins.flatMap((join) =>
      (join.conditions ?? []).map((condition) => ({
        leftColumn: condition.leftColumn,
        operator: condition.operator ?? "=",
        rightColumn: condition.rightColumn,
      })),
    );
    const filterCount = countFilterConditions(source.filters ?? []);

    upstreamIds.forEach((upstreamId, index) => {
      const operations: LineageEdgeOperation[] = [
        {
          icon: "join",
          label: `${joinType} JOIN`,
          tone: "derived",
        },
      ];
      if (filterCount > 0) {
        operations.push({
          icon: "filter",
          label: `${filterCount} filter${filterCount === 1 ? "" : "s"}`,
          tone: "derived",
        });
      }

      edges.push({
        id: `derived:${source.id}:${upstreamId}:${index}`,
        kind: "derived",
        source: upstreamId,
        target: source.id,
        strokeColor: "#d97706",
        operations,
        label: `${source.joins.length} join${source.joins.length === 1 ? "" : "s"}`,
        subtitle: filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? "" : "s"}` : "Derived source lineage",
        joinType,
        conditions: conditionList,
        filters: source.filters ?? [],
        mappings: [],
      });
    });
  }

  if (selectedTarget) {
    const targetNode = nodeById.get(selectedTarget.tableId) ?? null;
    const edgeMap = new Map<string, LineageGraphEdge>();

    for (const mapping of mappings.filter(
      (item) =>
        item.status === "MAPPED" &&
        (!selectedTargetColumn || item.targetColumn === selectedTargetColumn),
    )) {
      const sourceColumns =
        mapping.sourceColumns && mapping.sourceColumns.length
          ? mapping.sourceColumns
          : parseSourceColumns(mapping.sourceColumn);
      const touchedNodeIds = new Set<string>();

      for (const sourceColumn of sourceColumns) {
        const { nodeId, columnName } = resolveSourceReference(sourceColumn, derivedAliasMap);
        if (!nodeId || !columnName || touchedNodeIds.has(nodeId) || !nodeById.has(nodeId)) {
          continue;
        }
        touchedNodeIds.add(nodeId);

        const sourceNode = nodeById.get(nodeId);
        if (!sourceNode || !targetNode) {
          continue;
        }

        const edgeId = `mapping:${nodeId}:${targetNode.id}`;
        const existing = edgeMap.get(edgeId);
        const detailItem: LineageMappingDetail = {
          mappingId: mapping.id,
          targetColumn: mapping.targetColumn,
          sourceColumns,
          rule: normalizeRuleLabel(mapping.rule, mapping.expression),
          expression: mapping.expression,
          description: mapping.description,
          status: mapping.status,
        };

        if (!existing) {
          const nextEdge: LineageGraphEdge = {
            id: edgeId,
            kind: "mapping",
            source: nodeId,
            target: targetNode.id,
            strokeColor: "#003D59",
            operations: [mappingOperation(mapping.rule, mapping.expression)],
            label: "Target mappings",
            subtitle: "1 mapped column",
            conditions: [],
            filters: [],
            mappings: [detailItem],
          };
          edgeMap.set(edgeId, nextEdge);
        } else {
          existing.mappings.push(detailItem);
          const operation = mappingOperation(mapping.rule, mapping.expression);
          if (!existing.operations.some((item) => item.label === operation.label)) {
            existing.operations.push(operation);
          }
        }

        sourceNode.highlightedColumns = Array.from(
          new Set([...sourceNode.highlightedColumns, columnName]),
        );
        targetNode.highlightedColumns = Array.from(
          new Set([...targetNode.highlightedColumns, mapping.targetColumn]),
        );
      }
    }

    edgeMap.forEach((edge) => {
      edge.label = edge.operations.map((operation) => operation.label).slice(0, 2).join(" • ");
      edge.subtitle = `${edge.mappings.length} mapped column${edge.mappings.length === 1 ? "" : "s"}`;
      edges.push(edge);
    });
  }

  const visibleEdges =
    selectedTargetColumn && edges.some((edge) => edge.kind === "mapping")
      ? filterGraphForSelectedColumn(edges, nodeById, targetNodeIdFromNodes(nodes))
      : edges;

  const visibleNodeIds = new Set<string>();
  visibleEdges.forEach((edge) => {
    visibleNodeIds.add(edge.source);
    visibleNodeIds.add(edge.target);
  });
  if (selectedTarget?.tableId) {
    visibleNodeIds.add(selectedTarget.tableId);
  }
  const visibleNodes =
    selectedTargetColumn && visibleNodeIds.size > 0
      ? nodes.filter((node) => visibleNodeIds.has(node.id))
      : nodes;

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    targetNodeId: selectedTarget?.tableId ?? null,
    mappedCount: mappings.filter(
      (mapping) =>
        mapping.status === "MAPPED" &&
        (!selectedTargetColumn || mapping.targetColumn === selectedTargetColumn),
    ).length,
    selectedTargetColumn,
  };
}

function targetNodeIdFromNodes(nodes: LineageGraphNode[]) {
  return nodes.find((node) => node.kind === "target")?.id ?? null;
}

function filterGraphForSelectedColumn(
  edges: LineageGraphEdge[],
  nodeById: Map<string, LineageGraphNode>,
  targetNodeId: string | null,
) {
  const activeNodeIds = new Set<string>();
  const queue: string[] = [];

  if (targetNodeId) {
    activeNodeIds.add(targetNodeId);
  }

  edges
    .filter((edge) => edge.kind === "mapping")
    .forEach((edge) => {
      activeNodeIds.add(edge.source);
      activeNodeIds.add(edge.target);
      queue.push(edge.source, edge.target);
    });

  while (queue.length > 0) {
    const currentId = queue.shift() as string;

    edges.forEach((edge) => {
      const touchesCurrent = edge.source === currentId || edge.target === currentId;
      if (!touchesCurrent) {
        return;
      }
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
        return;
      }
      if (!activeNodeIds.has(edge.source)) {
        activeNodeIds.add(edge.source);
        queue.push(edge.source);
      }
      if (!activeNodeIds.has(edge.target)) {
        activeNodeIds.add(edge.target);
        queue.push(edge.target);
      }
    });
  }

  return edges.filter(
    (edge) => activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target),
  );
}

export function buildNodeLevels(nodes: LineageGraphNode[], edges: LineageGraphEdge[], targetNodeId: string | null) {
  const levels = new Map<string, number>();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  nodes.forEach((node) => {
    if (node.kind === "source") {
      levels.set(node.id, 0);
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges.filter((item) => item.kind === "derived")) {
      const sourceLevel = levels.get(edge.source);
      const targetLevel = levels.get(edge.target);
      if (sourceLevel === undefined) {
        continue;
      }
      const nextLevel = sourceLevel + 1;
      if (targetLevel === undefined || nextLevel > targetLevel) {
        levels.set(edge.target, nextLevel);
        changed = true;
      }
    }
  }

  nodes.forEach((node) => {
    if (!levels.has(node.id) && node.kind === "derived") {
      levels.set(node.id, 1);
    }
  });

  const maxLevel = Math.max(0, ...levels.values());
  if (targetNodeId && nodesById.has(targetNodeId)) {
    levels.set(targetNodeId, maxLevel + 1);
  }

  return levels;
}

export function buildOrderedLevelGroups(
  nodes: LineageGraphNode[],
  edges: LineageGraphEdge[],
  levels: Map<string, number>,
) {
  const groups = new Map<number, LineageGraphNode[]>();
  const orderIndex = new Map<string, number>();

  nodes.forEach((node) => {
    const level = levels.get(node.id) ?? 0;
    const bucket = groups.get(level) ?? [];
    bucket.push(node);
    groups.set(level, bucket);
  });

  Array.from(groups.keys())
    .sort((a, b) => a - b)
    .forEach((level) => {
      const previousLevelNodes = Array.from(orderIndex.entries())
        .filter(([nodeId]) => (levels.get(nodeId) ?? 0) === level - 1)
        .sort((a, b) => a[1] - b[1]);
      const previousOrder = new Map(previousLevelNodes);
      const items = groups.get(level) ?? [];

      const sorted = [...items].sort((left, right) => {
        const leftParents = edges
          .filter((edge) => edge.target === left.id)
          .map((edge) => previousOrder.get(edge.source))
          .filter((value): value is number => value !== undefined);
        const rightParents = edges
          .filter((edge) => edge.target === right.id)
          .map((edge) => previousOrder.get(edge.source))
          .filter((value): value is number => value !== undefined);
        const leftScore =
          leftParents.length > 0
            ? leftParents.reduce((sum, value) => sum + value, 0) / leftParents.length
            : Number.MAX_SAFE_INTEGER;
        const rightScore =
          rightParents.length > 0
            ? rightParents.reduce((sum, value) => sum + value, 0) / rightParents.length
            : Number.MAX_SAFE_INTEGER;

        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }
        return left.label.localeCompare(right.label);
      });

      groups.set(level, sorted);
      sorted.forEach((node, index) => {
        orderIndex.set(node.id, index);
      });
    });

  return groups;
}

export function getNodeMappingProgress(node: LineageGraphNode) {
  return {
    mapped: node.highlightedColumns.length,
    total: node.colCount || node.columns.length,
  };
}

export type LineageCardTheme = {
  accentColor: string;
  headerBg: string;
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeFg: string;
  pillBg: string;
  pillBorder: string;
  pillFg: string;
};

export function getLineageCardTheme(
  node: LineageGraphNode,
  sourceAccent?: string,
): LineageCardTheme {
  const accent =
    node.kind === "source" ? (sourceAccent ?? node.accentColor) : node.accentColor;

  if (node.kind === "target") {
    return {
      accentColor: "#2563eb",
      headerBg: "#eef6ff",
      iconBg: "#dbeafe",
      iconColor: "#2563eb",
      badgeBg: "#dbeafe",
      badgeFg: "#2563eb",
      pillBg: "#f8fbff",
      pillBorder: "#bfdbfe",
      pillFg: "#2563eb",
    };
  }

  if (node.kind === "derived") {
    return {
      accentColor: accent,
      headerBg: "#fff7ed",
      iconBg: "#ffedd5",
      iconColor: "#d97706",
      badgeBg: "#ffedd5",
      badgeFg: "#b45309",
      pillBg: "#fffaf5",
      pillBorder: "#fed7aa",
      pillFg: "#b45309",
    };
  }

  return {
    accentColor: accent,
    headerBg: "#f5f3ff",
    iconBg: "#ede9fe",
    iconColor: accent,
    badgeBg: "#ede9fe",
    badgeFg: accent,
    pillBg: "#faf5ff",
    pillBorder: "#ddd6fe",
    pillFg: accent,
  };
}

export function summarizeNode(node: LineageGraphNode, edges: LineageGraphEdge[]) {
  const inbound = edges.filter((edge) => edge.target === node.id);
  const outbound = edges.filter((edge) => edge.source === node.id);
  const joinCount = inbound.filter((edge) => edge.kind === "join" || edge.kind === "derived").length;
  const outboundMappingCount = outbound.filter((edge) => edge.kind === "mapping").reduce(
    (count, edge) => count + edge.mappings.length,
    0,
  );
  const inboundMappingCount = inbound.filter((edge) => edge.kind === "mapping").reduce(
    (count, edge) => count + edge.mappings.length,
    0,
  );

  if (node.kind === "target") {
    return `${inboundMappingCount} mapped column${inboundMappingCount === 1 ? "" : "s"} landing in target`;
  }
  if (node.kind === "derived") {
    return `${joinCount} upstream edge${joinCount === 1 ? "" : "s"} feeding derived source`;
  }
  return `${outboundMappingCount || outbound.length} downstream path${(outboundMappingCount || outbound.length) === 1 ? "" : "s"} from source`;
}

export function describeRuleGroup(group: RuleGroup): string[] {
  return group.children.flatMap((child) => {
    if (child.type === "condition") {
      const rightValue =
        child.valueMode === "field" && child.valueField
          ? child.valueField
          : child.value || "…";
      return [`${child.field} ${child.operator} ${rightValue}`];
    }
    return describeRuleGroup(child);
  });
}

export function formatColumnReference(value: string) {
  const parts = value.split(".");
  if (parts.length >= 4) {
    return `${parts[2]}.${parts.slice(3).join(".")}`;
  }
  return value;
}

export function readableNodeLabel(id: string, nodes: LineageGraphNode[]) {
  return nodes.find((node) => node.id === id)?.label ?? id;
}

export function readableOperationLabel(operation: LineageEdgeOperation) {
  if (operation.icon === "direct") {
    return operation.label === "Direct" ? "Direct passthrough" : operation.label;
  }
  return operation.label;
}

export function readableLineageDepth(node: LineageGraphNode) {
  return node.kind === "derived" ? "Derived layer" : toTitleCase(node.kind);
}
