import { AiaChipCell } from '@/components/ui/aia-table';
import type { SxProps, Theme } from '@mui/material/styles';
import type { MappingStatus } from '@/features/sttm/types/sttm.types';
import type { AiaChipColor } from '@/components/ui/aia-chip';

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

const STATUS_COLORS: Record<MappingStatus, AiaChipColor> = {
  MAPPED: 'success',
  PROCESSING: 'primary',
  UNMAPPED: 'warning',
};

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
    color={STATUS_COLORS[status]}
    width={width}
    minWidth={minWidth}
    sx={sx}
  />
);
