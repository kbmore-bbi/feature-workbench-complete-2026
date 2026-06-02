import { WarningAmberRoundedIcon } from '@/utils/icons';
import { Box, Typography } from '@mui/material';
import { DATA_PREVIEW_SAMPLE_VALUES_BADGE_SX } from './mapping-data-preview-styles';

export function MappingDataPreviewSampleValuesBadge() {
  return (
    <Box component="span" sx={DATA_PREVIEW_SAMPLE_VALUES_BADGE_SX}>
      <WarningAmberRoundedIcon sx={{ fontSize: 14, color: '#f59e0b', flexShrink: 0 }} />
      <Typography
        component="span"
        sx={{ fontSize: '0.68rem', fontWeight: 700, lineHeight: 1, color: '#92400e' }}
      >
        Sample values
      </Typography>
    </Box>
  );
}
