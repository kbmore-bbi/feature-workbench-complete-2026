import { Box, CircularProgress, TableCell, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import { VerifiedRoundedIcon } from '@/utils/icons';

type MappingTargetColumnCellProps = {
  name: string;
  isMapped?: boolean;
  showMappedIcon?: boolean;
  isProcessing?: boolean;
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

export const MappingTargetColumnCell = ({
  name,
  isMapped = false,
  showMappedIcon = true,
  isProcessing = false,
  width,
  minWidth,
  sx,
}: MappingTargetColumnCellProps) => (
  <TableCell sx={aiaTableCellSx({ width, minWidth, sx })}>
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
      ) : showMappedIcon && isMapped ? (
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
