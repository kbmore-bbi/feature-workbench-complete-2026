import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { MappingDataPreviewIcon } from './mapping-data-preview-icon';
import { MappingDataPreviewSampleValuesBadge } from './mapping-data-preview-sample-values-badge';
import { DATA_PREVIEW_MAPPINGS_COUNT_SX } from './mapping-data-preview-styles';

type MappingDataPreviewHeaderProps = {
  targetTableName?: string | null;
  mappedCount: number;
};

export function MappingDataPreviewHeader({
  targetTableName,
  mappedCount,
}: MappingDataPreviewHeaderProps) {
  return (
    <AiaBox
      sx={{
        px: 2,
        py: 1.35,
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        flexShrink: 0,
      }}
    >
      <AiaBox
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        <MappingDataPreviewIcon sx={{ fontSize: 18, color: '#64748b' }} />
        <AiaText sx={{ fontSize: '0.95rem', fontWeight: 800, color: '#111827' }}>
          Data Preview
        </AiaText>
        {targetTableName ? (
          <AiaText
            sx={{
              fontSize: '0.82rem',
              fontWeight: 600,
              color: '#94a3b8',
              letterSpacing: '0.01em',
            }}
          >
            {targetTableName}
          </AiaText>
        ) : null}
      </AiaBox>

      <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
        <AiaText sx={DATA_PREVIEW_MAPPINGS_COUNT_SX}>{mappedCount} mappings</AiaText>
        <MappingDataPreviewSampleValuesBadge />
      </AiaBox>
    </AiaBox>
  );
}
