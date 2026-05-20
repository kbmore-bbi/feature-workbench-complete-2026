import { TableCell, Typography } from '@mui/material';
import { focusTableCellSx } from '@/components/ui/focus-table';

type MappingRowIndexCellProps = {
  index: number;
  width?: number | string;
  minWidth?: number | string;
};

export const MappingRowIndexCell = ({
  index,
  width = 44,
  minWidth,
}: MappingRowIndexCellProps) => (
  <TableCell sx={focusTableCellSx({ width, minWidth })}>
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
