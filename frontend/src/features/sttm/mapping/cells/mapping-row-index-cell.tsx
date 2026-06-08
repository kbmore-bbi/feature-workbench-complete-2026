import { TableCell, Typography } from '@mui/material';
import { focusTableCellSx } from '@/components/ui/focus-table';

type MappingRowIndexCellProps = {
  index: number;
  tone?: 'mapped' | 'unmapped' | 'warning' | 'neutral';
  width?: number | string;
  minWidth?: number | string;
};

export const MappingRowIndexCell = ({
  index,
  tone = 'neutral',
  width = 44,
  minWidth,
}: MappingRowIndexCellProps) => {
  const indicatorColor =
    tone === 'mapped'
      ? '#16a34a'
      : tone === 'warning'
        ? '#f59e0b'
        : tone === 'unmapped'
          ? '#dc2626'
          : '#e5e7eb';

  return (
  <TableCell
    sx={{
      ...focusTableCellSx({ width, minWidth }),
      position: 'relative',
      pl: 1.5,
      '&::before': {
        content: '""',
        position: 'absolute',
        left: 6,
        top: 10,
        bottom: 10,
        width: 3,
        borderRadius: 999,
        backgroundColor: indicatorColor,
      },
    }}
  >
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
};
