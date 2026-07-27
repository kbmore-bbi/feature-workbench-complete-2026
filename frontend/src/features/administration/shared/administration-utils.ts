import type {
  AdminUserListItem,
  AdminUserRole,
  AdminUserStatus,
  AuditLogAction,
  AuditLogListItem,
} from '@/data/mock/administration';

export const CURRENT_ADMIN_ACTOR = {
  initials: 'SW',
  name: 'Shane Watson',
} as const;

export const MAPPING_LOCK_CONCURRENT_USER_THRESHOLD = 2;

export type UserProfileInput = {
  name: string;
  email: string;
  role: AdminUserRole;
  status: AdminUserStatus;
};

export function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function formatAuditTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDisplayDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDisplayTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function createAuditEntry(
  action: AuditLogAction,
  target: string,
  details: string,
  actor = CURRENT_ADMIN_ACTOR,
): AuditLogListItem {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: formatAuditTimestamp(),
    user: actor,
    action,
    target,
    details,
  };
}

export function canManageMappingLock(activeUserCount: number): boolean {
  return activeUserCount > MAPPING_LOCK_CONCURRENT_USER_THRESHOLD;
}

export function exportAuditLogCsv(entries: AuditLogListItem[]): void {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = ['Timestamp', 'User', 'Action', 'Target', 'Details'].join(',');
  const rows = entries.map((entry) =>
    [
      escape(entry.timestamp),
      escape(entry.user.name),
      escape(entry.action),
      escape(entry.target),
      escape(entry.details),
    ].join(','),
  );

  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${formatDisplayDate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildUserListItem(input: UserProfileInput, id?: string): AdminUserListItem {
  const trimmedName = input.name.trim();
  const trimmedEmail = input.email.trim();

  return {
    id: id ?? `user-${Date.now()}`,
    initials: getInitials(trimmedName),
    name: trimmedName,
    email: trimmedEmail,
    role: input.role,
    status: input.status ?? 'Active',
    lastLogin: '—',
    mappingsCount: 0,
  };
}

export function isValidUserProfileInput(input: UserProfileInput): boolean {
  return input.name.trim().length > 0 && input.email.trim().includes('@');
}
