import { Box, Typography } from '@mui/material';
import { formatSqlType } from '../mapping-utils';
import { DATA_PREVIEW_ATTRIBUTE_TYPE_SX } from './mapping-data-preview-styles';

type MappingDataPreviewAttributeLabelProps = {
  name: string;
  dataType?: string | null;
};

export function MappingDataPreviewAttributeLabel({
  name,
  dataType,
}: MappingDataPreviewAttributeLabelProps) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          fontSize: '0.8rem',
          fontWeight: 400,
          color: '#111827',
          lineHeight: 1.35,
          overflowWrap: 'anywhere',
        }}
      >
        {name}
      </Typography>
      <Typography sx={DATA_PREVIEW_ATTRIBUTE_TYPE_SX}>
        {dataType ? formatSqlType(dataType).toLowerCase() : '—'}
      </Typography>
    </Box>
  );
}
