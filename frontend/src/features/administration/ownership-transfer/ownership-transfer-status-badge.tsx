'use client';

import { AiaChip } from '@/components/ui/aia-chip';
import type { OwnershipTransferStatus } from '@/data/mock/administration';

const STATUS_COLORS: Record<
  OwnershipTransferStatus,
  'success' | 'warning' | 'info'
> = {
  Published: 'success',
  Draft: 'warning',
  'In Review': 'info',
};

type OwnershipTransferStatusBadgeProps = {
  status: OwnershipTransferStatus;
};

export default function OwnershipTransferStatusBadge({ status }: OwnershipTransferStatusBadgeProps) {
  return <AiaChip label={status} color={STATUS_COLORS[status]} />;
}
