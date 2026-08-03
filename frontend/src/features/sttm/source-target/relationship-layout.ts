import type { JoinConfig } from '@/features/sttm/types/sttm.types';

export type RelationshipLayoutMetrics = {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  startX: number;
  startY: number;
};

export const RELATIONSHIP_LAYOUT_FULL: RelationshipLayoutMetrics = {
  nodeWidth: 360,
  nodeHeight: 380,
  gapX: 64,
  gapY: 40,
  startX: 48,
  startY: 48,
};

export const RELATIONSHIP_LAYOUT_COMPACT: RelationshipLayoutMetrics = {
  nodeWidth: 280,
  nodeHeight: 300,
  gapX: 48,
  gapY: 32,
  startX: 32,
  startY: 40,
};

const NEAR_GAP_X = 48;
const NEAR_GAP_Y = 36;

function columnX(metrics: RelationshipLayoutMetrics, columnIndex: number) {
  return metrics.startX + columnIndex * (metrics.nodeWidth + metrics.gapX);
}

function rowY(metrics: RelationshipLayoutMetrics, rowIndex: number) {
  return metrics.startY + rowIndex * (metrics.nodeHeight + metrics.gapY);
}

function columnIndexFromX(x: number, metrics: RelationshipLayoutMetrics) {
  const step = metrics.nodeWidth + metrics.gapX;
  if (step <= 0) return 0;
  return Math.max(0, Math.round((x - metrics.startX) / step));
}

function rectanglesOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
  metrics: RelationshipLayoutMetrics,
) {
  const horizontalOverlap =
    a.x < b.x + metrics.nodeWidth && a.x + metrics.nodeWidth > b.x;
  const verticalOverlap =
    a.y < b.y + metrics.nodeHeight && a.y + metrics.nodeHeight > b.y;
  return horizontalOverlap && verticalOverlap;
}

function findOpenSlotInColumn(
  columnIndex: number,
  occupiedPositions: Array<{ x: number; y: number }>,
  metrics: RelationshipLayoutMetrics,
  preferredY?: number,
  gapX = metrics.gapX,
  gapY = metrics.gapY,
) {
  const targetX = metrics.startX + columnIndex * (metrics.nodeWidth + gapX);
  let candidateY = preferredY ?? metrics.startY;

  while (
    occupiedPositions.some((position) =>
      rectanglesOverlap({ x: targetX, y: candidateY }, position, metrics),
    )
  ) {
    candidateY += metrics.nodeHeight + gapY;
  }

  return { x: targetX, y: candidateY };
}

function resolveAnchorTableId(
  newTableId: string,
  existingIds: Set<string>,
  joins: JoinConfig[],
  drivingTableId: string | null | undefined,
  fallbackTableId?: string,
) {
  for (const join of joins) {
    if (
      join.leftTableId === newTableId &&
      join.rightTableId &&
      existingIds.has(join.rightTableId)
    ) {
      return join.rightTableId;
    }
    if (
      join.rightTableId === newTableId &&
      join.leftTableId &&
      existingIds.has(join.leftTableId)
    ) {
      return join.leftTableId;
    }
  }

  if (drivingTableId && existingIds.has(drivingTableId)) {
    return drivingTableId;
  }

  return fallbackTableId ?? null;
}

function findNearPlacementForNewNode(
  newTableId: string,
  previousNodes: Array<{ id: string; position: { x: number; y: number } }>,
  occupiedPositions: Array<{ x: number; y: number }>,
  layoutPositions: Record<string, { x: number; y: number }>,
  metrics: RelationshipLayoutMetrics,
  joins: JoinConfig[],
  drivingTableId: string | null | undefined,
) {
  if (previousNodes.length === 0) {
    return layoutPositions[newTableId] ?? { x: metrics.startX, y: metrics.startY };
  }

  const existingIds = new Set(previousNodes.map((node) => node.id));
  const positionById = Object.fromEntries(
    previousNodes.map((node) => [node.id, node.position]),
  ) as Record<string, { x: number; y: number }>;

  const anchorId = resolveAnchorTableId(
    newTableId,
    existingIds,
    joins,
    drivingTableId,
    previousNodes[0]?.id,
  );
  const anchorPosition = anchorId ? positionById[anchorId] : null;

  const candidateOffsets = anchorPosition
    ? [
        { x: anchorPosition.x + metrics.nodeWidth + NEAR_GAP_X, y: anchorPosition.y },
        { x: anchorPosition.x, y: anchorPosition.y + metrics.nodeHeight + NEAR_GAP_Y },
      ]
    : [];

  if (occupiedPositions.length > 0) {
    const maxRight = Math.max(
      ...occupiedPositions.map((position) => position.x + metrics.nodeWidth),
    );
    const minY = Math.min(...occupiedPositions.map((position) => position.y));
    candidateOffsets.push({ x: maxRight + NEAR_GAP_X, y: minY });
  }

  for (const candidate of candidateOffsets) {
    if (
      !occupiedPositions.some((position) =>
        rectanglesOverlap(candidate, position, metrics),
      )
    ) {
      return candidate;
    }
  }

  if (anchorPosition) {
    return findOpenSlotInColumn(
      columnIndexFromX(anchorPosition.x, metrics),
      occupiedPositions,
      metrics,
      anchorPosition.y + metrics.nodeHeight + NEAR_GAP_Y,
      NEAR_GAP_X,
      NEAR_GAP_Y,
    );
  }

  const layoutPosition = layoutPositions[newTableId] ?? {
    x: metrics.startX,
    y: metrics.startY,
  };
  return findOpenSlotInColumn(
    columnIndexFromX(layoutPosition.x, metrics),
    occupiedPositions,
    metrics,
    layoutPosition.y,
    NEAR_GAP_X,
    NEAR_GAP_Y,
  );
}

/**
 * Default hub layout: driving table in the left column, joined tables in
 * subsequent columns by join distance (see reference sketch).
 */
export function buildRelationshipLayout(
  tableIds: string[],
  drivingTableId: string | null | undefined,
  joins: JoinConfig[],
  metrics: RelationshipLayoutMetrics = RELATIONSHIP_LAYOUT_FULL,
): Record<string, { x: number; y: number }> {
  if (tableIds.length === 0) return {};

  const driving =
    drivingTableId && tableIds.includes(drivingTableId) ? drivingTableId : tableIds[0];

  const levels = new Map<string, number>();
  levels.set(driving, 0);

  const adjacency = new Map<string, Set<string>>();
  for (const tableId of tableIds) {
    adjacency.set(tableId, new Set());
  }

  for (const join of joins) {
    const leftId = join.leftTableId;
    const rightId = join.rightTableId;
    if (!leftId || !rightId) continue;
    if (!adjacency.has(leftId) || !adjacency.has(rightId)) continue;
    adjacency.get(leftId)?.add(rightId);
    adjacency.get(rightId)?.add(leftId);
  }

  const queue = [driving];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentLevel = levels.get(current) ?? 0;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (levels.has(neighbor)) continue;
      levels.set(neighbor, currentLevel + 1);
      queue.push(neighbor);
    }
  }

  const disconnectedIds = tableIds
    .filter((tableId) => !levels.has(tableId))
    .sort();
  const connectedMaxLevel = Math.max(0, ...Array.from(levels.values()));
  const disconnectedStartLevel = levels.size === 1 ? 0 : connectedMaxLevel + 1;
  const disconnectedColumnCount = Math.min(3, Math.max(1, disconnectedIds.length));
  disconnectedIds.forEach((tableId, index) => {
    levels.set(
      tableId,
      disconnectedStartLevel + (index % disconnectedColumnCount),
    );
  });

  const tablesByLevel = new Map<number, string[]>();
  for (const tableId of tableIds) {
    const level = levels.get(tableId) ?? 0;
    const bucket = tablesByLevel.get(level) ?? [];
    bucket.push(tableId);
    tablesByLevel.set(level, bucket);
  }

  for (const bucket of tablesByLevel.values()) {
    bucket.sort();
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const occupiedPositions: Array<{ x: number; y: number }> = [];

  for (const [level, ids] of Array.from(tablesByLevel.entries()).sort(([a], [b]) => a - b)) {
    ids.forEach((tableId, rowIndex) => {
      const position = findOpenSlotInColumn(
        level,
        occupiedPositions,
        metrics,
        rowY(metrics, rowIndex),
      );
      positions[tableId] = position;
      occupiedPositions.push(position);
    });
  }

  return positions;
}

export type MergeRelationshipNodeOptions = {
  joins?: JoinConfig[];
  drivingTableId?: string | null;
};

export function mergeRelationshipNodePositions<
  T extends { id: string; position: { x: number; y: number } },
>(
  nextNodes: T[],
  previousNodes: T[],
  layoutPositions: Record<string, { x: number; y: number }>,
  metrics: RelationshipLayoutMetrics = RELATIONSHIP_LAYOUT_FULL,
  options: MergeRelationshipNodeOptions = {},
): T[] {
  const joins = options.joins ?? [];
  const drivingTableId = options.drivingTableId;
  const occupiedPositions = previousNodes.map((node) => node.position);

  const newNodes = nextNodes
    .filter((node) => !previousNodes.some((previous) => previous.id === node.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  const resolvedNewPositions = new Map<string, { x: number; y: number }>();

  for (const node of newNodes) {
    const position = findNearPlacementForNewNode(
      node.id,
      previousNodes,
      occupiedPositions,
      layoutPositions,
      metrics,
      joins,
      drivingTableId,
    );
    resolvedNewPositions.set(node.id, position);
    occupiedPositions.push(position);
  }

  return nextNodes.map((node) => {
    const existing = previousNodes.find((previous) => previous.id === node.id);
    if (existing) {
      return { ...node, position: existing.position };
    }

    return {
      ...node,
      position: resolvedNewPositions.get(node.id) ?? {
        x: metrics.startX,
        y: metrics.startY,
      },
    };
  });
}

export function getRelationshipViewportPadding(
  metrics: RelationshipLayoutMetrics = RELATIONSHIP_LAYOUT_FULL,
) {
  return {
    left: Math.max(16, metrics.startX - 24),
    top: Math.max(16, metrics.startY - 24),
  };
}
