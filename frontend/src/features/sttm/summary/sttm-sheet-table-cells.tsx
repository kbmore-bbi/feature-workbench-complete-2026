import { AiaBox, AiaTableCellPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { ArrowBackRoundedIcon, FiberManualRecordRoundedIcon } from '@/utils/icons';

import type { SxProps, Theme } from '@mui/material/styles';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import { MappingDataPreviewValuePill } from '@/features/sttm/mapping/data-preview';
import { formatSqlType } from '@/features/sttm/mapping/mapping-utils';

function getSourceColumnName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.includes('.') ? trimmed.split('.').pop() ?? trimmed : trimmed;
}

const SOURCE_TYPE_PILL_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  px: 0.75,
  py: 0.15,
  borderRadius: '4px',
  border: '1px solid #e5e7eb',
  bgcolor: '#f8fafc',
  fontSize: '0.62rem',
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: '0.03em',
  lineHeight: 1.2,
  flexShrink: 0,
} as const;

type SttmSheetTransformRuleCellProps = {
  rule: string;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export function SttmSheetTransformRuleCell({
  rule,
  width = 140,
  minWidth,
  sx,
}: SttmSheetTransformRuleCellProps) {
  const isDirect = !rule || rule === 'Direct';

  return (
    <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx })}>
      {isDirect ? (
        <AiaText sx={{ fontSize: '0.8rem', color: '#64748b' }}>Direct</AiaText>
      ) : (
        <MappingDataPreviewValuePill value={rule} variant="transformed" />
      )}
    </AiaTableCellPrimitive>
  );
}

type SttmSheetSourceColumnCellProps = {
  value: string | null;
  sourceType?: string | null;
  mapped: boolean;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export function SttmSheetSourceColumnCell({
  value,
  sourceType,
  mapped,
  width = 300,
  minWidth,
  sx,
}: SttmSheetSourceColumnCellProps) {
  return (
    <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx }, { overflow: 'hidden' })}>
      {mapped && value ? (
        <AiaBox
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.65,
            minWidth: 0,
            flexWrap: 'wrap',
          }}
        >
          <ArrowBackRoundedIcon
            sx={{ fontSize: 14, color: '#94a3b8', flexShrink: 0 }}
            aria-hidden
          />
          <FiberManualRecordRoundedIcon
            sx={{ fontSize: 8, color: '#22c55e', flexShrink: 0 }}
            aria-hidden
          />
          <AiaText
            sx={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: '#111827',
              letterSpacing: '0.02em',
              overflowWrap: 'anywhere',
              minWidth: 0,
            }}
          >
            {getSourceColumnName(value)}
          </AiaText>
          {sourceType ? (
            <AiaBox component="span" sx={SOURCE_TYPE_PILL_SX}>
              {formatSqlType(sourceType)}
            </AiaBox>
          ) : null}
        </AiaBox>
      ) : (
        <AiaText
          sx={{
            fontSize: '0.78rem',
            color: '#94a3b8',
            fontStyle: 'italic',
          }}
        >
          — not mapped
        </AiaText>
      )}
    </AiaTableCellPrimitive>
  );
}

type SttmSheetDescriptionCellProps = {
  description: string;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export function SttmSheetDescriptionCell({
  description,
  width = 240,
  minWidth,
  sx,
}: SttmSheetDescriptionCellProps) {
  return (
    <AiaTableCellPrimitive
      sx={aiaTableCellSx({ width, minWidth, sx }, { overflow: 'hidden', maxWidth: width })}
    >
      <AiaText
        sx={{
          fontSize: '0.76rem',
          color: '#475569',
          lineHeight: 1.45,
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        {description || '—'}
      </AiaText>
    </AiaTableCellPrimitive>
  );
}
