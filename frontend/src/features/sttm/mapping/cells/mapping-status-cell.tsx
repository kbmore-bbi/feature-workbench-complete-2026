import { AiaChipCell } from '@/components/ui/aia-table';
import type { SxProps, Theme } from '@mui/material/styles';
import type { MappingStatus } from '@/features/sttm/types/sttm.types';

type MappingStatusCellProps = {
  status: MappingStatus;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  minWidth?: number | string;
  sx?: SxProps<Theme>;
};

const STATUS_LABELS: Record<MappingStatus, string> = {
  MAPPED: 'Mapped',
  PROCESSING: 'Processing',
  UNMAPPED: 'Unmapped',
};

const MAPPED_SX = {
  height: 22,
  fontSize: '0.7rem',
  fontWeight: 700,
  bgcolor: '#dcfce7',
  color: '#166534',
  border: '1px solid #bbf7d0',
  borderRadius: '999px',
} as const;

const UNMAPPED_SX = {
  height: 22,
  fontSize: '0.7rem',
  fontWeight: 700,
  bgcolor: '#ffedd5',
  color: '#c2410c',
  border: '1px solid #fed7aa',
  borderRadius: '999px',
} as const;

const PROCESSING_SX = {
  height: 22,
  fontSize: '0.7rem',
  fontWeight: 700,
  bgcolor: '#eff6ff',
  color: '#1d4ed8',
  border: '1px solid #bfdbfe',
  borderRadius: '999px',
} as const;

export const MappingStatusCell = ({
  status,
  align = 'left',
  width = 110,
  minWidth,
  sx,
}: MappingStatusCellProps) => (
  <AiaChipCell
    align={align}
    label={STATUS_LABELS[status]}
    chipSx={status === 'MAPPED' ? MAPPED_SX : status === 'PROCESSING' ? PROCESSING_SX : UNMAPPED_SX}
    width={width}
    minWidth={minWidth}
    sx={sx}
  />
);
