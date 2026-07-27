import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { WarningAmberRoundedIcon } from '@/utils/icons';

import { DATA_PREVIEW_SAMPLE_VALUES_BADGE_SX } from './mapping-data-preview-styles';

export function MappingDataPreviewSampleValuesBadge() {
  return (
    <AiaBox component="span" sx={DATA_PREVIEW_SAMPLE_VALUES_BADGE_SX}>
      <WarningAmberRoundedIcon sx={{ fontSize: 14, color: '#f59e0b', flexShrink: 0 }} />
      <AiaText
        component="span"
        sx={{ fontSize: '0.68rem', fontWeight: 700, lineHeight: 1, color: '#92400e' }}
      >
        Sample values
      </AiaText>
    </AiaBox>
  );
}
