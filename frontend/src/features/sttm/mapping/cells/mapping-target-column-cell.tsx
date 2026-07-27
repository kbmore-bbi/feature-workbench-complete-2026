import { AiaBox, AiaCircularProgress, AiaTableCellPrimitive } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import type { SxProps, Theme } from '@mui/material/styles';
import { aiaTableCellSx } from '@/components/ui/aia-table';
import { VerifiedRoundedIcon } from '@/utils/icons';
import { MAPPING_TABLE_BODY_TEXT_SX } from '../mapping-table-styles';

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
  <AiaTableCellPrimitive sx={aiaTableCellSx({ width, minWidth, sx })}>
    <AiaBox
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minWidth: 0,
        flexWrap: 'wrap',
      }}
    >
      <AiaText
        sx={{
          ...MAPPING_TABLE_BODY_TEXT_SX,
          lineHeight: 1.45,
          whiteSpace: 'normal',
          overflowWrap: 'anywhere',
          minWidth: 0,
        }}
      >
        {name}
      </AiaText>
      {isProcessing ? (
        <AiaBox
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
          <AiaCircularProgress size={10} thickness={6} sx={{ color: '#2563eb' }} />
        </AiaBox>
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
    </AiaBox>
  </AiaTableCellPrimitive>
);
