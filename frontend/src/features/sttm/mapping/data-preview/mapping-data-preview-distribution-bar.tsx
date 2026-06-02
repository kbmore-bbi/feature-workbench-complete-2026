import { Box } from '@mui/material';
import {
  DATA_PREVIEW_DISTRIBUTION_BAR_FILL_SX,
  DATA_PREVIEW_DISTRIBUTION_BAR_TRACK_SX,
} from './mapping-data-preview-styles';

type MappingDataPreviewDistributionBarProps = {
  value: string;
};

export function MappingDataPreviewDistributionBar({
  value,
}: MappingDataPreviewDistributionBarProps) {
  const width = `${Math.min(100, 28 + (value.length * 9) % 62)}%`;

  return (
    <Box sx={DATA_PREVIEW_DISTRIBUTION_BAR_TRACK_SX}>
      <Box sx={{ ...DATA_PREVIEW_DISTRIBUTION_BAR_FILL_SX, width }} />
    </Box>
  );
}
