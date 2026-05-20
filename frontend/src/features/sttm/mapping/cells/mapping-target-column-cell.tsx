import { Box, TableCell, Typography } from '@mui/material';
import { focusTableCellSx } from '@/components/ui/focus-table';

type MappingTargetColumnCellProps = {
  name: string;
  type?: string;
  width?: number | string;
  minWidth?: number | string;
};

export const MappingTargetColumnCell = ({
  name,
  type,
  width,
  minWidth,
}: MappingTargetColumnCellProps) => (
  <TableCell sx={focusTableCellSx({ width, minWidth })}>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography
        sx={{
          fontSize: '0.85rem',
          fontWeight: 600,
          color: '#111827',
          lineHeight: 1.3,
        }}
      >
        {name}
      </Typography>
      {type ? (
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: '#6b7280',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {type}
        </Typography>
      ) : null}
    </Box>
  </TableCell>
);
