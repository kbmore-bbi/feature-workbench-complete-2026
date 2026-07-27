'use client';

import { AiaChip } from '@/components/ui/aia-chip';
import type { AuditLogAction } from '@/data/mock/administration';

const ACTION_COLORS: Record<
  AuditLogAction,
  { bg: string; border: string; text: string }
> = {
  'User Login': { bg: '#F8FAFC', border: '#E2E8F0', text: '#475569' },
  'User Created': { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
  'User Updated': { bg: '#F0F9FF', border: '#BAE6FD', text: '#0369A1' },
  'User Locked': { bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C' },
  'User Unlocked': { bg: '#ECFDF5', border: '#BBF7D0', text: '#166534' },
  'Mapping Published': { bg: '#ECFDF5', border: '#BBF7D0', text: '#166534' },
  'Mapping Edited': { bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C' },
  'Mapping Created': { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
  'Mapping Locked': { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309' },
  'Mapping Unlocked': { bg: '#ECFDF5', border: '#BBF7D0', text: '#166534' },
  'Ownership Transferred': { bg: '#F5F3FF', border: '#DDD6FE', text: '#6D28D9' },
  'Mapping Deleted': { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' },
};

type AuditLogActionBadgeProps = {
  action: AuditLogAction;
};

export default function AuditLogActionBadge({ action }: AuditLogActionBadgeProps) {
  const palette = ACTION_COLORS[action];

  return (
    <AiaChip
      label={action}
      customBackgroundColor={palette.bg}
      customBorderColor={palette.border}
      customColor={palette.text}
    />
  );
}
