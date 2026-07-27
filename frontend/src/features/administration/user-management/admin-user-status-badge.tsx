'use client';

import { AiaChip } from '@/components/ui/aia-chip';
import type { AdminUserStatus } from '@/data/mock/administration';

type AdminUserStatusBadgeProps = {
  status: AdminUserStatus;
};

export default function AdminUserStatusBadge({ status }: AdminUserStatusBadgeProps) {
  const isActive = status === 'Active';

  return (
    <AiaChip
      label={status}
      customBackgroundColor={isActive ? '#ECFDF5' : '#FEF2F2'}
      customBorderColor={isActive ? '#BBF7D0' : '#FECACA'}
      customColor={isActive ? '#166534' : '#B91C1C'}
    />
  );
}
