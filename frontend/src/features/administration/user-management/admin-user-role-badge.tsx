'use client';

import { AiaChip } from '@/components/ui/aia-chip';
import type { AdminUserRole } from '@/data/mock/administration';

const ROLE_CHIP_COLORS: Record<
  AdminUserRole,
  { bg: string; border: string; text: string }
> = {
  Admin: { bg: '#F5F3FF', border: '#DDD6FE', text: '#6D28D9' },
  Publisher: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
  Editor: { bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C' },
  Viewer: { bg: '#F8FAFC', border: '#E2E8F0', text: '#475569' },
};

type AdminUserRoleBadgeProps = {
  role: AdminUserRole;
};

export default function AdminUserRoleBadge({ role }: AdminUserRoleBadgeProps) {
  const palette = ROLE_CHIP_COLORS[role];

  return (
    <AiaChip
      label={role}
      customBackgroundColor={palette.bg}
      customBorderColor={palette.border}
      customColor={palette.text}
    />
  );
}
