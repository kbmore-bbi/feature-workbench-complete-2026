import { Box, TableCell, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import type { MappingState } from '@/features/sttm/types/sttm.types';
import { buildMappingDataPreview } from '../mapping-utils';
import { MappingDataPreviewValuePill } from './mapping-data-preview-value-pill';

type MappingDataPreviewCellProps = {
  mapping: MappingState;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export function MappingDataPreviewCell({
  mapping,
  width = 168,
  minWidth,
  sx,
}: MappingDataPreviewCellProps) {
  const preview = buildMappingDataPreview(mapping);

  if (!preview.displayValue || mapping.status !== 'MAPPED') {
    return (
      <TableCell sx={aiaTableCellSx({ width, minWidth, sx })}>
        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>—</Typography>
      </TableCell>
    );
  }

  return (
    <TableCell sx={aiaTableCellSx({ width, minWidth, sx })}>
      <Box sx={{ minWidth: 0 }}>
        {preview.hasTransform ? (
          <MappingDataPreviewValuePill
            value={preview.transformedValue}
            variant="transformed"
            ruleLabel={preview.ruleLabel}
          />
        ) : (
          <MappingDataPreviewValuePill
            value={preview.displayValue}
            variant="mapped"
          />
        )}
      </Box>
    </TableCell>
  );
}
