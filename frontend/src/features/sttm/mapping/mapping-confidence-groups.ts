import type { MappingState } from '@/features/sttm/types/sttm.types';

export type ConfidenceGroupId = 'high' | 'medium' | 'low';

export type ConfidenceGroupConfig = {
  id: ConfidenceGroupId;
  title: string;
  rangeLabel: string;
  backgroundColor: string;
  dotColor: string;
  titleColor: string;
  badgeBackground: string;
  badgeColor: string;
};

export const CONFIDENCE_GROUP_ORDER: ConfidenceGroupId[] = ['high', 'medium', 'low'];

export const CONFIDENCE_GROUP_CONFIG: Record<ConfidenceGroupId, ConfidenceGroupConfig> = {
  high: {
    id: 'high',
    title: 'HIGH CONFIDENCE',
    rangeLabel: 'Confidence: 80-100%',
    backgroundColor: '#ecfdf5',
    dotColor: '#16a34a',
    titleColor: '#15803d',
    badgeBackground: '#f1f5f9',
    badgeColor: '#64748b',
  },
  medium: {
    id: 'medium',
    title: 'MEDIUM CONFIDENCE',
    rangeLabel: 'Confidence: 60-80%',
    backgroundColor: '#fefce8',
    dotColor: '#d97706',
    titleColor: '#b45309',
    badgeBackground: '#f1f5f9',
    badgeColor: '#64748b',
  },
  low: {
    id: 'low',
    title: 'LOW CONFIDENCE / UNMAPPED',
    rangeLabel: 'Confidence: 0-60%',
    backgroundColor: '#fef2f2',
    dotColor: '#dc2626',
    titleColor: '#b91c1c',
    badgeBackground: '#f1f5f9',
    badgeColor: '#64748b',
  },
};

/** Normalize API scores that may arrive as 0-1 fractions or 0-100 percentages. */
export function normalizeConfidencePercent(
  confidenceScore: number | null | undefined,
): number | null {
  if (confidenceScore == null || Number.isNaN(Number(confidenceScore))) {
    return null;
  }
  const raw = Number(confidenceScore);
  const percent = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, percent));
}

export function hasConfidenceScore(
  confidenceScore: number | null | undefined,
): boolean {
  return normalizeConfidencePercent(confidenceScore) != null;
}

export function getConfidenceGroup(
  confidenceScore: number | null | undefined,
  _status?: MappingState['status'],
): ConfidenceGroupId {
  void _status;
  const percent = normalizeConfidencePercent(confidenceScore);
  // Missing scores (typical for unmapped rows before Auto-map) belong in low.
  if (percent == null) {
    return 'low';
  }

  if (percent >= 80) return 'high';
  if (percent >= 60) return 'medium';
  return 'low';
}

export function sortMappingsByConfidenceGroups(mappings: MappingState[]): MappingState[] {
  return [...mappings].sort((left, right) => {
    const leftGroup = getConfidenceGroup(left.confidenceScore, left.status);
    const rightGroup = getConfidenceGroup(right.confidenceScore, right.status);
    const groupOrder =
      CONFIDENCE_GROUP_ORDER.indexOf(leftGroup) - CONFIDENCE_GROUP_ORDER.indexOf(rightGroup);
    if (groupOrder !== 0) return groupOrder;

    const leftScore = normalizeConfidencePercent(left.confidenceScore) ?? -1;
    const rightScore = normalizeConfidencePercent(right.confidenceScore) ?? -1;
    if (rightScore !== leftScore) return rightScore - leftScore;

    return left.targetColumn.localeCompare(right.targetColumn);
  });
}

export function countMappingsByConfidenceGroup(
  mappings: MappingState[],
): Record<ConfidenceGroupId, number> {
  return mappings.reduce(
    (counts, mapping) => {
      const group = getConfidenceGroup(mapping.confidenceScore, mapping.status);
      counts[group] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 } satisfies Record<ConfidenceGroupId, number>,
  );
}
