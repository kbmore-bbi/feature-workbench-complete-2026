import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import { Box, TableCell, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { focusTableCellSx } from '@/components/ui/focus-table';

type MappingTargetColumnCellProps = {
  name: string;
  isMapped?: boolean;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export const MappingTargetColumnCell = ({
  name,
  isMapped = false,
  width,
  minWidth,
  sx,
}: MappingTargetColumnCellProps) => (
  <TableCell sx={focusTableCellSx({ width, minWidth, sx })}>
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minWidth: 0,
        flexWrap: 'wrap',
      }}
    >
      <Typography
        sx={{
          fontSize: '0.8rem',
          fontWeight: 400,
          color: '#111827',
          lineHeight: 1.45,
          whiteSpace: 'normal',
          overflowWrap: 'anywhere',
          minWidth: 0,
        }}
      >
        {name}
      </Typography>
      {isMapped ? (
        <VerifiedRoundedIcon
          aria-label="Mapped"
          sx={{
            fontSize: 16,
            color: '#22c55e',
            flexShrink: 0,
          }}
        />
      ) : null}
    </Box>
  </TableCell>
);
