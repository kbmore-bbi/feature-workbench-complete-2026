'use client';

import { AiaBox, AiaTableCellPrimitive, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';
import { InfoOutlinedIcon } from '@/utils/icons';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

import { getConfidenceGroup, normalizeConfidencePercent } from '../mapping-confidence-groups';

type MappingConfidenceCellProps = {
  confidenceScore?: number | null;
  status?: 'MAPPED' | 'UNMAPPED' | 'PROCESSING';
  reason?: string | null;
  businessMeaning?: string | null;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

const BAND_COLORS = {
  high: { text: '#166534', bar: '#22c55e', track: '#dcfce7' },
  medium: { text: '#92400e', bar: '#f59e0b', track: '#fef3c7' },
  low: { text: '#b91c1c', bar: '#ef4444', track: '#fee2e2' },
} as const;

function buildTooltipContent({
  confidenceScore,
  reason,
  businessMeaning,
}: {
  confidenceScore: number | null | undefined;
  reason?: string | null;
  businessMeaning?: string | null;
}): ReactNode {
  if (confidenceScore == null && !reason && !businessMeaning) {
    return null;
  }

  const band =
    confidenceScore == null
      ? null
      : (() => {
          const percent = normalizeConfidencePercent(confidenceScore);
          if (percent == null) return null;
          if (percent >= 80) return 'High confidence';
          if (percent >= 60) return 'Medium confidence';
          return 'Low confidence';
        })();

  return (
    <AiaBox sx={{ display: 'grid', gap: 0.7, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
      {band ? (
        <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit', fontWeight: 800 }}>
          {band}
        </AiaText>
      ) : null}
      {businessMeaning ? (
        <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
          <strong>Business fit:</strong> {businessMeaning}
        </AiaText>
      ) : null}
      {reason ? (
        <AiaText sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
          <strong>Why:</strong> {reason}
        </AiaText>
      ) : null}
    </AiaBox>
  );
}

export function MappingConfidenceCell({
  confidenceScore,
  status,
  reason,
  businessMeaning,
  width,
  minWidth,
  sx,
}: MappingConfidenceCellProps) {
  const group = getConfidenceGroup(confidenceScore, status);
  const colors = BAND_COLORS[group];
  const percent = normalizeConfidencePercent(confidenceScore);
  const tooltipContent = buildTooltipContent({
    confidenceScore,
    reason,
    businessMeaning,
  });

  return (
    <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx })}>
      <AiaBox
        data-tour={TOUR_TARGETS.sttmConfidenceScore}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.6,
          minWidth: 0,
          width: '100%',
        }}
      >
        <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <AiaText
            sx={{
              fontSize: '0.75rem',
              fontWeight: 800,
              color: colors.text,
              lineHeight: 1.2,
            }}
          >
            {percent == null ? '—' : `${Math.round(percent)}%`}
          </AiaText>
          {tooltipContent ? (
            <AiaTooltip
              title={tooltipContent}
              placement="top"
              arrow
              enterDelay={200}
              slotProps={{
                tooltip: {
                  sx: {
                    fontSize: '0.72rem',
                    maxWidth: 360,
                    lineHeight: 1.5,
                  },
                },
              }}
            >
              <InfoOutlinedIcon sx={{ fontSize: 15, color: '#64748b', cursor: 'help' }} />
            </AiaTooltip>
          ) : null}
        </AiaBox>
        <AiaBox
          sx={{
            width: '100%',
            height: 6,
            borderRadius: 999,
            bgcolor: colors.track,
            overflow: 'hidden',
          }}
        >
          <AiaBox
            sx={{
              width: `${percent ?? 0}%`,
              height: '100%',
              borderRadius: 999,
              bgcolor: colors.bar,
              transition: 'width 160ms ease',
            }}
          />
        </AiaBox>
      </AiaBox>
    </AiaTableCellPrimitive>
  );
}
