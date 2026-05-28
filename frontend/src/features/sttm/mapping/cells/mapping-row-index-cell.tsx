import { TableCell, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { focusTableCellSx } from '@/components/ui/focus-table';

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
  <TableCell sx={focusTableCellSx({ width, minWidth, sx })}>
    <Typography
      sx={{
        fontSize: '0.72rem',
        color: '#9ca3af',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        textAlign: 'left',
      }}
    >
      {index}
    </Typography>
  </TableCell>
);
