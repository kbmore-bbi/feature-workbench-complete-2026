import { FocusChipCell } from '@/components/ui/focus-table';
import type { MappingStatus } from '@/features/sttm/types/sttm.types';

type MappingStatusCellProps = {
  status: MappingStatus;
  width?: number | string;
  minWidth?: number | string;
};

const STATUS_LABELS: Record<MappingStatus, string> = {
  MAPPED: 'Mapped',
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
  bgcolor: '#f3f4f6',
  color: '#6b7280',
  border: '1px solid #e5e7eb',
  borderRadius: '999px',
} as const;

export const MappingStatusCell = ({
  status,
  width = 110,
  minWidth,
}: MappingStatusCellProps) => (
  <FocusChipCell
    align="right"
    label={STATUS_LABELS[status]}
    chipSx={status === 'MAPPED' ? MAPPED_SX : UNMAPPED_SX}
    width={width}
    minWidth={minWidth}
  />
);
