import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import { Box, CircularProgress, TableCell, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { focusTableCellSx } from '@/components/ui/focus-table';

type MappingTargetColumnCellProps = {
  name: string;
  isMapped?: boolean;
  isProcessing?: boolean;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export const MappingTargetColumnCell = ({
  name,
  isMapped = false,
  isProcessing = false,
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
      {isProcessing ? (
        <Box
          aria-label="Processing"
          sx={{
            width: 18,
            height: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '999px',
            bgcolor: '#eff6ff',
            color: '#2563eb',
            border: '1px solid #bfdbfe',
            flexShrink: 0,
          }}
        >
          <CircularProgress size={10} thickness={6} sx={{ color: '#2563eb' }} />
        </Box>
      ) : isMapped ? (
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
