'use client';

import { AiaBox, AiaChip, AiaTableCellPrimitive, AiaTableRowPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import {
  CONFIDENCE_GROUP_CONFIG,
  type ConfidenceGroupId,
} from './mapping-confidence-groups';

type MappingConfidenceGroupHeaderRowProps = {
  groupId: ConfidenceGroupId;
  rowCount: number;
  colSpan: number;
};

export function MappingConfidenceGroupHeaderRow({
  groupId,
  rowCount,
  colSpan,
}: MappingConfidenceGroupHeaderRowProps) {
  const config = CONFIDENCE_GROUP_CONFIG[groupId];
  const rowLabel = `${rowCount} row${rowCount === 1 ? '' : 's'}`;

  return (
    <AiaTableRowPrimitive>
      <AiaTableCellPrimitive
        colSpan={colSpan}
        sx={{
          backgroundColor: config.backgroundColor,
          borderBottom: '1px solid #edf2f7',
          py: 1.1,
          px: 2,
        }}
      >
        <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <AiaBox
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: config.dotColor,
              flexShrink: 0,
            }}
          />
          <AiaText
            sx={{
              fontWeight: 800,
              fontSize: '0.72rem',
              letterSpacing: '0.06em',
              color: config.titleColor,
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            {config.title}
          </AiaText>
          <AiaChip
            label={rowLabel}
            size="small"
            sx={{
              height: 22,
              bgcolor: config.badgeBackground,
              color: config.badgeColor,
              fontSize: '0.68rem',
              fontWeight: 600,
              borderRadius: '999px',
              '& .MuiChip-label': { px: 1.1 },
            }}
          />
          <AiaText
            sx={{
              color: '#94a3b8',
              fontSize: '0.72rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {config.rangeLabel}
          </AiaText>
        </AiaBox>
      </AiaTableCellPrimitive>
    </AiaTableRowPrimitive>
  );
}
