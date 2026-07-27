import { AiaTableCellPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import type { SxProps, Theme } from '@mui/material/styles';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import { MAPPING_TABLE_BODY_TEXT_SX } from '../mapping-table-styles';

type MappingRowIndexCellProps = {
  index: number;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export const MappingRowIndexCell = ({
  index,
  width = 44,
  minWidth,
  sx,
}: MappingRowIndexCellProps) => (
  <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx })}>
    <AiaText
      sx={{
        ...MAPPING_TABLE_BODY_TEXT_SX,
        textAlign: 'left',
      }}
    >
      {index}
    </AiaText>
  </AiaTableCellPrimitive>
);
